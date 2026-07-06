import { estimateTokens } from "tokenfill";
import type { NormalizedTrace, NormalizedTraceTurn } from "@poe-code/agent-traces";
import type { ContextBreakdown, ContextBreakdownCategory, ContextBreakdownItem } from "./types.js";

interface Matcher {
  id: string;
  label: string;
  matches(turn: NormalizedTraceTurn): boolean;
  itemName?(turn: NormalizedTraceTurn): string;
}

const MATCHERS: Matcher[] = [
  {
    id: "system-prompt",
    label: "System prompt",
    matches: (turn) => turn.sourceKind === "base_instructions"
  },
  {
    id: "skills",
    label: "Skills",
    matches: (turn) => turn.skillName !== undefined,
    itemName: (turn) => turn.skillName ?? "unknown"
  },
  {
    id: "mcp",
    label: "MCP",
    matches: (turn) => turn.mcpServer !== undefined,
    itemName: (turn) => turn.mcpServer ?? "unknown"
  },
  {
    id: "system-reminders",
    label: "System reminders",
    matches: (turn) => turn.sourceKind === "system_reminder"
  },
  {
    id: "tools",
    label: "Tools",
    matches: (turn) => turn.role === "tool",
    itemName: (turn) => turn.toolName ?? "unknown"
  },
  {
    id: "reasoning",
    label: "Reasoning",
    matches: (turn) => turn.sourceKind === "reasoning"
  },
  {
    id: "messages",
    label: "Messages",
    matches: (turn) => turn.role === "human" || turn.role === "assistant"
  },
  {
    id: "other",
    label: "Other",
    matches: () => true
  }
];

export function computeContextBreakdown(trace: NormalizedTrace): ContextBreakdown {
  const categories = MATCHERS.map((matcher) => ({
    id: matcher.id,
    label: matcher.label,
    tokens: 0,
    items: new Map<string, ContextBreakdownItem>()
  }));

  for (const turn of trace.turns) {
    const tokens = estimateTokens(turn.text);
    const matcherIndex = MATCHERS.findIndex((matcher) => matcher.matches(turn));
    const matcher = MATCHERS[matcherIndex]!;
    const category = categories[matcherIndex]!;
    category.tokens += tokens;

    if (matcher.itemName !== undefined && tokens > 0) {
      const name = matcher.itemName(turn);
      const item = category.items.get(name) ?? { name, tokens: 0, count: 0 };
      item.tokens += tokens;
      item.count += 1;
      category.items.set(name, item);
    } else if (matcher.itemName !== undefined) {
      const name = matcher.itemName(turn);
      const item = category.items.get(name) ?? { name, tokens: 0, count: 0 };
      item.count += 1;
      category.items.set(name, item);
    }
  }

  const measuredTokens = categories.reduce((sum, category) => sum + category.tokens, 0);
  const outputCategories: ContextBreakdownCategory[] = categories
    .filter((category) => category.tokens > 0 || category.items.size > 0)
    .map((category) => ({
      id: category.id,
      label: category.label,
      tokens: category.tokens,
      percent: measuredTokens === 0 ? 0 : Math.round((category.tokens / measuredTokens) * 100),
      items: Array.from(category.items.values())
        .filter((item) => item.tokens > 0 || item.count > 0)
        .sort((left, right) => right.tokens - left.tokens)
    }));

  return {
    measuredTokens,
    categories: outputCategories
  };
}
