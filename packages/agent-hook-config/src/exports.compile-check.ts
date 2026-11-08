import type {
  AgentHookConfig as AgentHookConfigFromConfigs,
  AgentSupportResult as AgentSupportResultFromConfigs,
  AgentSupportStatus as AgentSupportStatusFromConfigs,
  HookEvent as HookEventFromConfigs,
  HookFormat as HookFormatFromConfigs,
  HookHandlerType as HookHandlerTypeFromConfigs,
  HookScope as HookScopeFromConfigs
} from "./configs.js";
import type {
  HookReadResult as HookReadResultFromReader,
  SourceHookEntry as SourceHookEntryFromReader
} from "./read-hooks.js";
import type {
  EventMapping as EventMappingFromMapping,
  HandlerTypeRule as HandlerTypeRuleFromMapping,
  PlaceholderRewrite as PlaceholderRewriteFromMapping
} from "./event-mapping.js";
import type {
  GeneratedHookEntry as GeneratedHookEntryFromTransformer,
  HookDrop as HookDropFromTransformer,
  TransformResult as TransformResultFromTransformer
} from "./transform-hooks.js";
import type { WriteResult as WriteResultFromWriter } from "./write-hooks.js";
import type { SymlinkResult as SymlinkResultFromSymlink } from "./symlink-hooks.js";
import type {
  BridgeHookManifest as BridgeHookManifestFromBridge,
  BridgeStrategy as BridgeStrategyFromBridge
} from "./bridge-hooks.js";
import type {
  AgentHookConfig,
  AgentSupportResult,
  AgentSupportStatus,
  BridgeHookManifest,
  BridgeStrategy,
  EventMapping,
  GeneratedHookEntry,
  HandlerTypeRule,
  HookDrop,
  HookEvent,
  HookFormat,
  HookHandlerType,
  HookReadResult,
  HookScope,
  PlaceholderRewrite,
  SourceHookEntry,
  SymlinkResult,
  TransformResult,
  WriteResult
} from "./index.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

type ignoredHookFormatIsExported = AssertAssignable<HookFormatFromConfigs, HookFormat>;
type ignoredHookEventIsExported = AssertAssignable<HookEventFromConfigs, HookEvent>;
type ignoredHookHandlerTypeIsExported = AssertAssignable<
  HookHandlerTypeFromConfigs,
  HookHandlerType
>;
type ignoredAgentHookConfigIsExported = AssertAssignable<
  AgentHookConfigFromConfigs,
  AgentHookConfig
>;
type ignoredHookScopeIsExported = AssertAssignable<HookScopeFromConfigs, HookScope>;
type ignoredAgentSupportStatusIsExported = AssertAssignable<
  AgentSupportStatusFromConfigs,
  AgentSupportStatus
>;
type ignoredAgentSupportResultIsExported = AssertAssignable<
  AgentSupportResultFromConfigs,
  AgentSupportResult
>;
type ignoredSourceHookEntryIsExported = AssertAssignable<
  SourceHookEntryFromReader,
  SourceHookEntry
>;
type ignoredHookReadResultIsExported = AssertAssignable<HookReadResultFromReader, HookReadResult>;
type ignoredEventMappingIsExported = AssertAssignable<EventMappingFromMapping, EventMapping>;
type ignoredHandlerTypeRuleIsExported = AssertAssignable<
  HandlerTypeRuleFromMapping,
  HandlerTypeRule
>;
type ignoredPlaceholderRewriteIsExported = AssertAssignable<
  PlaceholderRewriteFromMapping,
  PlaceholderRewrite
>;
type ignoredGeneratedHookEntryIsExported = AssertAssignable<
  GeneratedHookEntryFromTransformer,
  GeneratedHookEntry
>;
type ignoredHookDropIsExported = AssertAssignable<HookDropFromTransformer, HookDrop>;
type ignoredTransformResultIsExported = AssertAssignable<
  TransformResultFromTransformer,
  TransformResult
>;
type ignoredWriteResultIsExported = AssertAssignable<WriteResultFromWriter, WriteResult>;
type ignoredSymlinkResultIsExported = AssertAssignable<SymlinkResultFromSymlink, SymlinkResult>;
type ignoredBridgeStrategyIsExported = AssertAssignable<BridgeStrategyFromBridge, BridgeStrategy>;
type ignoredBridgeHookManifestIsExported = AssertAssignable<
  BridgeHookManifestFromBridge,
  BridgeHookManifest
>;

type ignoredSupportedHookAgentsIsExported = typeof import("./index.js").supportedHookAgents;
type ignoredResolveAgentSupportIsExported = typeof import("./index.js").resolveAgentSupport;
type ignoredGetAgentConfigIsExported = typeof import("./index.js").getAgentConfig;
type ignoredResolveHookPathIsExported = typeof import("./index.js").resolveHookPath;
type ignoredReadClaudeHooksIsExported = typeof import("./index.js").readClaudeHooks;
type ignoredGetEventMappingsIsExported = typeof import("./index.js").getEventMappings;
type ignoredGetHandlerTypeRulesIsExported = typeof import("./index.js").getHandlerTypeRules;
type ignoredGetPlaceholderRewritesIsExported = typeof import("./index.js").getPlaceholderRewrites;
type ignoredTransformHooksIsExported = typeof import("./index.js").transformHooks;
type ignoredWriteCodexHooksIsExported = typeof import("./index.js").writeCodexHooks;
type ignoredSymlinkHooksIsExported = typeof import("./index.js").symlinkHooks;
type ignoredBridgeHooksIsExported = typeof import("./index.js").bridgeHooks;
type ignoredCleanupBridgedHooksIsExported = typeof import("./index.js").cleanupBridgedHooks;

// @ts-expect-error agentHookConfigs is internal and must not be exported
type ignoredInternalSymbolIsNotExported = typeof import("./index.js").agentHookConfigs;
