export {
  collectProviders,
  resolveProvider,
  DuplicateProviderNameError,
  ProviderResolutionError
} from "./providers.js";
export { InvalidToolNameError } from "./tool-names.js";
export type {
  AgentPlugin,
  Provider,
  ProviderContext,
  ProviderStreamEvent
} from "./plugin-types.js";
export type { ChatMessage, Tool, ToolResult, ToolResultPart } from "./types.js";
export { createAgentSessionStore } from "./session-store.js";
export type { AgentSessionStore, PersistedAgentSession } from "./session-store.js";
export { createMemorySessionStore, createJsonlSessionStore } from "./session-log.js";
export type { SessionStore } from "./session-log.js";
export type { SessionEntry } from "./entry-types.js";
export { normalizeTool, ToolRegistry } from "./tools.js";
export { DuplicateToolError, PluginSetupError, PromptTransformError } from "./errors.js";

export {
  cloneAgentPlugin,
  cloneMcpServerConfig,
  createResolvedAgentConfig,
  toRuntimePlugins,
  resolvePluginSetupOrder
} from "./config.js";
export type { ResolvedAgentConfig } from "./config.js";

export { createFileAwarenessTracker, recordToolFileAwareness } from "./file-awareness.js";
export type { FileAwarenessTracker } from "./file-awareness.js";

export * from "./hooks.js";

export { PromptRegistry } from "./prompts.js";
export type { PromptTransform } from "./prompts.js";
