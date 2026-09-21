import { HookRegistry } from "./hooks.js";
import type { FileAwarenessTracker } from "./file-awareness.js";
import type { McpServerConfig } from "./plugin-types.js";
import { PromptRegistry } from "./prompts.js";
import { ToolRegistry } from "./tools.js";
import type { ChatMessage } from "./types.js";
export type DisposeHook = () => void | Promise<void>;
export type RunContextLogger = { error(message: string, error?: unknown): void };
export type CreateRunContextOptions = {
  activeSkills?: string[];
  logger?: RunContextLogger;
  cwd?: string;
  fileAwareness?: FileAwarenessTracker;
};
export declare class RunContext {
  private readonly _state;
  readonly messages: ChatMessage[];
  readonly tools: ToolRegistry;
  readonly prompts: PromptRegistry;
  readonly hooks: HookRegistry;
  readonly session: Map<string, unknown>;
  readonly mcpServers: McpServerConfig[];
  readonly activeSkills: string[];
  readonly fileAwareness: FileAwarenessTracker;
  readonly abortController: AbortController;
  readonly childRuns: Set<Promise<unknown>>;
  constructor(options?: CreateRunContextOptions);
  get logger(): RunContextLogger;
  registerDisposeHook(hook: DisposeHook): void;
  trackChildRun<T>(childRun: Promise<T>): Promise<T>;
  getChildRunCount(): number;
  dispose(): Promise<void>;
}
export declare function createRunContext(options?: CreateRunContextOptions): RunContext;
