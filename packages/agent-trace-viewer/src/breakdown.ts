import { countTokens } from "tokenfill";
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

const TURNS_PER_YIELD = 64;
const ESTIMATOR_SAMPLE_TARGET_CHARS = 16_384;
const ESTIMATOR_SAMPLE_CHARS_PER_TURN = 1_024;
const ESTIMATOR_DEFAULT_CHARS_PER_TOKEN = 4;

export interface ComputeContextBreakdownOptions {
  signal?: AbortSignal;
  mode?: "exact" | "estimated";
}

export async function computeContextBreakdown(
  trace: NormalizedTrace,
  options: ComputeContextBreakdownOptions = {}
): Promise<ContextBreakdown> {
  const mode = options.mode ?? "exact";
  const estimate = mode === "exact" ? undefined : createTraceTokenEstimator(trace.turns);
  const categories = MATCHERS.map((matcher) => ({
    id: matcher.id,
    label: matcher.label,
    tokens: 0,
    items: new Map<string, ContextBreakdownItem>()
  }));

  for (let index = 0; index < trace.turns.length; index += 1) {
    if (mode === "exact" && index > 0 && index % TURNS_PER_YIELD === 0) {
      await yieldToEventLoop();
      if (options.signal?.aborted) {
        break;
      }
    }

    const turn = trace.turns[index]!;
    const tokens = estimate === undefined ? await countTokensYielding(turn.text) : estimate(turn.text);
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
    categories: outputCategories,
    source: mode
  };
}

function createTraceTokenEstimator(
  turns: Pick<NormalizedTraceTurn, "text">[]
): (text: string) => number {
  const sampleParts: string[] = [];
  let sampleLength = 0;
  for (const turn of turns) {
    if (sampleLength >= ESTIMATOR_SAMPLE_TARGET_CHARS) {
      break;
    }
    const part = turn.text.slice(
      0,
      Math.min(ESTIMATOR_SAMPLE_CHARS_PER_TURN, ESTIMATOR_SAMPLE_TARGET_CHARS - sampleLength)
    );
    sampleParts.push(part);
    sampleLength += part.length;
  }

  const sample = sampleParts.join("");
  const sampleTokens = sample.length === 0 ? 0 : countTokens(sample);
  const charsPerToken =
    sampleTokens === 0 ? ESTIMATOR_DEFAULT_CHARS_PER_TOKEN : sample.length / sampleTokens;

  return (text) => Math.round(text.length / charsPerToken);
}

const COUNT_CHUNK_CHARS = 512 * 1024;

async function countTokensYielding(text: string): Promise<number> {
  if (text.length <= COUNT_CHUNK_CHARS) {
    return countTokens(text);
  }

  let total = 0;
  for (let index = 0; index < text.length; index += COUNT_CHUNK_CHARS) {
    if (index > 0) {
      await yieldToEventLoop();
    }
    total += countTokens(text.slice(index, index + COUNT_CHUNK_CHARS));
  }
  return total;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
