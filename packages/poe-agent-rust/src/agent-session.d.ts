import type { SessionUpdate } from "./session-update-types.js";
import type { SpawnMode } from "./spawn-types.js";
import { type AgentRunOptions } from "./agent.js";
import { type PluginConfigEntry } from "./resolve-plugins.js";
import type { AgentPlugin } from "./plugin-types.js";
import type { SessionEntry } from "./entry-types.js";
import type { ChatMessage } from "./types.js";
export interface AgentSession {
  readonly id: string;
  sendMessage(prompt: string, options?: AgentSessionSendMessageOptions): Promise<ChatMessage>;
  getHistory(): ChatMessage[];
  tree(): SessionEntry[];
  fork(fromEntryId: string): Promise<AgentSession>;
  navigateTo(entryId: string): Promise<void>;
  dispose(): Promise<void>;
}
export interface AgentSessionSendMessageOptions {
  signal?: AbortSignal;
  onSessionUpdate?: SessionUpdateCallback;
}
export type SessionUpdateCallback = (update: SessionUpdate) => void;
export interface McpStdioServerDefinition {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
export interface McpHttpServerDefinition {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}
export type McpServerDefinition = McpStdioServerDefinition | McpHttpServerDefinition;
export interface CreateAgentSessionOptions {
  model?: string;
  apiKey?: string;
  cwd?: string;
  allowedPaths?: string[];
  plugins?: AgentPlugin[];
  pluginsConfig?: PluginConfigEntry[];
  mcpServers?: Record<string, McpServerDefinition>;
  baseUrl?: string;
  fetch?: AgentRunOptions["fetch"];
  maxToolCallIterations?: number;
  mode?: SpawnMode;
  resume?: {
    messages: ChatMessage[];
  };
  env?: Record<string, string | undefined>;
  persist?: {
    directory: string;
  };
}
export declare function createAgentSession(
  options?: CreateAgentSessionOptions
): Promise<AgentSession>;
