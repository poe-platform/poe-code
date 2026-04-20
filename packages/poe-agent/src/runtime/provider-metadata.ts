import type { AgentPlugin, Provider } from "./plugin-types.js";

const resolvedPluginOptions = Symbol("resolvedPluginOptions");
const resolvedProviderOptions = Symbol("resolvedProviderOptions");

type AgentPluginWithOptions = AgentPlugin & {
  [resolvedPluginOptions]?: unknown;
};

type ProviderWithOptions = Provider & {
  [resolvedProviderOptions]?: unknown;
};

export function setResolvedPluginOptions<T extends AgentPlugin>(plugin: T, options: unknown): T {
  (plugin as AgentPluginWithOptions)[resolvedPluginOptions] = options;
  return plugin;
}

export function getResolvedPluginOptions(plugin: AgentPlugin): unknown {
  return (plugin as AgentPluginWithOptions)[resolvedPluginOptions];
}

export function setResolvedProviderOptions<T extends Provider>(provider: T, options: unknown): T {
  (provider as ProviderWithOptions)[resolvedProviderOptions] = options;
  return provider;
}

export function getResolvedProviderOptions(provider: Provider): unknown {
  return (provider as ProviderWithOptions)[resolvedProviderOptions];
}
