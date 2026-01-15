import type {
  ProviderService,
  ProviderContext,
  ProviderBranding,
  ProviderConfigurePrompts,
  ProviderIsolatedEnv
} from "../cli/service-registry.js";
import {
  createServiceManifest,
  type ServiceManifestDefinition
} from "../services/service-manifest.js";
import {
  runServiceInstall,
  type ServiceInstallDefinition
} from "../services/service-install.js";

interface ManifestVersionDefinition<ConfigureOptions, UnconfigureOptions> {
  configure: ServiceManifestDefinition<ConfigureOptions, UnconfigureOptions>["configure"];
  unconfigure?: ServiceManifestDefinition<ConfigureOptions, UnconfigureOptions>["unconfigure"];
}

interface CreateProviderOptions<
  ConfigureOptions,
  UnconfigureOptions,
  SpawnOptions
> {
  name: string;
  aliases?: string[];
  label: string;
  id: string;
  summary: string;
  branding?: ProviderBranding;
  disabled?: boolean;
  supportsStdinPrompt?: boolean;
  configurePrompts?: ProviderConfigurePrompts;
  postConfigureMessages?: string[];
  isolatedEnv?: ProviderIsolatedEnv;
  manifest: ManifestVersionDefinition<ConfigureOptions, UnconfigureOptions>;
  install?: ServiceInstallDefinition;
  test?: ProviderService<ConfigureOptions, UnconfigureOptions, SpawnOptions>["test"];
  spawn?: ProviderService<
    ConfigureOptions,
    UnconfigureOptions,
    SpawnOptions
  >["spawn"];
}

export function createProvider<
  ConfigureOptions = any,
  UnconfigureOptions = ConfigureOptions,
  SpawnOptions = any
>(
  options: CreateProviderOptions<ConfigureOptions, UnconfigureOptions, SpawnOptions>
): ProviderService<ConfigureOptions, UnconfigureOptions, SpawnOptions> {
  const manifest = createServiceManifest({
    id: options.id,
    summary: options.summary,
    configure: options.manifest.configure,
    unconfigure: options.manifest.unconfigure
  });

  const provider: ProviderService<
    ConfigureOptions,
    UnconfigureOptions,
    SpawnOptions
  > = {
    id: options.id,
    summary: options.summary,
    name: options.name,
    aliases: options.aliases,
    label: options.label,
    branding: options.branding,
    disabled: options.disabled,
    supportsStdinPrompt: options.supportsStdinPrompt,
    configurePrompts: options.configurePrompts,
    postConfigureMessages: options.postConfigureMessages,
    isolatedEnv: options.isolatedEnv,
    async configure(context, runOptions) {
      await manifest.configure(context, runOptions);
    },
    async unconfigure(context, runOptions) {
      return manifest.unconfigure(context, runOptions);
    }
  };

  if (options.install) {
    provider.install = createInstallRunner(options.install);
  }

  if (options.test) {
    provider.test = options.test;
  }

  if (options.spawn) {
    provider.spawn = options.spawn;
  }

  return provider;
}

function createInstallRunner(definition: ServiceInstallDefinition) {
  return async (context: ProviderContext): Promise<void> => {
    await runServiceInstall(definition, {
      isDryRun: context.logger.context.dryRun,
      runCommand: context.command.runCommand,
      logger: (message) => context.logger.verbose(message)
    });
  };
}
