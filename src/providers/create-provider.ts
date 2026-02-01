import type {
  ProviderService,
  ProviderContext,
  ProviderBranding,
  ProviderConfigurePrompts,
  ProviderIsolatedEnv,
  McpContext,
  McpRunOptions
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
import {
  configure as mcpConfigure,
  unconfigure as mcpUnconfigure,
  isSupported as isMcpSupported,
  type McpServerEntry
} from "@poe-code/agent-mcp-config";
import {
  getCurrentExecutionContext,
  toMcpServerCommand
} from "../utils/execution-context.js";
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

function createMcpServerEntry(): McpServerEntry {
  const context = getCurrentExecutionContext(import.meta.url);
  const mcpCommand = toMcpServerCommand(context.command, "mcp");
  return {
    name: "poe-code",
    config: {
      transport: "stdio",
      command: mcpCommand.command,
      args: mcpCommand.args
    }
  };
}

function createMcpConfigureRunner(providerId: string) {
  return async (context: McpContext, options?: McpRunOptions): Promise<void> => {
    const server = createMcpServerEntry();
    await mcpConfigure(providerId, server, {
      fs: context.command.fs,
      homeDir: context.env.homeDir,
      platform: context.env.platform as "darwin" | "linux" | "win32",
      dryRun: options?.dryRun,
      observers: {
        onStart: (details) => {
          if (options?.dryRun) {
            context.logger.dryRun(`Would ${details.label.toLowerCase()}`);
          }
        },
        onComplete: (details, outcome) => {
          if (!options?.dryRun && outcome.changed) {
            context.logger.verbose(details.label);
          }
        }
      }
    });
  };
}

function createMcpUnconfigureRunner(providerId: string) {
  return async (context: McpContext, options?: McpRunOptions): Promise<void> => {
    await mcpUnconfigure(providerId, "poe-code", {
      fs: context.command.fs,
      homeDir: context.env.homeDir,
      platform: context.env.platform as "darwin" | "linux" | "win32",
      dryRun: options?.dryRun,
      observers: {
        onStart: (details) => {
          if (options?.dryRun) {
            context.logger.dryRun(`Would ${details.label.toLowerCase()}`);
          }
        },
        onComplete: (details, outcome) => {
          if (!options?.dryRun && outcome.changed) {
            context.logger.verbose(details.label);
          }
        }
      }
    });
  };
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

  // Auto-attach MCP handlers if the agent is supported
  if (isMcpSupported(opts.id)) {
    provider.mcpConfigure = createMcpConfigureRunner(opts.id);
    provider.mcpUnconfigure = createMcpUnconfigureRunner(opts.id);
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
