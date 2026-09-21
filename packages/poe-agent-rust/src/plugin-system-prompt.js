import { loadSystemPromptSync } from "./system-prompt.js";
import { rejectUnknownKeys, toOptionsObject } from "./parse-options.js";
const systemPromptPlugin = () => ({
  name: "poe-agent-plugin-system-prompt",
  prompt(ctx) {
    const bundledSystemPrompt = loadSystemPromptSync();
    if (
      ctx.system === bundledSystemPrompt ||
      (typeof ctx.system === "string" && ctx.system.startsWith(`${bundledSystemPrompt}\n`))
    ) {
      return ctx;
    }
    return {
      ...ctx,
      system: [bundledSystemPrompt, ctx.system].filter(Boolean).join("\n")
    };
  }
});
export const spec = {
  name: "system-prompt",
  parseOptions(input) {
    rejectUnknownKeys(toOptionsObject(input), []);
    return {};
  },
  factory: () => systemPromptPlugin()
};
export default systemPromptPlugin;
