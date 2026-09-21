import type { AgentPlugin } from "./plugin-types.js";
import type { PluginSpec } from "./plugin-spec.js";
declare const systemPromptPlugin: () => AgentPlugin;
export type SystemPromptPluginConfigOptions = Record<string, never>;
export declare const spec: PluginSpec<SystemPromptPluginConfigOptions>;
export default systemPromptPlugin;
