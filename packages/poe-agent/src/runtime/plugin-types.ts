import type { ChatMessage, ForkResult, Tool } from "./types.js";
import type { McpSpawnServer } from "@poe-code/agent-spawn";

export type PromptContext = {
  baseSystemPrompt?: string;
  system?: string;
  userPrompt: string;
  metadata?: Record<string, unknown>;
};

export type McpServerConfig = McpSpawnServer & {
  name: string;
  visibility?: "model" | "skill";
};

export type PluginApi = {
  addTool(tool: Tool): void;
  addMcp(config: McpServerConfig): void;
};

export type ToolUseContext = {
  tool: string;
  args: unknown;
  intentId: string;
  result?: unknown;
  error?: string;
  messages: ChatMessage[];
  signal: AbortSignal;
};

export type IterationContext = {
  iterationNumber: number;
  tokenCount: number;
  messages: ChatMessage[];
  signal: AbortSignal;
  fork(prompt: string): Promise<ForkResult>;
};

export type HookDecision = "skip" | "abort" | { reject: string } | void;

export type AgentPlugin = {
  name: string;
  tools?: Tool[];
  prompt?(ctx: PromptContext): PromptContext | Promise<PromptContext>;
  hooks?: {
    preToolUse?(
      ctx: ToolUseContext,
    ): HookDecision | void | Promise<HookDecision | void>;
    postToolUse?(
      ctx: ToolUseContext,
    ): HookDecision | void | Promise<HookDecision | void>;
    preIteration?(
      ctx: IterationContext,
    ): HookDecision | void | Promise<HookDecision | void>;
    postIteration?(
      ctx: IterationContext,
    ): HookDecision | void | Promise<HookDecision | void>;
  };
  setup?(api: PluginApi): void | Promise<void>;
  dispose?(): void | Promise<void>;
};
