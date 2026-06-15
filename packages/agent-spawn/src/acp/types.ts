/**
 * ACP-related types used by `agent-spawn`.
 *
 * We intentionally keep these types *structurally compatible* with the official ACP schema (but do not
 * depend on ACP packages) so we can move closer to full ACP compliance later without rewriting adapters.
 *
 * This file contains two related shapes:
 * - `SessionUpdate` types (`tool_call`, `tool_call_update`, etc.) which mirror the official ACP schema.
 * - `AcpEvent` (our internal rendering stream), which is *not* full ACP and uses a simplified vocabulary
 *   for clearer semantics in the UI.
 *
 * Note: The official ACP docs/spec live at:
 * - https://agentclientprotocol.com/
 * - https://github.com/agentclientprotocol/agent-client-protocol
 *
 * TODO: Consider full ACP alignment (JSON-RPC, official discriminators, `execute` tool kind) if we need
 * interop with Zed/JetBrains/other ACP clients.
 */
export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

/** ACP-compatible type - @see https://agentclientprotocol.com/ - no package dependency, structural compatibility only */
export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";

/** ACP-compatible type - @see https://agentclientprotocol.com/ - no package dependency, structural compatibility only */
export interface ContentChunk {
  type: "text";
  text: string;
}

/** ACP-compatible type - @see https://agentclientprotocol.com/ - no package dependency, structural compatibility only */
export interface AgentMessageChunk {
  sessionUpdate: "agent_message_chunk";
  content: ContentChunk;
}

/** ACP-compatible type - @see https://agentclientprotocol.com/ - no package dependency, structural compatibility only */
export interface AgentThoughtChunk {
  sessionUpdate: "agent_thought_chunk";
  content: ContentChunk;
}

/** ACP-compatible type - @see https://agentclientprotocol.com/ - no package dependency, structural compatibility only */
export interface ToolCall {
  sessionUpdate: "tool_call";
  toolCallId: string;
  title: string;
  content?: ToolCallContent[];
  kind?: ToolKind;
  locations?: ToolCallLocation[];
  status?: ToolCallStatus;
  rawInput?: unknown;
  rawOutput?: unknown;
  _meta?: Record<string, unknown>;
}

/** ACP-compatible type - @see https://agentclientprotocol.com/ - no package dependency, structural compatibility only */
export type ToolCallContent =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string };

/** ACP-compatible type - @see https://agentclientprotocol.com/ - no package dependency, structural compatibility only */
export interface ToolCallLocation {
  path: string;
  lineNumber?: number | null;
  _meta?: Record<string, unknown>;
}

/** ACP-compatible type - @see https://agentclientprotocol.com/ - no package dependency, structural compatibility only */
export interface ToolCallUpdate {
  sessionUpdate: "tool_call_update";
  toolCallId: string;
  kind?: ToolKind;
  status?: ToolCallStatus | null;
  rawOutput?: unknown;
  rawInput?: unknown;
  content?: ToolCallContent[] | null;
  locations?: ToolCallLocation[] | null;
  title?: string | null;
  _meta?: Record<string, unknown>;
}

/** ACP-compatible type - @see https://agentclientprotocol.com/ - no package dependency, structural compatibility only */
export interface UsageUpdate {
  sessionUpdate: "usage_update";
  used: number;
  size: number;
  cost?: { amount: number; currency: string };
  _meta?: Record<string, unknown>;
}

/** ACP-compatible type - @see https://agentclientprotocol.com/ - no package dependency, structural compatibility only */
export type SessionUpdate =
  | AgentMessageChunk
  | AgentThoughtChunk
  | ToolCall
  | ToolCallUpdate
  | UsageUpdate;

export interface SessionStartEvent {
  event: "session_start";
  threadId?: string;
  _meta?: Record<string, unknown>;
}

export interface AgentMessageEvent {
  event: "agent_message";
  text: string;
  _meta?: Record<string, unknown>;
}

/**
 * Internal event representing the start of a tool invocation.
 *
 * ACP models tools via `tool_call` and subsequent `tool_call_update` messages. We instead emit a clearer
 * pair of events (`tool_start` / `tool_complete`) because our renderer wants an explicit lifecycle with
 * unambiguous "start" vs "done" semantics.
 *
 * @see https://agentclientprotocol.com/protocol/tool-calls - we use simplified internal format
 */
export interface ToolStartEvent {
  event: "tool_start";
  /**
   * Tool kind for rendering/logging.
   *
   * Note: our internal stream uses `"exec"` instead of ACP `"execute"` for brevity. This is intentionally
   * not typed as `ToolKind` to avoid implying full ACP compliance.
   */
  kind: string;
  title: string;
  id?: string;
  _meta?: Record<string, unknown>;
}

/**
 * Internal event representing completion of a tool invocation.
 *
 * This corresponds conceptually to an ACP `tool_call_update` whose status is terminal (`completed`/`failed`),
 * but is intentionally simpler for UI consumption.
 */
export interface ToolCompleteEvent {
  event: "tool_complete";
  kind: string;
  path: string;
  id?: string;
  _meta?: Record<string, unknown>;
}

export interface ReasoningEvent {
  event: "reasoning";
  text: string;
  _meta?: Record<string, unknown>;
}

export interface UsageEvent {
  event: "usage";
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  costUsd?: number;
  _meta?: Record<string, unknown>;
}

export interface ErrorEvent {
  event: "error";
  message: string;
  stack?: string;
  _meta?: Record<string, unknown>;
}

/** Emitted when auto mode rejects an agent permission request, so the rejection is visible as the cause. */
export interface PermissionRejectedEvent {
  event: "permission_rejected";
  title: string;
  _meta?: Record<string, unknown>;
}

export interface SpawnResultEvent {
  event: "spawn_result";
  exitCode: number;
  threadId?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    costUsd?: number;
  };
  protocolVersion?: number;
  _meta?: Record<string, unknown>;
}

export type KnownAcpEvent =
  | SessionStartEvent
  | AgentMessageEvent
  | ToolStartEvent
  | ToolCompleteEvent
  | ReasoningEvent
  | UsageEvent
  | ErrorEvent
  | PermissionRejectedEvent
  | SpawnResultEvent;

export type UnknownAcpEvent = { event: string } & Record<string, unknown>;

export type AcpEvent = KnownAcpEvent | UnknownAcpEvent;
