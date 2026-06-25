import type {
  SessionUpdate as AcpClientSessionUpdate,
  ToolKind as AcpClientToolKind
} from "@poe-code/poe-acp-client";
import type {
  AcpEvent,
  SessionUpdate as LegacySessionUpdate,
  ToolKind as LegacyToolKind
} from "./types.js";

type ConvertibleSessionUpdate = AcpClientSessionUpdate | LegacySessionUpdate;
type ConvertibleToolKind = AcpClientToolKind | LegacyToolKind;

export interface ToolRenderState {
  startedToolCalls: Set<string>;
  toolCallKinds: Map<string, string>;
  toolCallTitles: Map<string, string>;
}

export function createToolRenderState(): ToolRenderState {
  return {
    startedToolCalls: new Set(),
    toolCallKinds: new Map(),
    toolCallTitles: new Map()
  };
}

export function toRenderKind(kind: ConvertibleToolKind | undefined | null): string {
  if (kind === "execute") return "exec";
  if (kind === "write" || kind === "edit") return "edit";
  if (kind === "read") return "read";
  return "other";
}

function toToolTitle(title: string, locations?: Array<{ path: string }> | null): string {
  if (locations && locations.length > 0 && locations[0].path) {
    return locations[0].path;
  }
  return title;
}

function toToolOutput(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractToolOutputText(update: {
  rawOutput?: unknown;
  content?: Array<{ type: string; text?: string }> | null;
}): string {
  const raw = toToolOutput(update.rawOutput);
  if (raw) return raw;
  if (!update.content) return "";
  return update.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("");
}

export function sessionUpdateToEvents(
  update: ConvertibleSessionUpdate,
  state: ToolRenderState
): AcpEvent[] {
  if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
    return [{ event: "agent_message", text: update.content.text }];
  }

  if (update.sessionUpdate === "agent_thought_chunk" && update.content.type === "text") {
    return [{ event: "reasoning", text: update.content.text }];
  }

  if (update.sessionUpdate === "usage_update") {
    const meta = (update._meta ?? {}) as {
      inputTokens?: number;
      outputTokens?: number;
      cachedTokens?: number;
    };
    const inputTokens = typeof meta.inputTokens === "number" ? meta.inputTokens : update.used;
    const outputTokens = typeof meta.outputTokens === "number" ? meta.outputTokens : 0;
    const cachedTokens =
      typeof meta.cachedTokens === "number"
        ? meta.cachedTokens
        : Math.max(0, update.size - update.used);

    const usage: AcpEvent = {
      event: "usage",
      inputTokens,
      outputTokens
    };

    if (cachedTokens > 0) {
      (usage as { cachedTokens?: number }).cachedTokens = cachedTokens;
    }

    if (update.cost && update.cost.currency === "USD") {
      (usage as { costUsd?: number }).costUsd = update.cost.amount;
      (usage as { costSource?: "reported" }).costSource = "reported";
    }

    return [usage];
  }

  if (update.sessionUpdate === "tool_call") {
    const renderKind = toRenderKind(update.kind);
    const title = toToolTitle(update.title, update.locations);
    state.toolCallKinds.set(update.toolCallId, renderKind);
    state.toolCallTitles.set(update.toolCallId, title);

    if (state.startedToolCalls.has(update.toolCallId)) {
      return [];
    }

    state.startedToolCalls.add(update.toolCallId);
    return [
      {
        event: "tool_start",
        kind: renderKind,
        title,
        id: update.toolCallId
      }
    ];
  }

  if (update.sessionUpdate === "tool_call_update") {
    const renderKind =
      (update.kind == null ? undefined : toRenderKind(update.kind)) ||
      state.toolCallKinds.get(update.toolCallId) ||
      "other";
    state.toolCallKinds.set(update.toolCallId, renderKind);

    const events: AcpEvent[] = [];
    const toolTitle = toToolTitle(
      state.toolCallTitles.get(update.toolCallId) ?? update.toolCallId,
      update.locations
    );
    state.toolCallTitles.set(update.toolCallId, toolTitle);
    const status = update.status;

    const shouldStart =
      !state.startedToolCalls.has(update.toolCallId) &&
      (status === "pending" || status === "in_progress");
    if (shouldStart) {
      state.startedToolCalls.add(update.toolCallId);
      events.push({
        event: "tool_start",
        kind: renderKind,
        title: toolTitle,
        id: update.toolCallId
      });
    }

    if (status === "completed" || status === "failed" || status === "cancelled") {
      if (!state.startedToolCalls.has(update.toolCallId)) {
        state.startedToolCalls.add(update.toolCallId);
        events.push({
          event: "tool_start",
          kind: renderKind,
          title: toolTitle,
          id: update.toolCallId
        });
      }

      events.push({
        event: "tool_complete",
        kind: renderKind,
        path: extractToolOutputText(update),
        id: update.toolCallId
      });
    }

    return events;
  }

  return [];
}
