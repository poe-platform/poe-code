import type { PromptContext } from "./plugin-types.js";
export type PromptTransform = (ctx: PromptContext) => PromptContext | Promise<PromptContext>;
export declare class PromptRegistry {
  private readonly _state;
  addTransform(fn: PromptTransform): void;
  compile(userPrompt: string, baseSystemPrompt?: string): Promise<PromptContext>;
  copyFrom(registry: PromptRegistry): void;
}
