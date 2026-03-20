import type { AgentPlugin } from "../runtime/plugin-types.js";
import { loadSystemPromptSync } from "../system-prompt.js";

const systemPromptPlugin = (): AgentPlugin => ({
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
      system: [bundledSystemPrompt, ctx.system].filter(Boolean).join("\n"),
    };
  },
});

export default systemPromptPlugin;
