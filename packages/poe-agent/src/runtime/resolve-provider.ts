import type { AgentPlugin, Provider } from "./plugin-types.js";
import { getResolvedPluginOptions, setResolvedProviderOptions } from "./provider-metadata.js";

function formatProviderNames(providerNames: string[]): string {
  return providerNames.length === 0 ? "(none)" : providerNames.join(", ");
}

type ProviderResolutionErrorOptions = {
  modelId: string;
  providerNames: string[];
  providerName?: string;
  cause?: unknown;
};

export class ProviderResolutionError extends Error {
  readonly modelId: string;
  readonly providerNames: string[];
  readonly providerName?: string;

  constructor(options: ProviderResolutionErrorOptions) {
    const message =
      options.providerName === undefined
        ? `No provider supports model "${options.modelId}". Registered providers: ${formatProviderNames(options.providerNames)}.`
        : `Provider "${options.providerName}" failed while resolving model "${options.modelId}". Registered providers: ${formatProviderNames(options.providerNames)}.`;

    super(message, { cause: options.cause });
    this.name = "ProviderResolutionError";
    this.modelId = options.modelId;
    this.providerNames = [...options.providerNames];
    this.providerName = options.providerName;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class DuplicateProviderNameError extends Error {
  readonly providerName: string;
  readonly pluginEntries: string[];

  constructor(providerName: string, pluginEntries: string[]) {
    super(
      `Provider name collision: "${providerName}" is already registered by ${pluginEntries.join(", ")}.`
    );
    this.name = "DuplicateProviderNameError";
    this.providerName = providerName;
    this.pluginEntries = [...pluginEntries];

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export function collectProviders(plugins: AgentPlugin[]): Provider[] {
  const providers: Provider[] = [];
  const providerEntriesByName = new Map<string, string[]>();

  for (const plugin of plugins) {
    if (!plugin.providers || plugin.providers.length === 0) {
      continue;
    }

    for (const [providerIndex, provider] of plugin.providers.entries()) {
      const pluginEntry = `${plugin.name}.providers[${providerIndex}]`;
      const existingEntries = providerEntriesByName.get(provider.name);

      if (existingEntries) {
        throw new DuplicateProviderNameError(provider.name, [...existingEntries, pluginEntry]);
      }

      providerEntriesByName.set(provider.name, [pluginEntry]);
      providers.push(setResolvedProviderOptions(provider, getResolvedPluginOptions(plugin)));
    }
  }

  return providers;
}

export function resolveProvider(providers: Provider[], modelId: string): Provider {
  const providerNames = providers.map((provider) => provider.name);

  for (const provider of providers) {
    let supported: boolean;

    try {
      supported = provider.supports(modelId);
    } catch (error) {
      throw new ProviderResolutionError({
        modelId,
        providerNames,
        providerName: provider.name,
        cause: error
      });
    }

    if (supported) {
      return provider;
    }
  }

  throw new ProviderResolutionError({ modelId, providerNames });
}
