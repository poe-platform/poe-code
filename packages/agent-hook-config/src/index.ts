export type {
  AgentHookConfig,
  AgentSupportResult,
  AgentSupportStatus,
  HookEvent,
  HookFormat,
  HookHandlerType,
  HookScope,
  TransformPair
} from "./configs.js";
export type { HookReadResult, SourceHookEntry } from "./read-hooks-async.js";
export type { EventMapping, HandlerTypeRule, PlaceholderRewrite } from "./event-mapping.js";
export type { GeneratedHookEntry, HookDrop, TransformResult } from "./transform-hooks.js";
export type { WriteResult } from "./write-hooks-async.js";
export type { SymlinkResult } from "./symlink-hooks-async.js";
export type { BridgeHookManifest, BridgeStrategy, BridgeStrategyRequest } from "./bridge-hooks-async.js";

export {
  formatSupportedTransformPairs,
  getAgentConfig,
  isTransformSupported,
  resolveAgentSupport,
  resolveHookPath,
  supportedHookAgents,
  supportedTransformPairs
} from "./configs.js";
export { readClaudeHooks } from "./read-hooks-async.js";
export { getEventMappings, getHandlerTypeRules, getPlaceholderRewrites } from "./event-mapping.js";
export { transformHooks } from "./transform-hooks.js";
export { writeCodexHooks } from "./write-hooks-async.js";
export { symlinkHooks } from "./symlink-hooks-async.js";
export { bridgeHooks, cleanupBridgedHooks } from "./bridge-hooks-async.js";

export type { HookRuntimeOptions } from "./filesystem.js";
