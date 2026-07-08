import { describe, expect, it } from "vitest";
import { gaugeTone, renderTraceHtml } from "./render-html.js";
import type { TraceTreeNode, TraceView } from "./types.js";

function view(overrides: Partial<TraceView> = {}): TraceView {
  return {
    source: "claude",
    id: "parent",
    title: "Parent title",
    model: "claude-sonnet-4.5",
    turns: [],
    context: { tokens: 84000, window: 200000, percent: 42, source: "reported" },
    breakdown: {
      measuredTokens: 84000,
      source: "exact",
      categories: [
        { id: "messages", label: "Messages", tokens: 14000, percent: 17, items: [] },
        {
          id: "tools",
          label: "Tools",
          tokens: 18000,
          percent: 21,
          items: [
            { name: "Bash", tokens: 10000, count: 12 },
            { name: "Read", tokens: 5000, count: 8 },
            { name: "Edit", tokens: 2000, count: 4 },
            { name: "Write", tokens: 500, count: 1 },
            { name: "Glob", tokens: 300, count: 1 },
            { name: "Grep", tokens: 200, count: 1 }
          ]
        },
        { id: "skills", label: "Skills", tokens: 28000, percent: 34, items: [] }
      ]
    },
    ...overrides
  };
}

function tree(root: TraceView, children: TraceTreeNode[] = []): TraceTreeNode {
  return { view: root, children };
}

describe("gaugeTone", () => {
  it("uses ok / warn / danger bands", () => {
    expect(gaugeTone(0)).toBe("ok");
    expect(gaugeTone(59)).toBe("ok");
    expect(gaugeTone(60)).toBe("warn");
    expect(gaugeTone(84)).toBe("warn");
    expect(gaugeTone(85)).toBe("danger");
  });
});

