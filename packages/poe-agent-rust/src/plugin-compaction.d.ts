import type { AgentPlugin, IterationCompactionOptions } from "./plugin-types.js";
import type { PluginSpec } from "./plugin-spec.js";
export type CompactionPluginOptions = Pick<
  IterationCompactionOptions,
  "threshold" | "contextWindow" | "keepLastTurns" | "summarise"
>;
declare const compactionPlugin: (options?: CompactionPluginOptions) => AgentPlugin;
export default compactionPlugin;
export type CompactionPluginConfigOptions = Pick<
  CompactionPluginOptions,
  "threshold" | "contextWindow" | "keepLastTurns"
>;
export declare const spec: PluginSpec<CompactionPluginConfigOptions>;
