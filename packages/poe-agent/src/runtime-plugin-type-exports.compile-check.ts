import type {
  AgentPlugin,
  HookDecision,
  IterationContext,
  McpServerConfig,
  NotificationContext,
  PostCompactionContext,
  PreCompactionContext,
  PluginApi,
  PromptContext,
  SessionStartContext,
  StopContext,
  ToolUseContext,
  UserPromptSubmitContext,
} from "./runtime/index.js";
import type {
  AgentPlugin as InternalAgentPlugin,
  HookDecision as InternalHookDecision,
  IterationContext as InternalIterationContext,
  McpServerConfig as InternalMcpServerConfig,
  NotificationContext as InternalNotificationContext,
  PostCompactionContext as InternalPostCompactionContext,
  PreCompactionContext as InternalPreCompactionContext,
  PluginApi as InternalPluginApi,
  PromptContext as InternalPromptContext,
  SessionStartContext as InternalSessionStartContext,
  StopContext as InternalStopContext,
  ToolUseContext as InternalToolUseContext,
  UserPromptSubmitContext as InternalUserPromptSubmitContext,
} from "./runtime/plugin-types.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

type ignoredPublicAgentPluginMatchesInternal = AssertAssignable<
  InternalAgentPlugin,
  AgentPlugin
>;
type ignoredPublicPluginApiMatchesInternal = AssertAssignable<InternalPluginApi, PluginApi>;
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
