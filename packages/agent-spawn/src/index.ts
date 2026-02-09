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
  SpawnMode,
  SpawnOptions,
  SpawnResult,
  SpawnUsage,
  StdinMode
} from "./types.js";

export { allSpawnConfigs, getSpawnConfig } from "./configs/index.js";
export { spawn } from "./spawn.js";
export { spawnInteractive } from "./spawn-interactive.js";

export { renderAcpEvent, renderAcpStream } from "./acp/renderer.js";
export type { SpawnStreamingOptions, SpawnStreamingResult } from "./acp/spawn.js";
export { spawnStreaming } from "./acp/spawn.js";
export { readLines } from "./acp/line-reader.js";

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
