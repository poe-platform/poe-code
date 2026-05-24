export type {
  AgentHookConfig,
  AgentSupportResult,
  AgentSupportStatus,
  HookEvent,
  HookFormat,
  HookHandlerType,
  HookScope
} from "./configs.js";
export type { HookReadResult, SourceHookEntry } from "./read-hooks.js";
export type { EventMapping, HandlerTypeRule, PlaceholderRewrite } from "./event-mapping.js";
export type { GeneratedHookEntry, HookDrop, TransformResult } from "./transform-hooks.js";
export type { WriteResult } from "./write-hooks.js";
export type { SymlinkResult } from "./symlink-hooks.js";
export type { BridgeHookManifest, BridgeStrategy } from "./bridge-hooks.js";

export {
  getAgentConfig,
  resolveAgentSupport,
  resolveHookPath,
  supportedHookAgents
} from "./configs.js";
export { readClaudeHooks } from "./read-hooks.js";
export { getEventMappings, getHandlerTypeRules, getPlaceholderRewrites } from "./event-mapping.js";
export { transformHooks } from "./transform-hooks.js";
export { writeCodexHooks } from "./write-hooks.js";
export { symlinkHooks } from "./symlink-hooks.js";
export { bridgeHooks, cleanupBridgedHooks } from "./bridge-hooks.js";
