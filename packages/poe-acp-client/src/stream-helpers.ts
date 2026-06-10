import type {
  AgentMessageChunk,
  AgentThoughtChunk,
  SessionInfoUpdate,
  SessionUpdate,
  SessionUpdateNotification,
  ToolCall,
  ToolCallStatus,
  ToolCallUpdate,
  ToolKind,
  UsageUpdate,
  UserMessageChunk,
} from "./types.js";

type SessionUpdateStreamItem = SessionUpdateNotification | SessionUpdate;

type MessageUpdate = UserMessageChunk | AgentMessageChunk | AgentThoughtChunk;

export interface ToolCallSummary {
  toolCallId: string;
  title: string;
  kind?: ToolKind;
  status?: ToolCallStatus;
  rawInput?: unknown;
  rawOutput?: unknown;
}

export type LegacyInternalEvent = { event: string } & Record<string, unknown>;

export async function extractMessagesFromSessionUpdateStream(
  stream: AsyncIterable<SessionUpdateStreamItem> | Iterable<SessionUpdateStreamItem>,
): Promise<MessageUpdate[]> {
  const updates: MessageUpdate[] = [];

  for await (const entry of stream) {
    const update = toSessionUpdate(entry);
    if (
      update.sessionUpdate === "user_message_chunk" ||
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_thought_chunk"
    ) {
      updates.push(update);
    }
  }

  return updates;
}

export async function extractUsageFromSessionUpdateStream(
  stream: AsyncIterable<SessionUpdateStreamItem> | Iterable<SessionUpdateStreamItem>,
): Promise<UsageUpdate[]> {
  const updates: UsageUpdate[] = [];

  for await (const entry of stream) {
    const update = toSessionUpdate(entry);
    if (update.sessionUpdate === "usage_update") {
      updates.push(update);
    }
  }

  return updates;
}

export async function extractToolCallSummariesFromSessionUpdateStream(
  stream: AsyncIterable<SessionUpdateStreamItem> | Iterable<SessionUpdateStreamItem>,
): Promise<ToolCallSummary[]> {
  const summaries = new Map<string, ToolCallSummary>();
  const startedToolCallIds = new Set<string>();

  for await (const entry of stream) {
    const update = toSessionUpdate(entry);

    if (update.sessionUpdate === "tool_call") {
      if (startedToolCallIds.has(update.toolCallId)) {
        throw new Error(`Duplicate tool call identifier "${update.toolCallId}".`);
      }
      startedToolCallIds.add(update.toolCallId);

      const summary: ToolCallSummary = {
        toolCallId: update.toolCallId,
        title: update.title,
      };

      if (update.kind !== undefined) {
        summary.kind = update.kind;
      }

      if (update.status !== undefined) {
        summary.status = update.status;
      }

      if (update.rawInput !== undefined) {
        summary.rawInput = update.rawInput;
      }

      if (update.rawOutput !== undefined) {
        summary.rawOutput = update.rawOutput;
      }

      summaries.set(update.toolCallId, summary);
      continue;
    }

    if (update.sessionUpdate === "tool_call_update") {
      const existing = summaries.get(update.toolCallId);
      const summary: ToolCallSummary = existing ?? {
        toolCallId: update.toolCallId,
        title: toTitle(update.title, update.toolCallId),
      };

      if (update.title !== null && update.title !== undefined && update.title.length > 0) {
        summary.title = update.title;
      }

      if (update.kind !== null && update.kind !== undefined) {
        summary.kind = update.kind;
      }

      if (update.status !== null && update.status !== undefined) {
        summary.status = update.status;
      }

      if (update.rawInput !== undefined) {
        summary.rawInput = update.rawInput;
      }

      if (update.rawOutput !== undefined) {
        summary.rawOutput = update.rawOutput;
      }

      summaries.set(update.toolCallId, summary);
    }
  }

  return Array.from(summaries.values());
}

export function mapLegacyEventToSessionUpdates(
  event: LegacyInternalEvent,
): SessionUpdate[] {
  switch (event.event) {
    case "session_start":
      return mapSessionStart(event);
    case "agent_message":
      return mapAgentMessage(event);
    case "reasoning":
      return mapReasoning(event);
    case "tool_start":
      return mapToolStart(event);
    case "tool_complete":
      return mapToolComplete(event);
    case "usage":
      return mapUsage(event);
    default:
      return [];
  }
}

function toSessionUpdate(entry: SessionUpdateStreamItem): SessionUpdate {
  if (typeof (entry as SessionUpdate).sessionUpdate === "string") {
    return entry as SessionUpdate;
  }

  if (isSessionUpdateNotification(entry)) {
    return entry.params.update;
  }

  return entry;
}

