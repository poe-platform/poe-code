export const agentSpawn = {};

export {
  runCommand,
  type CommandRunner,
  type CommandRunnerOptions,
  type CommandRunnerResult
} from "./run-command.js";

export type {
  CliSpawnConfig,
  FileSpawnConfig,
  InteractiveSpawnConfig,
  SpawnConfig,
  SpawnContext,
  SpawnLogger,
  McpSpawnConfig,
  McpSpawnServer,
  SpawnMode,
  SpawnOptions,
  SpawnResult,
  SpawnUsage,
  StdinMode
} from "./types.js";

export {
  allSpawnConfigs,
  getSpawnConfig,
  listMcpSupportedAgents,
  supportsMcpAtSpawn
} from "./configs/index.js";
export { serializeOpenCodeMcpEnv } from "./configs/mcp.js";
export {
  buildSpawnArgs,
  isActivityTimeoutError,
  type BuildSpawnArgsOptions,
  type BuildSpawnArgsResult
} from "./spawn.js";
export { spawn } from "./spawn.js";
export { spawnInteractive } from "./spawn-interactive.js";

export { renderAcpEvent, renderAcpStream } from "./acp/renderer.js";
export type { SpawnStreamingOptions, SpawnStreamingResult } from "./acp/spawn.js";
export { spawnStreaming } from "./acp/spawn.js";
export { readLines } from "./acp/line-reader.js";
export {
  applyMiddlewares
} from "./acp/middleware.js";
export type {
  AcpMiddleware,
  SessionResult,
  SessionToolCall,
  SpawnContext as AcpSpawnContext
} from "./acp/middleware.js";
export { sessionCapture } from "./acp/middlewares/session-capture.js";
export { usageCapture } from "./acp/middlewares/usage-capture.js";
export { spawnLog } from "./acp/middlewares/spawn-log.js";

export type {
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
  SpawnResultEvent,
  ToolCall,
  ToolCallStatus,
  ToolCallUpdate,
  ToolCompleteEvent,
  ToolKind,
  ToolStartEvent,
  UnknownAcpEvent,
  UsageEvent
} from "./acp/types.js";

export { adaptClaude, adaptCodex, adaptNative, getAdapter } from "./adapters/index.js";
