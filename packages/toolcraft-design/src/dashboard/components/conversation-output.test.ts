import { describe, expect, it } from "vitest";
import { ScreenBuffer } from "../buffer.js";
import type { OutputItem } from "../types.js";
import { renderOutputPane } from "./output-pane.js";
import { getTheme } from "../../internal/theme-detect.js";

function rows(items: OutputItem[], details = false, now?: number) {
  const buffer = new ScreenBuffer(80, 15);
  renderOutputPane(buffer, { x: 0, y: 0, width: 80, height: 15 }, items, 0, { conversation: true, details, now });
  return Array.from({ length: 15 }, (_, y) => Array.from({ length: 80 }, (_, x) => buffer.get(x, y).ch).join("").trimEnd());
}

describe("concise conversation transcript", () => {
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
