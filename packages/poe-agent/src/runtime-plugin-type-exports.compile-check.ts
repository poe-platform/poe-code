import type {
  AgentPlugin,
  CompactSummarise,
  FileAwareness,
  HookDecision,
  InputDecision,
  IterationContext,
  Logger,
  McpServerConfig,
  NotificationContext,
  PostCompactionContext,
  PreCompactionContext,
  PluginApi,
  Provider,
  ProviderContext,
  PromptContext,
  SessionStartContext,
  StopContext,
  ToolCallDecision,
  ToolResultDecision,
  ToolUseContext,
  UserPromptSubmitContext,
} from "./runtime/index.js";
import type {
  AgentPlugin as InternalAgentPlugin,
  CompactSummarise as InternalCompactSummarise,
  FileAwareness as InternalFileAwareness,
  HookDecision as InternalHookDecision,
  InputDecision as InternalInputDecision,
  IterationContext as InternalIterationContext,
  Logger as InternalLogger,
  McpServerConfig as InternalMcpServerConfig,
  NotificationContext as InternalNotificationContext,
  PostCompactionContext as InternalPostCompactionContext,
  PreCompactionContext as InternalPreCompactionContext,
  PluginApi as InternalPluginApi,
  Provider as InternalProvider,
  ProviderContext as InternalProviderContext,
  PromptContext as InternalPromptContext,
  SessionStartContext as InternalSessionStartContext,
  StopContext as InternalStopContext,
  ToolCallDecision as InternalToolCallDecision,
  ToolResultDecision as InternalToolResultDecision,
  ToolUseContext as InternalToolUseContext,
  UserPromptSubmitContext as InternalUserPromptSubmitContext,
} from "./runtime/plugin-types.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

type ignoredPublicAgentPluginMatchesInternal = AssertAssignable<
  InternalAgentPlugin,
  AgentPlugin
>;
type ignoredPublicPluginApiMatchesInternal = AssertAssignable<InternalPluginApi, PluginApi>;
type ignoredPublicProviderMatchesInternal = AssertAssignable<InternalProvider, Provider>;
type ignoredPublicProviderContextMatchesInternal = AssertAssignable<
  InternalProviderContext,
  ProviderContext
>;
type ignoredPublicLoggerMatchesInternal = AssertAssignable<InternalLogger, Logger>;
type ignoredPublicMcpServerConfigMatchesInternal = AssertAssignable<
  InternalMcpServerConfig,
  McpServerConfig
>;
type ignoredPublicPromptContextMatchesInternal = AssertAssignable<
  InternalPromptContext,
  PromptContext
>;
type ignoredPublicToolUseContextMatchesInternal = AssertAssignable<
  InternalToolUseContext,
  ToolUseContext
>;
type ignoredPublicIterationContextMatchesInternal = AssertAssignable<
  InternalIterationContext,
  IterationContext
>;
type ignoredPublicSessionStartContextMatchesInternal = AssertAssignable<
  InternalSessionStartContext,
  SessionStartContext
>;
type ignoredPublicUserPromptSubmitContextMatchesInternal = AssertAssignable<
  InternalUserPromptSubmitContext,
  UserPromptSubmitContext
>;
type ignoredPublicPreCompactionContextMatchesInternal = AssertAssignable<
  InternalPreCompactionContext,
  PreCompactionContext
>;
type ignoredPublicPostCompactionContextMatchesInternal = AssertAssignable<
  InternalPostCompactionContext,
  PostCompactionContext
>;
type ignoredPublicNotificationContextMatchesInternal = AssertAssignable<
  InternalNotificationContext,
  NotificationContext
>;
type ignoredPublicStopContextMatchesInternal = AssertAssignable<
  InternalStopContext,
  StopContext
>;
type ignoredPublicHookDecisionMatchesInternal = AssertAssignable<
  InternalHookDecision,
  HookDecision
>;
type ignoredPublicToolCallDecisionMatchesInternal = AssertAssignable<
  InternalToolCallDecision,
  ToolCallDecision
>;
type ignoredPublicToolResultDecisionMatchesInternal = AssertAssignable<
  InternalToolResultDecision,
  ToolResultDecision
>;
type ignoredPublicInputDecisionMatchesInternal = AssertAssignable<
  InternalInputDecision,
  InputDecision
>;
type ignoredPublicFileAwarenessMatchesInternal = AssertAssignable<
  InternalFileAwareness,
  FileAwareness
>;
type ignoredPublicCompactSummariseMatchesInternal = AssertAssignable<
  InternalCompactSummarise,
  CompactSummarise
>;