function isSessionUpdateNotification(entry: SessionUpdateStreamItem): entry is SessionUpdateNotification {
  return (
    typeof (entry as SessionUpdateNotification).jsonrpc === "string" &&
    (entry as SessionUpdateNotification).method === "session/update" &&
    typeof (entry as SessionUpdateNotification).params?.update?.sessionUpdate === "string"
  );
}

function toTitle(value: string | null | undefined, fallback: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return fallback;
}

function mapSessionStart(event: LegacyInternalEvent): SessionInfoUpdate[] {
  const threadId = readString(event.threadId);
  if (!threadId) {
    return [];
  }

  return [{ sessionUpdate: "session_info_update", _meta: { threadId } }];
}

function mapAgentMessage(event: LegacyInternalEvent): AgentMessageChunk[] {
  const text = readString(event.text);
  if (!text) {
    return [];
  }

  return [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text } }];
}

function mapReasoning(event: LegacyInternalEvent): AgentThoughtChunk[] {
  const text = readString(event.text);
  if (!text) {
    return [];
  }

  return [{ sessionUpdate: "agent_thought_chunk", content: { type: "text", text } }];
}

function mapToolStart(event: LegacyInternalEvent): SessionUpdate[] {
  const toolCallId = readString(event.id) ?? readString(event.toolCallId);
  if (!toolCallId) {
    return [];
  }

  const kind = toToolKind(event.kind);

  const toolCall: ToolCall = {
    sessionUpdate: "tool_call",
    toolCallId,
    title: readString(event.title) ?? toolCallId,
    status: "pending",
  };

  const toolCallUpdate: ToolCallUpdate = {
    sessionUpdate: "tool_call_update",
    toolCallId,
    status: "in_progress",
  };

  if (kind) {
    toolCall.kind = kind;
    toolCallUpdate.kind = kind;
  }

  if (hasOwnProperty(event, "input")) {
    toolCall.rawInput = event.input;
  } else if (hasOwnProperty(event, "rawInput")) {
    toolCall.rawInput = event.rawInput;
  }

  return [toolCall, toolCallUpdate];
}

function mapToolComplete(event: LegacyInternalEvent): ToolCallUpdate[] {
  const toolCallId = readString(event.id) ?? readString(event.toolCallId);
  if (!toolCallId) {
    return [];
  }

  const status = toToolCallStatus(event.status);
  if (event.status !== undefined && status === undefined) {
    return [];
  }

  const toolCallUpdate: ToolCallUpdate = {
    sessionUpdate: "tool_call_update",
    toolCallId,
    status: status ?? "completed",
  };

  const kind = toToolKind(event.kind);
  if (kind) {
    toolCallUpdate.kind = kind;
  }

  if (hasOwnProperty(event, "output")) {
    toolCallUpdate.rawOutput = event.output;
  } else if (hasOwnProperty(event, "path")) {
    toolCallUpdate.rawOutput = event.path;
  } else if (hasOwnProperty(event, "rawOutput")) {
    toolCallUpdate.rawOutput = event.rawOutput;
  }

  return [toolCallUpdate];
}

function mapUsage(event: LegacyInternalEvent): UsageUpdate[] {
  const inputTokens = readTokenCount(event.inputTokens);
  const outputTokens = readTokenCount(event.outputTokens);
  const cachedTokens = readTokenCount(event.cachedTokens);
  const costUsd = readFiniteNumber(event.costUsd);

  if (
    (event.inputTokens !== undefined && inputTokens === undefined) ||
    (event.outputTokens !== undefined && outputTokens === undefined) ||
    (event.cachedTokens !== undefined && cachedTokens === undefined) ||
    (event.costUsd !== undefined && costUsd === undefined)
  ) {
    return [];
  }

  const usage: UsageUpdate = {
    sessionUpdate: "usage_update",
    used: (inputTokens ?? 0) + (outputTokens ?? 0),
    size: (inputTokens ?? 0) + (outputTokens ?? 0) + (cachedTokens ?? 0),
  };

  if (costUsd !== undefined) {
    usage.cost = {
      amount: costUsd,
      currency: "USD",
    };
  }

  return [usage];
}

function toToolKind(value: unknown): ToolKind | undefined {
  if (value === "exec" || value === "execute") {
    return "execute";
  }

  if (value === "read") {
    return "read";
  }

  if (value === "write" || value === "edit" || value === "delete" || value === "move") {
    return "write";
  }

  if (
    value === "other" ||
    value === "search" ||
    value === "think" ||
    value === "fetch" ||
    value === "switch_mode"
  ) {
    return "other";
  }

  return undefined;
}

function toToolCallStatus(value: unknown): ToolCallStatus | undefined {
  if (
    value === "pending" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return undefined;
}

function readTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}
