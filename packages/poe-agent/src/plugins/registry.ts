import type { AgentPlugin } from "../runtime/plugin-types.js";
import { spec as compactionPluginSpec } from "./poe-agent-plugin-compaction.js";
import { spec as filesPluginSpec } from "./poe-agent-plugin-files.js";
import { spec as memoryPluginSpec } from "./poe-agent-plugin-memory.js";
import { spec as openaiChatCompletionsSpec } from "./poe-agent-plugin-openai-chat-completions.js";
import { spec as openaiResponsesSpec } from "./poe-agent-plugin-openai-responses.js";
import { spec as policyPluginSpec } from "./poe-agent-plugin-policy.js";
import { spec as shellPluginSpec } from "./poe-agent-plugin-shell.js";
import { spec as systemPromptPluginSpec } from "./poe-agent-plugin-system-prompt.js";
import { spec as webPluginSpec } from "./poe-agent-plugin-web.js";

export type PluginSpec<Options = unknown> = {
  name: string;
  parseOptions: (input: unknown) => Options;
  factory: (options: Options) => AgentPlugin;
};

function immutableSpec<Options>(spec: PluginSpec<Options>): PluginSpec<Options> {
  return Object.freeze(spec);
}

export const builtinPluginRegistry: ReadonlyMap<string, PluginSpec<any>> = new Map<
  string,
  PluginSpec<any>
>([
  [systemPromptPluginSpec.name, immutableSpec(systemPromptPluginSpec)],
  [filesPluginSpec.name, immutableSpec(filesPluginSpec)],
  [shellPluginSpec.name, immutableSpec(shellPluginSpec)],
  [webPluginSpec.name, immutableSpec(webPluginSpec)],
  [memoryPluginSpec.name, immutableSpec(memoryPluginSpec)],
  [openaiResponsesSpec.name, immutableSpec(openaiResponsesSpec)],
  [openaiChatCompletionsSpec.name, immutableSpec(openaiChatCompletionsSpec)],
  [compactionPluginSpec.name, immutableSpec(compactionPluginSpec)],
  [policyPluginSpec.name, immutableSpec(policyPluginSpec)]
]);
