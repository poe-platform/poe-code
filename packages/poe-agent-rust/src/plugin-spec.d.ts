import type { AgentPlugin } from "./plugin-types.js";
export type PluginSpec<Options = unknown> = {
  name: string;
  parseOptions(input: unknown): Options;
  factory(options: Options): AgentPlugin;
};
