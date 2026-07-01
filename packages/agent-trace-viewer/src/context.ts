import { countTokens } from "tokenfill";
import type { NormalizedTrace } from "@poe-code/agent-traces";
import type { ContextUsage } from "./types.js";

export const DEFAULT_CONTEXT_WINDOW = 200000;

export const CONTEXT_WINDOWS = [{ match: "claude", window: 200000 }];

export function computeContextUsage(trace: NormalizedTrace): ContextUsage {
  const window = resolveContextWindow(trace);
  const tokens =
    trace.usage !== undefined
      ? trace.usage.contextTokens
      : countTokens(trace.turns.map((turn) => turn.text).join("\n"));

  return {
    tokens,
    window,
    percent: window === 0 ? 0 : Math.round((tokens / window) * 100),
    source: trace.usage !== undefined ? "reported" : "estimated"
  };
}

function resolveContextWindow(trace: NormalizedTrace): number {
  if (trace.contextWindow !== undefined) {
    return trace.contextWindow;
  }

  const model = trace.model;
  if (model !== undefined) {
    const match = CONTEXT_WINDOWS.find((entry) => model.startsWith(entry.match));
    if (match !== undefined) {
      return match.window;
    }
  }

  return DEFAULT_CONTEXT_WINDOW;
}
