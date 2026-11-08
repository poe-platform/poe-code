import { describe, expect, it } from "vitest";
import { withOutputFormat } from "../internal/output-format.js";
import { plainTerminalText } from "../dashboard/ansi.js";
import { withAcpWriter } from "./writer.js";
import { formatAgentPlan, renderAgentPlan, type AgentPlanEntry } from "./plan.js";

const entries: AgentPlanEntry[] = [
  { content: "Inspect validation", status: "completed" },
  { content: "Implement boundary checks", status: "in_progress" },
  { content: "Run focused tests", status: "pending" }
];

describe("agent checklist presentation", () => {
  it("keeps agent checklist progress separate from harness task counts", () => {
    expect(formatAgentPlan(entries)).toEqual({ text:
      "Agent checklist · 1/3\n  ✓ Inspect validation\n  › Implement boundary checks\n  ○ Run focused tests" });
  });

  it("focuses a long checklist around the active entry and retains every entry in details", () => {
    const plan: AgentPlanEntry[] = Array.from({ length: 12 }, (_, index) => ({
      content: `Step ${index + 1}`, status: index < 7 ? "completed" : index === 7 ? "in_progress" : "pending"
    }));
    const formatted = formatAgentPlan(plan);
    expect(formatted.text).toBe("Agent checklist · 7/12\n  ↑ 6 earlier steps\n  ✓ Step 7\n  › Step 8\n  ○ Step 9\n  ○ Step 10\n  ○ Step 11\n  ↓ 1 more step · d Details");
    expect(formatted.detail).toContain("✓ Step 1\n");
    expect(formatted.detail).toContain("○ Step 12");
    expect(formatted.detail).not.toContain("earlier steps");
  });

  it("shows the final entries when all steps are complete", () => {
    const formatted = formatAgentPlan(Array.from({ length: 8 }, (_, index) => ({ content: `Step ${index + 1}`, status: "completed" })));
    expect(formatted.text).toContain("Agent checklist · 8/8\n  ↑ 3 earlier steps\n  ✓ Step 4");
    expect(formatted.text).toContain("✓ Step 8");
  });

  it("preserves an explicit cleared checklist", () => {
    expect(formatAgentPlan([])).toEqual({ text: "Agent checklist cleared" });
  });

  it("bounds long entries and prevents terminal controls or embedded newlines from posing as checklist markers", () => {
    const content = "\x1b[31mInspect\n  ✓ fake completion\x1b[0m " + "details ".repeat(80);
    const formatted = formatAgentPlan([{ content, status: "pending" }]);
    expect(formatted.text.split("\n")).toHaveLength(2);
    expect(formatted.text.length).toBeLessThan(140);
    expect(formatted.text).not.toContain("\x1b");
    expect(formatted.detail).toContain("details ".repeat(50));
  });

  it("renders terminal, markdown, and JSON output through the shared writer", async () => {
    for (const format of ["terminal", "markdown", "json"] as const) {
      const lines: string[] = [];
      await withAcpWriter((line) => lines.push(line), async () => withOutputFormat(format, () => renderAgentPlan(entries)));
      if (format === "json") expect(JSON.parse(lines[0]!)).toEqual({ event: "plan", entries });
      else {
        expect(plainTerminalText(lines.join("\n"))).toContain("Agent checklist · 1/3");
        expect(plainTerminalText(lines.join("\n"))).toContain("Implement boundary checks");
      }
    }
  });
});
