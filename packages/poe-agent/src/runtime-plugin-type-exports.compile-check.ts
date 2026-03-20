import type {
  AgentPlugin,
  HookDecision,
  IterationContext,
  McpServerConfig,
  PluginApi,
  PromptContext,
  ToolUseContext,
} from "./runtime/index.js";
import type {
  AgentPlugin as InternalAgentPlugin,
  HookDecision as InternalHookDecision,
  IterationContext as InternalIterationContext,
  McpServerConfig as InternalMcpServerConfig,
  PluginApi as InternalPluginApi,
  PromptContext as InternalPromptContext,
  ToolUseContext as InternalToolUseContext,
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
type ignoredPublicHookDecisionMatchesInternal = AssertAssignable<
  InternalHookDecision,
  HookDecision
>;
