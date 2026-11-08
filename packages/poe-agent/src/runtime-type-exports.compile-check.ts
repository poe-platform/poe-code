import type {
  AcpEvent,
  AcpHost,
  ChatMessage,
  ForkRequest,
  ForkResult,
  NormalizedTool,
  RunContextSnapshot,
  RunOutput,
  RunResult,
  SessionEntry,
  Tool,
  ToolAckResult,
  ToolCallRecord,
  ToolContext,
  ToolEvent,
  ToolIntent,
} from "./runtime/index.js";
import type { SessionUpdate } from "@poe-code/agent-spawn";
import type {
  AcpEvent as InternalAcpEvent,
  AcpHost as InternalAcpHost,
  ChatMessage as InternalChatMessage,
  ForkRequest as InternalForkRequest,
  ForkResult as InternalForkResult,
  NormalizedTool as InternalNormalizedTool,
  RunContextSnapshot as InternalRunContextSnapshot,
  RunOutput as InternalRunOutput,
  RunResult as InternalRunResult,
  Tool as InternalTool,
  ToolAckResult as InternalToolAckResult,
  ToolCallRecord as InternalToolCallRecord,
  ToolContext as InternalToolContext,
  ToolEvent as InternalToolEvent,
  ToolIntent as InternalToolIntent,
} from "./runtime/types.js";
import type { SessionEntry as InternalSessionEntry } from "./runtime/session/entry-types.js";

type AssertAssignable<To, ignoredFrom extends To> = true;
type AssertFalse<ignoredActual extends false> = true;
type IsAssignable<From, To> = [From] extends [To] ? true : false;

type ignoredPublicAcpEventMatchesInternal = AssertAssignable<InternalAcpEvent, AcpEvent>;
type ignoredPublicAcpHostMatchesInternal = AssertAssignable<InternalAcpHost, AcpHost>;
type ignoredPublicToolIntentMatchesInternal = AssertAssignable<InternalToolIntent, ToolIntent>;
type ignoredPublicToolAckResultMatchesInternal = AssertAssignable<
  InternalToolAckResult,
  ToolAckResult
>;
type ignoredPublicForkRequestMatchesInternal = AssertAssignable<InternalForkRequest, ForkRequest>;
type ignoredPublicForkResultMatchesInternal = AssertAssignable<InternalForkResult, ForkResult>;
type ignoredPublicToolContextMatchesInternal = AssertAssignable<InternalToolContext, ToolContext>;
type ignoredPublicToolEventMatchesInternal = AssertAssignable<InternalToolEvent, ToolEvent>;
type ignoredPublicToolMatchesInternal = AssertAssignable<InternalTool, Tool>;
type ignoredPublicNormalizedToolMatchesInternal = AssertAssignable<
  InternalNormalizedTool,
  NormalizedTool
>;
type ignoredPublicRunResultMatchesInternal = AssertAssignable<InternalRunResult, RunResult>;
type ignoredPublicRunOutputMatchesInternal = AssertAssignable<InternalRunOutput, RunOutput>;
type ignoredPublicRunContextSnapshotMatchesInternal = AssertAssignable<
  InternalRunContextSnapshot,
  RunContextSnapshot
>;
type ignoredPublicChatMessageMatchesInternal = AssertAssignable<InternalChatMessage, ChatMessage>;
type ignoredPublicToolCallRecordMatchesInternal = AssertAssignable<
  InternalToolCallRecord,
  ToolCallRecord
>;
type ignoredPublicSessionEntryMatchesInternal = AssertAssignable<
  InternalSessionEntry,
  SessionEntry
>;

type ignoredRuntimeAcpEventIsNotSessionUpdate = AssertFalse<
  IsAssignable<AcpEvent, SessionUpdate>
>;
type ignoredSessionUpdateIsNotRuntimeAcpEvent = AssertFalse<
  IsAssignable<SessionUpdate, AcpEvent>
>;

type ignoredMessageDeltaEventIsAllowed = AssertAssignable<
  AcpEvent,
  { type: "message.delta"; content: string }
>;
type ignoredToolIntentEventIsAllowed = AssertAssignable<
  AcpEvent,
  { type: "tool.intent"; intentId: string; tool: string; args: unknown }
>;
type ignoredToolResultEventIsAllowed = AssertAssignable<
  AcpEvent,
  { type: "tool.result"; intentId: string; result: unknown }
>;
type ignoredToolErrorEventIsAllowed = AssertAssignable<
  AcpEvent,
  { type: "tool.error"; intentId: string; error: string }
>;
type ignoredForkStartEventIsAllowed = AssertAssignable<
  AcpEvent,
  { type: "fork.start"; forkId: string; prompt: string }
>;
type ignoredForkCompleteEventIsAllowed = AssertAssignable<
  AcpEvent,
  { type: "fork.complete"; forkId: string; result: ForkResult }
>;
type ignoredForkErrorEventIsAllowed = AssertAssignable<
  AcpEvent,
  { type: "fork.error"; forkId: string; error: string }
>;
type ignoredProgressEventIsAllowed = AssertAssignable<
  AcpEvent,
  { type: "progress"; message: string }
>;
type ignoredSessionCompleteEventIsAllowed = AssertAssignable<
  AcpEvent,
  { type: "session.complete"; result: RunResult }
>;
type ignoredSessionErrorEventIsAllowed = AssertAssignable<
  AcpEvent,
  { type: "session.error"; error: Error }
>;
