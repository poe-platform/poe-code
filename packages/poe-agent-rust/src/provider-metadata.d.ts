import type { AgentPlugin, Provider } from "./plugin-types.js";
export declare function setResolvedPluginOptions<T extends AgentPlugin>(
  plugin: T,
  options: unknown
): T;
export declare function getResolvedPluginOptions(plugin: AgentPlugin): unknown;
export declare function setResolvedProviderOptions<T extends Provider>(
  provider: T,
  options: unknown
): T;
export declare function getResolvedProviderOptions(provider: Provider): unknown;
