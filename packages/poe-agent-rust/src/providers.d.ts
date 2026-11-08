import type { AgentPlugin, Provider } from "./plugin-types.js";
type ProviderResolutionErrorOptions = {
  modelId: string;
  providerNames: string[];
  providerName?: string;
  cause?: unknown;
};
export declare class ProviderResolutionError extends Error {
  readonly modelId: string;
  readonly providerNames: string[];
  readonly providerName?: string;
  constructor(options: ProviderResolutionErrorOptions);
}
export declare class DuplicateProviderNameError extends Error {
  readonly providerName: string;
  readonly pluginEntries: string[];
  constructor(providerName: string, pluginEntries: string[]);
}
export declare function collectProviders(plugins: AgentPlugin[]): Provider[];
export declare function resolveProvider(providers: Provider[], modelId: string): Provider;
