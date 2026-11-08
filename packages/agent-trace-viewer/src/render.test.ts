import { describe, expect, it, vi } from "vitest";
import { stripAnsi } from "toolcraft-design";
import type { ContextBreakdown, SubagentSummary, TraceView } from "./types.js";
import {
  renderBreakdown,
  renderContextGauge,
  renderSubagents,
  renderTraceDetail,
  renderTraceLine
} from "./render.js";

function plain(value: string): string {
  return stripAnsi(value);
}

describe("renderContextGauge", () => {
  it("renders zero tokens", () => {
    expect(
      plain(renderContextGauge({ tokens: 0, window: 200000, percent: 0, source: "reported" }, 8))
    ).toBe("▐░░░░░░░░▌ 0 / 200.0k · 0% · reported");
  });

  it("clamps the fill but prints the real percent", () => {
    expect(
      plain(renderContextGauge({ tokens: 150, window: 100, percent: 150, source: "reported" }, 4))
    ).toBe("▐████▌ 150 / 100 · 150% · reported");
  });

  it("handles tiny widths and estimated sources", () => {
    expect(
      plain(
        renderContextGauge({ tokens: 4200, window: 1000000, percent: 1, source: "estimated" }, 0)
      )
    ).toBe("▐░▌ 4.2k / 1.0M · 1% · (estimated)");
  });
});

describe("renderBreakdown", () => {
  it("renders an empty breakdown", () => {
    expect(plain(renderBreakdown({ measuredTokens: 0, categories: [] }))).toBe(
      "Context breakdown\n  No context tokens measured"
    );
  });

  it("renders a single category", () => {
    const output = plain(
      renderBreakdown(
        {
          measuredTokens: 1200,
          categories: [{ id: "messages", label: "Messages", tokens: 1200, percent: 100, items: [] }]
        },
        10
      )
    );

    expect(output).toContain("▐██████████▌");
    expect(output).toContain("■ Messages    1.2k  100%");
  });

  it("keeps the segmented bar within width when rounding overshoots", () => {
    const categories = [
      "system-prompt",
      "skills",
      "mcp",
      "system-reminders",
      "tools",
      "reasoning",
      "messages",
      "other"
    ];
    const breakdown: ContextBreakdown = {
      measuredTokens: categories.length,
      categories: categories.map((id) => ({
        id,
        label: id,
        tokens: 1,
        percent: Math.round(100 / categories.length),
        items: []
      }))
    };

    const output = plain(renderBreakdown(breakdown, 4));

    expect(output).toContain("▐");
    expect(output.split("\n")[1]).toContain("▌");
  });

  it("sorts categories by fixed order and limits item rows", () => {
    const breakdown: ContextBreakdown = {
      measuredTokens: 200000,
      categories: [
        { id: "messages", label: "Messages", tokens: 90000, percent: 45, items: [] },
        {
          id: "skills",
          label: "Skills",
          tokens: 60000,
          percent: 30,
          items: [
            { name: "skill-a", tokens: 30000, count: 2 },
            { name: "skill-b", tokens: 10000, count: 1 },
            { name: "skill-c", tokens: 8000, count: 1 },
            { name: "skill-d", tokens: 6000, count: 1 },
            { name: "skill-e", tokens: 4000, count: 1 },
            { name: "skill-f", tokens: 2000, count: 1 }
          ]
        },
        {
          id: "tools",
          label: "Tools",
          tokens: 50000,
          percent: 25,
          items: [{ name: "exec", tokens: 50000, count: 4 }]
        }
      ]
    };

    const output = plain(renderBreakdown(breakdown));
    expect(output.indexOf("■ Skills")).toBeLessThan(output.indexOf("■ Tools"));
    expect(output.indexOf("■ Tools")).toBeLessThan(output.indexOf("■ Messages"));
    expect(output).toContain("      skill-a  30.0k  ×2");
    expect(output).toContain("      … 1 more");
  });

  it("keeps redacted zero-token category counts visible", () => {
    const output = plain(
      renderBreakdown({
        measuredTokens: 0,
        categories: [
          {
            id: "tools",
            label: "Tools",
            tokens: 0,
            percent: 0,
            items: [{ name: "redacted", tokens: 0, count: 2 }]
          }
        ]
      })
    );

    expect(output).toContain("■ Tools       0   0%");
    expect(output).toContain("      redacted  0  ×2");
  });

  it("pads item rows from the truncated item name", () => {
    const output = plain(
      renderBreakdown({
        measuredTokens: 10,
        categories: [
          {
            id: "skills",
            label: "Skills",
            tokens: 10,
            percent: 100,
            items: [
              { name: "a".repeat(80), tokens: 9, count: 1 },
              { name: "short", tokens: 1, count: 1 }
            ]
          }
        ]
      })
    );

    expect(output).toContain(`      ${"a".repeat(31)}…   9  ×1`);
    expect(output).toMatch(/^ {6}short +1 {2}×1$/m);
  });
});

describe("renderTraceLine", () => {
  it("renders title, source, relative time, and cwd basename", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
    try {
      const line = renderTraceLine({
        source: "codex",
        id: "trace-1",
        title: "Investigate traces",
        updatedAt: new Date("2026-07-01T10:00:00.000Z"),
        cwd: "/Users/kjopek/Workspace/poe-code"
      });

      expect(line.label).toBe("Investigate traces");
      expect(plain(line.meta)).toBe("codex · 2h ago · poe-code");
      expect(line.meta).not.toContain("\u001b");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to id and truncates long labels", () => {
    const line = renderTraceLine({
      source: "claude",
      id: "a".repeat(90)
    });

    expect(line.label).toHaveLength(60);
    expect(line.label.endsWith("…")).toBe(true);
  });
});

