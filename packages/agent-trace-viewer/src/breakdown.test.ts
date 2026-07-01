import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedTrace } from "@poe-code/agent-traces";

const mocks = vi.hoisted(() => ({
  countTokens: vi.fn((text: string) => (text.length === 0 ? 0 : text.length))
}));

vi.mock("tokenfill", () => ({
  countTokens: mocks.countTokens
}));

import { computeContextBreakdown } from "./breakdown.js";

describe("computeContextBreakdown", () => {
  beforeEach(() => {
    mocks.countTokens.mockReset();
    mocks.countTokens.mockImplementation((text: string) => text.length);
  });

  it("attributes turns to ordered categories with grouped items", () => {
    const trace: NormalizedTrace = {
      source: "codex",
      id: "trace",
      turns: [
        { role: "system", sourceKind: "base_instructions", text: "system" },
        { role: "system", skillName: "skill-a", text: "aaa" },
        { role: "system", skillName: "skill-a", text: "bb" },
        { role: "tool", mcpServer: "server-a", toolName: "mcp-tool", text: "cccc" },
        { role: "system", sourceKind: "system_reminder", text: "dd" },
        { role: "tool", toolName: "exec", text: "eeeee" },
        { role: "tool", text: "f" },
        { role: "assistant", sourceKind: "reasoning", text: "ggg" },
        { role: "human", text: "hhhh" },
        { role: "assistant", text: "ii" },
        { role: "system", text: "j" }
      ]
    };

    const breakdown = computeContextBreakdown(trace);

    expect(breakdown.measuredTokens).toBe(33);
    expect(breakdown.categories.map((category) => category.label)).toEqual([
      "System prompt",
      "Skills",
      "MCP",
      "System reminders",
      "Tools",
      "Reasoning",
      "Messages",
      "Other"
    ]);
    expect(breakdown.categories).toMatchObject([
      { id: "system-prompt", tokens: 6, percent: 18, items: [] },
      {
        id: "skills",
        tokens: 5,
        percent: 15,
        items: [{ name: "skill-a", tokens: 5, count: 2 }]
      },
      {
        id: "mcp",
        tokens: 4,
        percent: 12,
        items: [{ name: "server-a", tokens: 4, count: 1 }]
      },
      { id: "system-reminders", tokens: 2, percent: 6, items: [] },
      {
        id: "tools",
        tokens: 6,
        percent: 18,
        items: [
          { name: "exec", tokens: 5, count: 1 },
          { name: "unknown", tokens: 1, count: 1 }
        ]
      },
      { id: "reasoning", tokens: 3, percent: 9, items: [] },
      { id: "messages", tokens: 6, percent: 18, items: [] },
      { id: "other", tokens: 1, percent: 3, items: [] }
    ]);
  });

  it("uses first-match-wins precedence for MCP tool turns", () => {
    const trace: NormalizedTrace = {
      source: "codex",
      id: "trace",
      turns: [{ role: "tool", mcpServer: "server-a", toolName: "exec", text: "abc" }]
    };

    expect(computeContextBreakdown(trace).categories).toEqual([
      {
        id: "mcp",
        label: "MCP",
        tokens: 3,
        percent: 100,
        items: [{ name: "server-a", tokens: 3, count: 1 }]
      }
    ]);
  });

  it("omits zero-token categories with no counted items", () => {
    const trace: NormalizedTrace = {
      source: "codex",
      id: "trace",
      turns: [
        { role: "human", text: "" },
        { role: "assistant", text: "abc" }
      ]
    };

    expect(computeContextBreakdown(trace).categories).toEqual([
      {
        id: "messages",
        label: "Messages",
        tokens: 3,
        percent: 100,
        items: []
      }
    ]);
  });

  it("keeps zero-token categories when redacted items still have counts", () => {
    const trace: NormalizedTrace = {
      source: "poe-code",
      id: "redacted",
      turns: [
        { role: "tool", toolName: "exec", text: "" },
        { role: "tool", toolName: "exec", text: "" }
      ]
    };

    expect(computeContextBreakdown(trace).categories).toEqual([
      {
        id: "tools",
        label: "Tools",
        tokens: 0,
        percent: 0,
        items: [{ name: "exec", tokens: 0, count: 2 }]
      }
    ]);
  });

  it("handles an empty trace", () => {
    expect(computeContextBreakdown({ source: "codex", id: "empty", turns: [] })).toEqual({
      measuredTokens: 0,
      categories: []
    });
  });
});
