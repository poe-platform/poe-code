import type {
  ProviderService,
  ProviderContext,
  ProviderBranding,
  ProviderConfigurePrompts,
  ProviderIsolatedEnv
} from "../cli/service-registry.js";
import {
  runMutations,
  type Mutation,
  type MutationObservers
} from "@poe-code/config-mutations";
import {
  runServiceInstall,
  type ServiceInstallDefinition
} from "../services/service-install.js";
import { loadTemplate } from "../utils/templates.js";

interface ManifestVersionDefinition {
  configure: Mutation[];
  unconfigure?: Mutation[];
}

export interface ServiceRunOptions {
  observers?: MutationObservers;
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
  manifest: ManifestVersionDefinition;
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
  opts: CreateProviderOptions<ConfigureOptions, UnconfigureOptions, SpawnOptions>
): ProviderService<ConfigureOptions, UnconfigureOptions, SpawnOptions> {
  const provider: ProviderService<
    ConfigureOptions,
    UnconfigureOptions,
    SpawnOptions
  > = {
    id: opts.id,
    summary: opts.summary,
    name: opts.name,
    aliases: opts.aliases,
    label: opts.label,
    branding: opts.branding,
    disabled: opts.disabled,
    supportsStdinPrompt: opts.supportsStdinPrompt,
    configurePrompts: opts.configurePrompts,
    postConfigureMessages: opts.postConfigureMessages,
    isolatedEnv: opts.isolatedEnv,
    async configure(context, runOptions) {
      await runMutations(opts.manifest.configure, {
        fs: context.fs,
        homeDir: context.env.homeDir,
        observers: runOptions?.observers,
        templates: loadTemplate,
        pathMapper: context.pathMapper
      }, context.options as Record<string, unknown>);
      context.command.flushDryRun({ emitIfEmpty: false });
    },
    async unconfigure(context, runOptions) {
      if (!opts.manifest.unconfigure) {
        return false;
      }
      const result = await runMutations(opts.manifest.unconfigure, {
        fs: context.fs,
        homeDir: context.env.homeDir,
        observers: runOptions?.observers,
        templates: loadTemplate,
        pathMapper: context.pathMapper
      }, context.options as Record<string, unknown>);
      context.command.flushDryRun({ emitIfEmpty: false });
      return result.changed;
    }
  };

  if (opts.install) {
    provider.install = createInstallRunner(opts.install);
  }

  if (opts.test) {
    provider.test = opts.test;
  }

  if (opts.spawn) {
    provider.spawn = opts.spawn;
  }

  return provider;
}

function createInstallRunner(definition: ServiceInstallDefinition) {
  return async (context: ProviderContext): Promise<void> => {
    await runServiceInstall(definition, {
      isDryRun: context.logger.context.dryRun,
      runCommand: context.command.runCommand,
      logger: (message) => context.logger.verbose(message),
      platform: context.env.platform
    });
  };
}
