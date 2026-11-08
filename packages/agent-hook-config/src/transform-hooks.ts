import type { HookEvent } from "./configs.js";
import {
  getEventMappings,
  getHandlerTypeRules,
  getPlaceholderRewrites,
  type PlaceholderRewrite
} from "./event-mapping.js";
import type { SourceHookEntry } from "./read-hooks.js";

export interface GeneratedHookEntry {
  event: HookEvent;
  matcher?: string;
  handler: {
    type: "command";
    command: string;
    args?: string[];
    timeout?: number;
    statusMessage: string;
  };
  /** Stable id derived from the source so two transform runs yield the same id for the same source entry. */
  generatedId: string;
}

export interface HookDrop {
  reason: "unsupported-event" | "unsupported-handler-type";
  detail: string;
  source: SourceHookEntry;
}

export interface TransformResult {
  entries: GeneratedHookEntry[];
  drops: HookDrop[];
}

function applyPlaceholderRewrites(value: string, rewrites: PlaceholderRewrite[]): string {
  return rewrites.reduce((rewrittenValue, rewrite) => {
    return rewrittenValue.replaceAll(rewrite.from, rewrite.to);
  }, value);
}

export function transformHooks(
  source: SourceHookEntry[],
  sourceAgentId: string,
  targetAgentId: string,
  opts: { runId: string }
): TransformResult {
  const eventMappings = getEventMappings(sourceAgentId, targetAgentId);
  const handlerRules = getHandlerTypeRules(targetAgentId);
  const placeholderRewrites = getPlaceholderRewrites(sourceAgentId, targetAgentId);
  const result: TransformResult = { entries: [], drops: [] };

  for (const sourceEntry of source) {
    const eventMapping = eventMappings.find((mapping) => mapping.sourceEvent === sourceEntry.event);
    if (!eventMapping || eventMapping.targetEvent === null) {
      result.drops.push({
        reason: "unsupported-event",
        detail: eventMapping?.dropReason ?? `${targetAgentId} has no ${sourceEntry.event} hook`,
        source: sourceEntry
      });
      continue;
    }

    const handlerRule = handlerRules.find((rule) => rule.sourceType === sourceEntry.handler.type);
    if (!handlerRule?.allowed) {
      result.drops.push({
        reason: "unsupported-handler-type",
        detail: `Unsupported handler type "${sourceEntry.handler.type}": ${handlerRule?.dropReason ?? `${targetAgentId} does not honor it`}`,
        source: sourceEntry
      });
      continue;
    }

    if (
      sourceEntry.handler.type === "command" &&
      (sourceEntry.handler.command === undefined || sourceEntry.handler.command.trim() === "")
    ) {
      result.drops.push({
        reason: "unsupported-handler-type",
        detail: "Command hook is missing an executable command",
        source: sourceEntry
      });
      continue;
    }

    const handler: GeneratedHookEntry["handler"] = {
      type: "command",
      command: applyPlaceholderRewrites(sourceEntry.handler.command ?? "", placeholderRewrites),
      statusMessage: `[generated:poe-code:${opts.runId}] ${sourceEntry.handler.statusMessage ?? ""}`
    };

    if (sourceEntry.handler.args !== undefined) {
      handler.args = sourceEntry.handler.args.map((arg) =>
        applyPlaceholderRewrites(arg, placeholderRewrites)
      );
    }
    if (sourceEntry.handler.timeout !== undefined) {
      handler.timeout = sourceEntry.handler.timeout;
    }

    result.entries.push({
      event: eventMapping.targetEvent,
      matcher: sourceEntry.matcher,
      handler,
      generatedId: `generated-${opts.runId}-${result.entries.length}`
    });
  }

  return result;
}
