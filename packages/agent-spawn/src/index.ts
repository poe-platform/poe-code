import "./register-factories.js";

export const agentSpawn = {};

export {
  runCommand,
  type CommandRunner,
  type CommandRunnerOptions,
  type CommandRunnerResult
} from "./run-command.js";

export { resolveModeConfig } from "./types.js";

export type {
  AcpSpawnConfig,
  CliSpawnConfig,
  FileSpawnConfig,
  InteractiveSpawnConfig,
  SpawnConfig,
  SpawnContext,
  SpawnLogger,
  McpSpawnConfig,
  McpSpawnServer,
  SpawnMode,
  SpawnModeConfig,
  SpawnOptions,
  SpawnResult,
  SpawnUsage,
  AutonomousResult,
  StdinMode
} from "./types.js";

export {
  allSpawnConfigs,
  getAcpSpawnConfig,
  getSpawnConfig,
  listMcpSupportedAgents,
  supportsMcpAtSpawn
} from "./configs/index.js";
export { serializeGooseMcpArgs, serializeOpenCodeMcpEnv } from "./configs/mcp.js";
export {
  buildSpawnArgs,
  isActivityTimeoutError,
  type BuildSpawnArgsOptions,
  type BuildSpawnArgsResult
} from "./spawn.js";
export { spawn } from "./spawn.js";
export { spawnInteractive } from "./spawn-interactive.js";
export { spawnAutonomous } from "./autonomous.js";
export type { AutonomousOptions, StreamingSpawnFn, StreamingSpawnReturn } from "./autonomous.js";

export { renderAcpEvent, renderAcpStream, renderSessionUpdateStream } from "./acp/renderer.js";
export type { LogEntry } from "./acp/replay.js";
export {
  findLatestLog,
  listSpawnLogs,
  pickRandomLog,
  readSpawnLog,
  replaySpawnLog
} from "./acp/replay.js";
export type { SpawnStreamingOptions, SpawnStreamingResult } from "./acp/spawn.js";
export { spawnStreaming } from "./acp/spawn.js";
export type { SpawnAcpOptions, SpawnAcpResult } from "./acp/spawn-acp.js";
export { spawnAcp } from "./acp/spawn-acp.js";
export { readLines } from "./acp/line-reader.js";
export { applyMiddlewares } from "./acp/middleware.js";
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
