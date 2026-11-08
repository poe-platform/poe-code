import type {
  AgentMessageChunk,
  AgentThoughtChunk,
  SessionUpdate,
  SessionUpdateNotification,
  ToolCallStatus,
  ToolKind,
  UsageUpdate,
  UserMessageChunk
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
export type LegacyInternalEvent = {
  event: string;
} & Record<string, unknown>;
export declare function extractMessagesFromSessionUpdateStream(
  stream: AsyncIterable<SessionUpdateStreamItem> | Iterable<SessionUpdateStreamItem>
): Promise<MessageUpdate[]>;
export declare function extractUsageFromSessionUpdateStream(
  stream: AsyncIterable<SessionUpdateStreamItem> | Iterable<SessionUpdateStreamItem>
): Promise<UsageUpdate[]>;
export declare function extractToolCallSummariesFromSessionUpdateStream(
  stream: AsyncIterable<SessionUpdateStreamItem> | Iterable<SessionUpdateStreamItem>
): Promise<ToolCallSummary[]>;
export declare function mapLegacyEventToSessionUpdates(event: LegacyInternalEvent): SessionUpdate[];
export {};