describe("renderTraceHtml", () => {
  it("renders header, gauge tone, breakdown, and conversation", () => {
    const html = renderTraceHtml(
      tree(
        view({
          turns: [
            { role: "human", text: "Hello <script>alert(1)</script>" },
            { role: "assistant", text: "## Plan\n\nUse `renderTraceHtml`." },
            {
              role: "tool",
              toolName: "Bash",
              sourceKind: "tool_use",
              text: "line1\nline2\nline3\nline4\nline5"
            },
            { role: "system", sourceKind: "system_reminder", text: "keep going\nmore" }
          ]
        })
      ),
      { generatedAt: new Date("2026-07-08T12:00:00.000Z") }
    );

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Parent title");
    expect(html).toContain('class="badge badge-claude"');
    expect(html).toContain("tone-ok");
    expect(html).toContain("42%");
    expect(html).toContain("Context");
    expect(html).toContain("Breakdown");
    expect(html).toContain("exact");
    expect(html).toContain("… 1 more");
    expect(html).toContain("Conversation");
    expect(html).toContain("Hello &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain('data-role="human"');
    expect(html).toContain('data-role="assistant"');
    expect(html).toContain('data-role="tool"');
    expect(html).toContain('data-role="system"');
    expect(html).toContain("is-collapsed");
    expect(html).toContain("<h2>Plan</h2>");
    expect(html).not.toMatch(/>\s*Subagents\s*</);
    expect(html).not.toMatch(/https?:\/\/(cdn|fonts\.googleapis|unpkg\.com)/);
    expect(html).toContain("img { display: none !important; }");
  });

  it("places child panels after Task spawn turns and leaves unmatched at end", () => {
    const childA: TraceTreeNode = {
      view: view({
        id: "child-a",
        title: "Explore work",
        turns: [{ role: "human", text: "child a" }],
        context: { tokens: 1000, window: 200000, percent: 1, source: "reported" },
        breakdown: { measuredTokens: 1000, categories: [], source: "exact" }
      }),
      reference: {
        source: "claude",
        id: "child-a",
        title: "Explore work",
        agentType: "Explore"
      },
      children: []
    };
    const childB: TraceTreeNode = {
      view: view({
        id: "child-b",
        title: "Plan work",
        turns: [
          {
            role: "tool",
            toolName: "Task",
            sourceKind: "tool_use",
            text: "spawn nested"
          },
          { role: "assistant", text: "done" }
        ],
        context: { tokens: 2000, window: 200000, percent: 1, source: "reported" },
        breakdown: { measuredTokens: 2000, categories: [], source: "exact" }
      }),
      reference: { source: "claude", id: "child-b", title: "Plan work", agentType: "Plan" },
      children: [
        {
          view: view({
            id: "nested",
            title: "Nested bash",
            turns: [{ role: "tool", toolName: "Bash", text: "ok" }],
            context: { tokens: 100, window: 200000, percent: 0, source: "estimated" },
            breakdown: { measuredTokens: 100, categories: [], source: "exact" }
          }),
          reference: {
            source: "claude",
            id: "nested",
            title: "Nested bash",
            agentType: "Bash"
          },
          children: []
        }
      ]
    };
    const orphan: TraceTreeNode = {
      view: view({
        id: "orphan",
        title: "Orphan",
        turns: [],
        context: { tokens: 0, window: 0, percent: 0, source: "estimated" },
        breakdown: { measuredTokens: 0, categories: [], source: "exact" }
      }),
      reference: { source: "claude", id: "orphan", title: "Orphan" },
      children: []
    };

    const html = renderTraceHtml(
      tree(
        view({
          turns: [
            { role: "human", text: "start" },
            {
              role: "tool",
              toolName: "Task",
              sourceKind: "tool_use",
              text: "spawn explore"
            },
            { role: "assistant", text: "middle" },
            {
              role: "tool",
              toolName: "Task",
              sourceKind: "tool_use",
              text: "spawn plan"
            },
            { role: "assistant", text: "end" }
          ]
        }),
        [childA, childB, orphan]
      )
    );

    const exploreIdx = html.indexOf("Explore · Explore work");
    const planIdx = html.indexOf("Plan · Plan work");
    const nestedIdx = html.indexOf("Bash · Nested bash");
    const orphanIdx = html.indexOf("Orphan");
    const additionalIdx = html.indexOf("Additional subagents");
    const spawnExplore = html.indexOf("spawn explore");
    const spawnPlan = html.indexOf("spawn plan");
    const endIdx = html.indexOf(">end<") === -1 ? html.indexOf("end") : html.indexOf(">end<");

    expect(exploreIdx).toBeGreaterThan(spawnExplore);
    expect(planIdx).toBeGreaterThan(spawnPlan);
    expect(nestedIdx).toBeGreaterThan(planIdx);
    expect(additionalIdx).toBeGreaterThan(endIdx);
    expect(orphanIdx).toBeGreaterThan(additionalIdx);
    expect(html).toContain('data-depth="1"');
    expect(html).toContain('data-depth="2"');
    expect(html).toContain('aria-expanded="false"');
    expect(html.match(/class="node(?! unavailable)[^"]*"/g)?.some((value) => !value.includes("is-expanded"))).toBe(
      true
    );
  });

  it("renders unavailable children, redacted poe-code turns, estimated chip, empty states", () => {
    const unavailable: TraceTreeNode = {
      view: view({ id: "missing", turns: [] }),
      reference: { source: "claude", id: "missing", title: "agent-orphan" },
      children: [],
      unavailable: {
        reference: { source: "claude", id: "missing", title: "agent-orphan" },
        reason: "missing child file"
      }
    };

    const withUnavailable = renderTraceHtml(
      tree(
        view({
          turns: [
            {
              role: "tool",
              toolName: "Task",
              sourceKind: "tool_use",
              text: "spawn"
            }
          ]
        }),
        [unavailable]
      )
    );
    expect(withUnavailable).toContain("unavailable · agent-orphan");
    expect(withUnavailable).toContain("missing child file");

    const redacted = renderTraceHtml(
      tree(
        view({
          source: "poe-code",
          turns: [
            { role: "human", text: "" },
            { role: "assistant", text: "   " },
            { role: "tool", toolName: "Spawn", text: "" },
            { role: "assistant", text: "[redacted]" },
            { role: "tool", toolName: "exec", text: "[redacted]" }
          ],
          breakdown: {
            measuredTokens: 0,
            source: "exact",
            categories: [{ id: "tools", label: "Tools", tokens: 0, percent: 0, items: [] }]
          }
        })
      )
    );
    expect(redacted).toContain("Content redacted in poe-code traces.");
    expect(redacted).toContain('class="badge badge-poe-code"');
    expect(redacted).not.toContain(">[redacted]<");
    expect((redacted.match(/Content redacted in poe-code traces\./g) ?? []).length).toBeGreaterThanOrEqual(
      5
    );

    const estimated = renderTraceHtml(
      tree(
        view({
          context: { tokens: 10, window: 100, percent: 10, source: "estimated" },
          breakdown: {
            measuredTokens: 10,
            source: "estimated",
            categories: [{ id: "messages", label: "Messages", tokens: 10, percent: 100, items: [] }]
          },
          turns: [{ role: "human", text: "hi" }]
        })
      )
    );
    expect(estimated).toContain("estimated");
    expect(estimated).toContain("Token counts are estimated");

    const empty = renderTraceHtml(tree(view({ turns: [] })));
    expect(empty).toContain("No turns recorded in this trace.");

    const high = renderTraceHtml(
      tree(
        view({
          context: { tokens: 190000, window: 200000, percent: 95, source: "reported" },
          turns: [{ role: "human", text: "hi" }]
        })
      )
    );
    expect(high).toContain("tone-danger");
  });

  it("shows child context on the child panel without changing the parent gauge", () => {
    const child: TraceTreeNode = {
      view: view({
        id: "child",
        title: "Child",
        turns: [{ role: "human", text: "nested" }],
        context: { tokens: 50000, window: 200000, percent: 25, source: "reported" },
        breakdown: { measuredTokens: 50000, categories: [], source: "exact" }
      }),
      reference: { source: "claude", id: "child", title: "Child", agentType: "Explore" },
      children: []
    };

    const html = renderTraceHtml(
      tree(
        view({
          context: { tokens: 1000, window: 200000, percent: 1, source: "reported" },
          turns: [
            {
              role: "tool",
              toolName: "Task",
              sourceKind: "tool_use",
              text: "spawn"
            }
          ]
        }),
        [child]
      )
    );

    expect(html).toContain("tone-ok");
    expect(html).toContain("1%");
    expect(html).toContain("Explore · Child");
    expect(html).toContain("50.0k · 25%");
    expect(html).not.toMatch(/1000\s*\+\s*50000|51000/);
  });

  it("omits missing optional fields and respects page size truncation", () => {
    const sparse = renderTraceHtml(
      tree(
        view({
          title: undefined,
          model: undefined,
          createdAt: undefined,
          updatedAt: undefined,
          path: undefined,
          id: "session-deadbeef",
          turns: [{ role: "assistant", text: "ok" }]
        })
      )
    );
    expect(sparse).toContain("session-deadbeef");
    expect(sparse).not.toContain("model:");
    expect(sparse).not.toContain("started ");
    expect(sparse).not.toContain('class="path-row"');

    const huge = renderTraceHtml(
      tree(
        view({
          turns: Array.from({ length: 20 }, (_, index) => ({
            role: "assistant" as const,
            text: `turn-${index}-${"x".repeat(200)}`
          }))
        })
      ),
      { pageSizeLimitBytes: 1500 }
    );
    expect(huge).toContain("Trace truncated for HTML export");
  });
});
