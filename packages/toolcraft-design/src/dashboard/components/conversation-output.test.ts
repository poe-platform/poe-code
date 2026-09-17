import { describe, expect, it, vi } from "vitest";
import { ScreenBuffer } from "../buffer.js";
import type { OutputItem } from "../types.js";
import { computeVisualLines, renderOutputPane } from "./output-pane.js";
import { getTheme } from "../../internal/theme-detect.js";
import * as markdown from "../../terminal-markdown/index.js";

function rows(items: OutputItem[], details = false, now?: number) {
  const buffer = new ScreenBuffer(80, 15);
  renderOutputPane(buffer, { x: 0, y: 0, width: 80, height: 15 }, items, 0, { conversation: true, details, now });
  return Array.from({ length: 15 }, (_, y) => Array.from({ length: 80 }, (_, x) => buffer.get(x, y).ch).join("").trimEnd());
}

describe("concise conversation transcript", () => {
  it("reuses formatted replies while typing and reflows them after a resize or text update", () => {
    const parseMarkdown = vi.spyOn(markdown, "parse");
    const item: OutputItem = { role: "agent", kind: "info", text: "The **checks passed**.", ts: 0 };
    try {
      expect(rows([item])).toEqual(rows([item]));
      expect(parseMarkdown).toHaveBeenCalledTimes(1);
      const buffer = new ScreenBuffer(40, 15);
      renderOutputPane(buffer, { x: 0, y: 0, width: 40, height: 15 }, [item], 0, { conversation: true });
      expect(parseMarkdown).toHaveBeenCalledTimes(2);
      item.text = "The **review is complete**.";
      expect(rows([item])[0]).toBe("•  The review is complete.");
      expect(parseMarkdown).toHaveBeenCalledTimes(3);
    } finally { parseMarkdown.mockRestore(); }
  });

  it("formats only the visible tail of long replies and can still scroll to their beginning", () => {
    const renderMarkdown = vi.spyOn(markdown, "render");
    const text = Array.from({ length: 100 }, (_, index) => `## Section ${index}\n\nThe **checks passed**.`).join("\n\n");
    const item: OutputItem = { role: "agent", kind: "info", text, ts: 0 };
    try {
      const tail = rows([item]).join("\n");
      expect(tail).toContain("Section 99");
      expect(tail).not.toContain("•  Section");
      expect(renderMarkdown).toHaveBeenCalled();
      expect(renderMarkdown.mock.calls.reduce((count, [node]) => count + (node.type === "root" ? node.children.length : 1), 0)).toBeLessThan(20);
      const buffer = new ScreenBuffer(80, 15);
      const offset = renderOutputPane(buffer, { x: 0, y: 0, width: 80, height: 15 }, [item], 10000, { conversation: true });
      expect(offset).toBeGreaterThan(0);
      expect(Array.from({ length: 80 }, (_, x) => buffer.get(x, 0).ch).join("")).toContain("•  Section 0");
    } finally { renderMarkdown.mockRestore(); }
  });

  it.each([
    Array.from({ length: 25 }, (_, index) => `## Review ${index}\n\n- **Read** the source\n- Check formatting\n\n\`\`\`ts\n  verify(${index});\n\`\`\``).join("\n\n"),
    "Earlier result[^first].\n\n" + "More review text.\n\n".repeat(20) + "Final result[^last].\n\n[^first]: First source.\n[^last]: Last source."
  ])("matches complete Markdown rendering while scrolling at different widths", (text) => {
    for (const width of [20, 60]) {
      const formatted = markdown.renderMarkdown(text, { width: width - 3, showFrontmatter: true });
      const full = computeVisualLines([{ role: "agent", kind: "info", text: formatted, ts: 0 }], width, true);
      while (full.at(-1)?.text.trim() === "") full.pop();
      full.push({ text: "", prefix: "", style: {}, prefixStyle: {} });
      for (const offset of [0, 7, 10000]) {
        const buffer = new ScreenBuffer(width, 6);
        const actualOffset = renderOutputPane(buffer, { x: 0, y: 0, width, height: 6 }, [
          { role: "agent", kind: "info", text, ts: 0 }
        ], offset, { conversation: true });
        const expectedOffset = Math.min(offset, full.length - 6);
        expect(actualOffset).toBe(expectedOffset);
        const start = full.length - 6 - expectedOffset;
        const expected = new ScreenBuffer(width, 6);
        for (const [y, line] of full.slice(start, start + 6).entries()) {
          expected.putInRect({ x: 0, y: 0, width, height: 6 }, y, start + y === 0 ? "•" : "");
          expected.putInRect({ x: 3, y: 0, width: width - 3, height: 6 }, y, line.text);
        }
        const screen = (value: ScreenBuffer) => Array.from({ length: 6 }, (_, y) =>
          Array.from({ length: width }, (_, x) => value.get(x, y).ch).join(""));
        expect(screen(buffer)).toEqual(screen(expected));
      }
    }
  });

  it("renders agent Markdown and keeps queued user text literal", () => {
    const text = "## Review\n\nThe **checks passed** in `validation.ts`.\n\n- [x] Read the plan\n- [ ] Verify formatting";
    const rendered = rows([{ role: "agent", kind: "info", text, ts: 0 }]).join("\n");
    expect(rendered).toContain("•  Review");
    expect(rendered).toContain("The checks passed in validation.ts.");
    expect(rendered).not.toContain("**");
    expect(rendered).not.toContain("##");
    expect(rendered).not.toContain("`");
    expect(rendered).toContain("Read the plan");
    expect(rendered).toContain("Verify formatting");
    expect(rows([{ role: "user", kind: "info", text: "Keep **literal** syntax", ts: 0 }])[0]).toBe("›  Keep **literal** syntax");
  });

  it("preserves code indentation and link destinations in formatted replies without color", () => {
    const rendered = rows([{ role: "agent", kind: "info", ts: 0,
      text: "```ts\nfunction verify() {\n  return true;\n}\n```\n\nRead [the plan](docs/plans/release.md)." }]).join("\n");
    expect(rendered).toContain("     return true;");
    expect(rendered).toContain("docs/plans/release.md");
    expect(rendered).not.toContain("```");
  });

  it("keeps malformed streamed Markdown readable without interrupting the dashboard", () => {
    const text = "---\ntitle: [unfinished\n---\nStill reviewing the plan.";
    const rendered = rows([{ role: "agent", kind: "info", text, ts: 0 }]).join("\n");
    expect(rendered).toContain("title: [unfinished");
    expect(rendered).toContain("Still reviewing the plan.");
  });

  it("shows elapsed time only for a live running action", () => {
    const items: OutputItem[] = [
      { role: "action", kind: "tool", text: "Run npm test", detail: "npm test --workspace=docx", ts: 1000 },
      { role: "action", kind: "success", text: "Read settings.ts", ts: 1000 },
      { role: "agent", kind: "info", text: "The checks are still running.", ts: 1000 }
    ];
    expect(rows(items, false, 64000).slice(0, 3)).toEqual([
      "›  Run npm test · 01:03", "✓  Read settings.ts", "•  The checks are still running."
    ]);
    expect(rows(items, true, 3_664_000)[0]).toBe("›  Run npm test · 01:01:03");
    expect(rows(items, true, 3_664_000)[1]).toBe("   npm test --workspace=docx");
    expect(rows(items)[0]).toBe("›  Run npm test");
  });

  it.each([0, 1999, Number.NaN])("does not show an invalid or subsecond action age at %s", (now) => {
    expect(rows([{ role: "action", kind: "tool", text: "Read settings.ts", ts: 1000 }], false, now)[0])
      .toBe("›  Read settings.ts");
  });

  it("expands a checklist once in details and keeps it separate from completed tool actions", () => {
    const items: OutputItem[] = [{
      role: "plan", kind: "status", ts: 0,
      text: "Agent checklist · 1/8\n  ✓ Inspect code\n  ↓ 7 more steps · d Details",
      detail: "Agent checklist · 1/8\n  ✓ Inspect code\n  ○ Implement fix\n  ○ Run checks"
    }];
    const collapsed = rows(items).join("\n");
    expect(collapsed).toContain("Agent checklist · 1/8");
    expect(collapsed).not.toContain("Implement fix");
    const expanded = rows(items, true).join("\n");
    expect(expanded.split("Agent checklist")).toHaveLength(2);
    expect(expanded).toContain("○ Implement fix");
    expect(expanded).not.toContain("7 more steps");
  });

  it("folds older completed actions while retaining the latest work and agent explanation", () => {
    const items: OutputItem[] = [
      { role: "agent", kind: "info", text: "Checking the document boundaries.", ts: 0 },
      ...Array.from({ length: 10 }, (_, index): OutputItem => ({ role: "action", kind: "success", text: `Read file-${index + 1}.ts`, ts: index + 1 })),
      { role: "action", kind: "tool", text: "Run tests", ts: 11 }
    ];
    expect(rows(items).slice(0, 6)).toEqual([
      "•  Checking the document boundaries.", "", "·  8 earlier actions · d Details",
      "✓  Read file-9.ts", "✓  Read file-10.ts", "›  Run tests"
    ]);
    const expanded = rows(items, true).join("\n");
    expect(expanded).toContain("Read file-1.ts");
    expect(expanded).toContain("Read file-10.ts");
    expect(expanded).not.toContain("earlier actions");
  });

  it("never folds errors, cancelled actions, or user messages into completed work", () => {
    const completed = (prefix: string): OutputItem[] => Array.from({ length: 4 }, (_, index) => ({
      role: "action", kind: "success", text: `${prefix} ${index + 1}`, ts: index
    }));
    const result = rows([
      ...completed("Read"),
      { role: "action", kind: "error", text: "Build failed", ts: 5 },
      { role: "action", kind: "status", text: "Run tests · cancelled", ts: 6 },
      { role: "user", kind: "info", text: "Review before continuing", ts: 7 },
      ...completed("Check")
    ]).join("\n");
    expect(result.match(/2 earlier actions/g)).toHaveLength(2);
    expect(result).toContain("!  Build failed");
    expect(result).toContain("·  Run tests · cancelled");
    expect(result).toContain("›  Review before continuing");
  });

  it("distinguishes running, completed, and failed actions without relying on color", () => {
    const result = rows([
      { role: "action", kind: "tool", text: "Run tests", ts: 0 },
      { role: "action", kind: "success", text: "Read settings.ts", ts: 1 },
      { role: "action", kind: "error", text: "Build failed", ts: 2 }
    ]);
    expect(result.slice(0, 3)).toEqual(["›  Run tests", "✓  Read settings.ts", "!  Build failed"]);
  });

  it("keeps routine actions quiet while preserving visible errors and agent prose", () => {
    const buffer = new ScreenBuffer(80, 15);
    renderOutputPane(buffer, { x: 0, y: 0, width: 80, height: 15 }, [
      { role: "action", kind: "success", text: "Read settings.ts", ts: 0 },
      { kind: "status", text: "Builder starting", ts: 1 },
      { role: "action", kind: "error", text: "Build failed", ts: 2 },
      { role: "agent", kind: "info", text: "The fix is ready.", ts: 3 }
    ], 0, { conversation: true });
    expect(buffer.get(3, 0).style).toEqual(getTheme().styles.muted);
    expect(buffer.get(3, 1).style).toEqual(getTheme().styles.muted);
    expect(buffer.get(3, 2).style).toEqual(getTheme().styles.error);
    expect(buffer.get(3, 3).style).toEqual({});
  });

  it("keeps one separator after prose with trailing newlines", () => {
    const result = rows([
      { role: "agent", kind: "info", text: "Checks pass.\n\n", ts: 0 },
      { role: "action", kind: "tool", text: "Run build", ts: 1 }
    ]);
    expect(result.slice(0, 3)).toEqual(["•  Checks pass.", "", "›  Run build"]);
  });

  it("keeps reasoning available in details without crowding the normal transcript", () => {
    const items: OutputItem[] = [
      { role: "reasoning", kind: "status", text: "Reasoning summary for inspection", ts: 0 },
      { role: "agent", kind: "info", text: "The fix is ready.", ts: 1 }
    ];
    expect(rows(items).join("\n")).not.toContain("Reasoning summary");
    expect(rows(items, true).join("\n")).toContain("Reasoning summary");
  });
});
