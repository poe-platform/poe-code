import { AcpClient, type AcpTransportClosedEvent, type McpServer } from "./acp/index.js";
import { type AgentSession, type CreateAgentSessionOptions } from "./agent-session.js";
import type { SpawnMode } from "./spawn-types.js";
import { type AcpModel } from "./acp-model.js";
import { type RunContext } from "./run-context.js";
import type {
  AcpEvent,
  AcpHost,
  ForkRequest,
  ForkResult,
  RunOutput,
  ToolAckResult,
  ToolIntent
} from "./types.js";
type InMemorySession = Pick<AgentSession, "sendMessage" | "dispose">;
type InMemoryCreateSession = (options: CreateAgentSessionOptions) => Promise<InMemorySession>;
type InMemoryNotificationHandler = (
  params: unknown,
  context: {
    method: string;
  }
) => void | Promise<void>;
type InMemoryRequestHandler = (
  params: unknown,
  context: {
    id: string | number | null;
    method: string;
  }
) => unknown | Promise<unknown>;
type InMemoryAcpTransport = {
  closed: Promise<AcpTransportClosedEvent>;
  sendRequest<TResult = unknown>(method: string, params?: unknown): Promise<TResult>;
  sendNotification(method: string, params?: unknown): void;
  onRequest(method: string, handler: InMemoryRequestHandler): void;
  onNotification(method: string, handler: InMemoryNotificationHandler): void;
  dispose(reason?: Error): void;
};
export type AgentHostSpawnClient = Pick<
  AcpClient,
  "initialize" | "newSession" | "prompt" | "dispose"
>;
export type AgentHostSpawnSession = {
  client: AgentHostSpawnClient;
  cwd: string;
  mcpServers?: McpServer[];
};
export type AgentHostOptions = {
  runContext: RunContext;
  model: AcpModel;
  baseSystemPrompt?: string;
  maxIterations?: number;
  emit?(event: AcpEvent): void;
  createSpawnSession(): AgentHostSpawnSession | Promise<AgentHostSpawnSession>;
};
export type CreateProcessSpawnSessionOptions = {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};
export type CreateInMemorySpawnSessionOptions = {
  model: string;
  cwd: string;
  mode?: SpawnMode;
  baseUrl?: string;
  mcpServers?: CreateAgentSessionOptions["mcpServers"];
  createSession?: InMemoryCreateSession;
};
export declare class AgentHost implements AcpHost {
  #private;
  constructor(options: AgentHostOptions);
  setEmit(emit: (event: AcpEvent) => void): void;
  handle(intent: ToolIntent): Promise<ToolAckResult>;
  fork(request: ForkRequest): Promise<ForkResult>;
  spawn(prompt: string): Promise<RunOutput>;
}
export declare function createProcessSpawnSession(
  options: CreateProcessSpawnSessionOptions
): AgentHostSpawnSession;
export declare function createInMemorySpawnSession(
  options: CreateInMemorySpawnSessionOptions
): AgentHostSpawnSession;
export declare function createInMemoryAcpTransport(
  options: CreateInMemorySpawnSessionOptions
): InMemoryAcpTransport;
export {};
