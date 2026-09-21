import type { RunContext } from "./run-context.js";
import type { AcpModel } from "./acp-model.js";
import type {
  AcpEvent,
  AcpHost,
  ForkRequest,
  ForkResult,
  RunOutput,
  ToolIntent,
  ToolAckResult
} from "./types.js";
import type {
  ClientCapabilities,
  InitializeResponse,
  NewSessionResponse,
  ContentBlock,
  McpServer,
  SessionUpdateNotification,
  PromptResponse
} from "./acp-types.js";
export type AgentHostSpawnClient = {
  initialize(clientCapabilities?: ClientCapabilities): Promise<InitializeResponse>;
  newSession(cwd: string, mcpServers: McpServer[]): Promise<NewSessionResponse>;
  prompt(
    sessionId: string,
    content: ContentBlock[]
  ): AsyncIterable<SessionUpdateNotification> & { response: Promise<PromptResponse> };
  dispose(): Promise<void>;
};
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
export declare class AgentHost implements AcpHost {
  constructor(options: AgentHostOptions);
  setEmit(emit: (event: AcpEvent) => void): void;
  handle(intent: ToolIntent): Promise<ToolAckResult>;
  fork(request: ForkRequest): Promise<ForkResult>;
  spawn(prompt: string): Promise<RunOutput>;
}
