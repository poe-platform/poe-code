import type { CliSpawnConfig, SpawnConfig, SpawnMode } from "./types.js";
import type { SpawnConfig as SpawnConfigFromIndex } from "./index.js";
import type { AdapterType } from "./adapters/index.js";
import type {
  AcpEvent,
  AgentMessageChunk,
  AgentMessageEvent,
  AgentThoughtChunk,
  ContentChunk,
  ErrorEvent,
  KnownAcpEvent,
  ReasoningEvent,
  SessionStartEvent,
  SessionUpdate,
  ToolCall,
  ToolCallStatus,
  ToolCallUpdate,
  ToolCompleteEvent,
  ToolKind,
  ToolStartEvent,
  UnknownAcpEvent,
  UsageEvent
} from "./index.js";
import type {
  AcpEvent as AcpEventFromAcpTypes,
  AgentMessageChunk as AgentMessageChunkFromAcpTypes,
  AgentMessageEvent as AgentMessageEventFromAcpTypes,
  AgentThoughtChunk as AgentThoughtChunkFromAcpTypes,
  ContentChunk as ContentChunkFromAcpTypes,
  ErrorEvent as ErrorEventFromAcpTypes,
  KnownAcpEvent as KnownAcpEventFromAcpTypes,
  ReasoningEvent as ReasoningEventFromAcpTypes,
  SessionStartEvent as SessionStartEventFromAcpTypes,
  SessionUpdate as SessionUpdateFromAcpTypes,
  ToolCall as ToolCallFromAcpTypes,
  ToolCallStatus as ToolCallStatusFromAcpTypes,
  ToolCallUpdate as ToolCallUpdateFromAcpTypes,
  ToolCompleteEvent as ToolCompleteEventFromAcpTypes,
  ToolKind as ToolKindFromAcpTypes,
  ToolStartEvent as ToolStartEventFromAcpTypes,
  UnknownAcpEvent as UnknownAcpEventFromAcpTypes,
  UsageEvent as UsageEventFromAcpTypes
} from "./acp/types.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

type ignoredSpawnConfigIsExported = AssertAssignable<SpawnConfig, SpawnConfigFromIndex>;

