import type { AgentRuntime } from "./filesystem.js";
import type { PromptContext } from "./plugin-types.js";

export type PromptTransform = (ctx: PromptContext, runtime?: AgentRuntime) => PromptContext | Promise<PromptContext>;

export class PromptRegistry {
  constructor(readonly runtime?: AgentRuntime) {}

  readonly #transforms: PromptTransform[] = [];

  addTransform(fn: PromptTransform): void {
    this.#transforms.push(fn);
  }

  async compile(userPrompt: string, baseSystemPrompt?: string): Promise<PromptContext> {
    let context: PromptContext = {
      userPrompt,
      ...(baseSystemPrompt === undefined
        ? {}
        : {
            baseSystemPrompt,
            system: baseSystemPrompt,
          }),
    };

    for (const transform of this.#transforms) {
      context = {
        ...(await transform(context, this.runtime)),
        userPrompt,
      };
    }

    return context;
  }

  copyFrom(registry: PromptRegistry): void {
    this.#transforms.push(...registry.#transforms);
  }
}