describe("renderSubagents", () => {
  it("renders nothing for an empty list", () => {
    expect(renderSubagents([])).toBe("");
  });

  it("renders depth indentation, description truncation, gauges, and turns", () => {
    const summaries: SubagentSummary[] = [
      {
        reference: {
          source: "claude",
          id: "child-1",
          title: "Research trace formats and a very long trailing clause",
          agentType: "Explore",
          spawnDepth: 1
        },
        context: { tokens: 26600, window: 200000, percent: 13, source: "reported" },
        turnCount: 57
      },
      {
        reference: {
          source: "claude",
          id: "child-2",
          title: "Nested investigation",
          agentType: "Plan",
          spawnDepth: 2
        },
        context: { tokens: 1200, window: 200000, percent: 1, source: "reported" },
        turnCount: 3
      },
      {
        reference: {
          source: "claude",
          id: "child-3",
          title: "Full context",
          agentType: "Review",
          spawnDepth: 3
        },
        context: { tokens: 220000, window: 200000, percent: 110, source: "reported" },
        turnCount: 1
      }
    ];

    const output = plain(renderSubagents(summaries));
    expect(output).toContain("Subagents");
    expect(output).toContain("  ├─ Explore        Research trace formats an…");
    expect(output).toContain("▐█░░░░▌ 26.6k · 13%    57 turns");
    expect(output).toContain("    ├─ Plan           Nested investigation");
    expect(output).toContain("      └─ Review         Full context");
    expect(output).toContain("▐█████▌ 220.0k · 110%  1 turn");
  });
});

describe("renderTraceDetail", () => {
  it("renders the header, breakdown, subagents, and conversation", async () => {
    const view: TraceView = {
      source: "codex",
      id: "trace-1",
      title: "Trace detail",
      model: "gpt-5",
      createdAt: new Date("2026-07-01T09:00:00.000Z"),
      updatedAt: new Date("2026-07-01T10:00:00.000Z"),
      context: { tokens: 34100, window: 258400, percent: 13, source: "reported" },
      breakdown: {
        measuredTokens: 6,
        categories: [{ id: "messages", label: "Messages", tokens: 6, percent: 100, items: [] }]
      },
      turns: [
        { role: "human", text: "Hello" },
        { role: "assistant", text: "**Done**" },
        { role: "tool", text: ["one", "two", "three", "four", "five"].join("\n") },
        { role: "system", text: "system message" }
      ]
    };

    const output = plain(
      await renderTraceDetail(view, [
        {
          reference: { source: "codex", id: "child", title: "Child", agentType: "Explore" },
          context: { tokens: 1000, window: 200000, percent: 1, source: "reported" },
          turnCount: 2
        }
      ])
    );

    expect(output).toContain("Trace detail");
    expect(output).toContain("Source: codex");
    expect(output).toContain("Model: gpt-5");
    expect(output).toContain("Turns: 4");
    expect(output).toContain("Context breakdown");
    expect(output).toContain("Subagents");
    expect(output).toContain("human › Hello");
    expect(output).toContain("assistant ✦ Done");
    expect(output).toContain("tool ⚙ one");
    expect(output).toContain("… +2 lines");
    expect(output).toContain("system ⚠ system message");
  });

  it("sanitizes trace text and keeps detail lines within 80 columns", async () => {
    const view: TraceView = {
      source: "claude",
      id: "trace-1",
      title:
        "A very long trace title that should be shortened before it stretches the terminal capture",
      model: "claude-sonnet-4-6",
      context: { tokens: 10, window: 200000, percent: 0, source: "estimated" },
      breakdown: {
        measuredTokens: 10,
        categories: [{ id: "messages", label: "Messages", tokens: 10, percent: 100, items: [] }]
      },
      turns: [
        {
          role: "assistant",
          text: `before \u001b[31mred\u001b[0m after ${"word ".repeat(40)}`
        }
      ]
    };

    const output = plain(await renderTraceDetail(view));

    expect(output).not.toContain("[31m");
    expect(output).toContain("before red after");
    expect(
      output
        .split("\n")
        .filter((line) => line.length > 0)
        .every((line) => line.length <= 80)
    ).toBe(true);
  });

  it("renders every turn of long conversations", async () => {
    const view: TraceView = {
      source: "codex",
      id: "trace-1",
      context: { tokens: 10, window: 200000, percent: 0, source: "estimated" },
      breakdown: { measuredTokens: 0, categories: [] },
      turns: Array.from({ length: 600 }, (_, index) => ({
        role: "assistant" as const,
        text: `message ${index}`
      }))
    };

    const output = plain(await renderTraceDetail(view));

    expect(output).toContain("Conversation");
    expect(output).toContain("message 0");
    expect(output).toContain("message 599");
  });

  it("stops rendering turns once aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const view: TraceView = {
      source: "codex",
      id: "trace-1",
      context: { tokens: 10, window: 200000, percent: 0, source: "estimated" },
      breakdown: { measuredTokens: 0, categories: [] },
      turns: Array.from({ length: 600 }, (_, index) => ({
        role: "assistant" as const,
        text: `message ${index}`
      }))
    };

    const output = plain(await renderTraceDetail(view, [], { signal: controller.signal }));

    expect(output).toContain("message 0");
    expect(output).not.toContain("message 599");
  });
});