type ignoredAcpEventIsExported = AssertAssignable<AcpEventFromAcpTypes, AcpEvent>;
type ignoredAcpEventMatchesAcpTypes = AssertAssignable<AcpEvent, AcpEventFromAcpTypes>;
type ignoredSessionUpdateIsExported = AssertAssignable<SessionUpdateFromAcpTypes, SessionUpdate>;
type ignoredSessionUpdateMatchesAcpTypes = AssertAssignable<SessionUpdate, SessionUpdateFromAcpTypes>;
type ignoredToolKindIsExported = AssertAssignable<ToolKindFromAcpTypes, ToolKind>;
type ignoredToolKindMatchesAcpTypes = AssertAssignable<ToolKind, ToolKindFromAcpTypes>;
type ignoredToolCallStatusIsExported = AssertAssignable<ToolCallStatusFromAcpTypes, ToolCallStatus>;
type ignoredToolCallStatusMatchesAcpTypes = AssertAssignable<ToolCallStatus, ToolCallStatusFromAcpTypes>;
type ignoredContentChunkIsExported = AssertAssignable<ContentChunkFromAcpTypes, ContentChunk>;
type ignoredContentChunkMatchesAcpTypes = AssertAssignable<ContentChunk, ContentChunkFromAcpTypes>;
type ignoredAgentMessageChunkIsExported = AssertAssignable<AgentMessageChunkFromAcpTypes, AgentMessageChunk>;
type ignoredAgentMessageChunkMatchesAcpTypes = AssertAssignable<AgentMessageChunk, AgentMessageChunkFromAcpTypes>;
type ignoredAgentThoughtChunkIsExported = AssertAssignable<AgentThoughtChunkFromAcpTypes, AgentThoughtChunk>;
type ignoredAgentThoughtChunkMatchesAcpTypes = AssertAssignable<AgentThoughtChunk, AgentThoughtChunkFromAcpTypes>;
type ignoredToolCallIsExported = AssertAssignable<ToolCallFromAcpTypes, ToolCall>;
type ignoredToolCallMatchesAcpTypes = AssertAssignable<ToolCall, ToolCallFromAcpTypes>;
type ignoredToolCallUpdateIsExported = AssertAssignable<ToolCallUpdateFromAcpTypes, ToolCallUpdate>;
type ignoredToolCallUpdateMatchesAcpTypes = AssertAssignable<ToolCallUpdate, ToolCallUpdateFromAcpTypes>;
type ignoredSessionStartEventIsExported = AssertAssignable<SessionStartEventFromAcpTypes, SessionStartEvent>;
type ignoredSessionStartEventMatchesAcpTypes = AssertAssignable<SessionStartEvent, SessionStartEventFromAcpTypes>;
type ignoredAgentMessageEventIsExported = AssertAssignable<AgentMessageEventFromAcpTypes, AgentMessageEvent>;
type ignoredAgentMessageEventMatchesAcpTypes = AssertAssignable<AgentMessageEvent, AgentMessageEventFromAcpTypes>;
type ignoredToolStartEventIsExported = AssertAssignable<ToolStartEventFromAcpTypes, ToolStartEvent>;
type ignoredToolStartEventMatchesAcpTypes = AssertAssignable<ToolStartEvent, ToolStartEventFromAcpTypes>;
type ignoredToolCompleteEventIsExported = AssertAssignable<ToolCompleteEventFromAcpTypes, ToolCompleteEvent>;
type ignoredToolCompleteEventMatchesAcpTypes = AssertAssignable<ToolCompleteEvent, ToolCompleteEventFromAcpTypes>;
type ignoredReasoningEventIsExported = AssertAssignable<ReasoningEventFromAcpTypes, ReasoningEvent>;
type ignoredReasoningEventMatchesAcpTypes = AssertAssignable<ReasoningEvent, ReasoningEventFromAcpTypes>;
type ignoredUsageEventIsExported = AssertAssignable<UsageEventFromAcpTypes, UsageEvent>;
type ignoredUsageEventMatchesAcpTypes = AssertAssignable<UsageEvent, UsageEventFromAcpTypes>;
type ignoredErrorEventIsExported = AssertAssignable<ErrorEventFromAcpTypes, ErrorEvent>;
type ignoredErrorEventMatchesAcpTypes = AssertAssignable<ErrorEvent, ErrorEventFromAcpTypes>;
type ignoredKnownAcpEventIsExported = AssertAssignable<KnownAcpEventFromAcpTypes, KnownAcpEvent>;
type ignoredKnownAcpEventMatchesAcpTypes = AssertAssignable<KnownAcpEvent, KnownAcpEventFromAcpTypes>;
type ignoredUnknownAcpEventIsExported = AssertAssignable<UnknownAcpEventFromAcpTypes, UnknownAcpEvent>;
type ignoredUnknownAcpEventMatchesAcpTypes = AssertAssignable<UnknownAcpEvent, UnknownAcpEventFromAcpTypes>;

type ignoredCliSpawnConfigHasPromptFlag = AssertAssignable<
  CliSpawnConfig,
  {
    kind: "cli";
    agentId: string;
    adapter: AdapterType;
    promptFlag: string;
    defaultArgs: string[];
    modes: Record<SpawnMode, string[]>;
  }
>;

// @ts-expect-error promptFlag is required on CliSpawnConfig
type ignoredCliSpawnConfigMissingPromptFlag = AssertAssignable<CliSpawnConfig, { kind: "cli"; agentId: string; defaultArgs: string[] }>;

// @ts-expect-error adapter is required on CliSpawnConfig
type ignoredCliSpawnConfigMissingAdapter = AssertAssignable<CliSpawnConfig, { kind: "cli"; agentId: string; promptFlag: string; defaultArgs: string[] }>;

// resumeCommand property exists on CliSpawnConfig with correct signature
type ignoredResumeCommandType = AssertAssignable<
  ((threadId: string, cwd: string) => string[]) | undefined,
  CliSpawnConfig["resumeCommand"]
>;
