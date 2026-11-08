import type { AgentPlugin } from "../runtime/plugin-types.js";
import { loadSystemPromptSync } from "../system-prompt.js";
import { rejectUnknownKeys, toOptionsObject } from "./parse-options.js";
import type { PluginSpec } from "./registry.js";

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

export type SystemPromptPluginConfigOptions = Record<string, never>;

export const spec: PluginSpec<SystemPromptPluginConfigOptions> = {
  name: "system-prompt",
  parseOptions(input) {
    rejectUnknownKeys(toOptionsObject(input), []);
    return {} as SystemPromptPluginConfigOptions;
  },
  factory: () => systemPromptPlugin(),
};

export default systemPromptPlugin;
