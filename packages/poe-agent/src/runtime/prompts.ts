import type { PromptContext } from "./plugin-types.js";

export type PromptTransform = (ctx: PromptContext) => PromptContext | Promise<PromptContext>;

export class PromptRegistry {
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
        ...(await transform(context)),
        userPrompt,
      };
    }

    return context;
  }
}
