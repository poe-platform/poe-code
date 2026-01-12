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

interface ManifestVersionDefinition<ConfigureOptions, RemoveOptions> {
  configure: ServiceManifestDefinition<ConfigureOptions, RemoveOptions>["configure"];
  remove?: ServiceManifestDefinition<ConfigureOptions, RemoveOptions>["remove"];
}

interface CreateProviderOptions<
  ConfigureOptions,
  RemoveOptions,
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
  isolatedEnv?: ProviderIsolatedEnv;
  manifest: ManifestVersionDefinition<ConfigureOptions, RemoveOptions>;
  install?: ServiceInstallDefinition;
  test?: ProviderService<ConfigureOptions, RemoveOptions, SpawnOptions>["test"];
  spawn?: ProviderService<
    ConfigureOptions,
    RemoveOptions,
    SpawnOptions
  >["spawn"];
}

export function createProvider<
  ConfigureOptions = any,
  RemoveOptions = ConfigureOptions,
  SpawnOptions = any
>(
  options: CreateProviderOptions<ConfigureOptions, RemoveOptions, SpawnOptions>
): ProviderService<ConfigureOptions, RemoveOptions, SpawnOptions> {
  const manifest = createServiceManifest({
    id: options.id,
    summary: options.summary,
    configure: options.manifest.configure,
    remove: options.manifest.remove
  });

  const provider: ProviderService<
    ConfigureOptions,
    RemoveOptions,
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
    isolatedEnv: options.isolatedEnv,
    async configure(context, runOptions) {
      await manifest.configure(context, runOptions);
    },
    async remove(context, runOptions) {
      return manifest.remove(context, runOptions);
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
