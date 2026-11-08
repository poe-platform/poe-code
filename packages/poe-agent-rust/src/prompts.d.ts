import type { AgentRuntime } from "@poe-code/poe-agent";
import type { PromptContext } from "./plugin-types.js";
export type PromptTransform = (ctx: PromptContext, runtime?: AgentRuntime) => PromptContext | Promise<PromptContext>;
export declare class PromptRegistry {
  constructor(runtime?: AgentRuntime);
  readonly runtime?: AgentRuntime;
  private readonly _state;
  addTransform(fn: PromptTransform): void;
  compile(userPrompt: string, baseSystemPrompt?: string): Promise<PromptContext>;
  copyFrom(registry: PromptRegistry): void;
}
