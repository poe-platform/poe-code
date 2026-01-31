import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import type {
  ProviderService,
  ProviderContext,
  ProviderIsolatedEnv
} from "../service-registry.js";
import {
  createLoggingCommandRunner,
  type CommandContext
} from "../context.js";
import type { ScopedLogger } from "../logger.js";
import type { CommandCheck } from "../../utils/command-checks.js";
import type { MutationObservers } from "@poe-code/config-mutations";
import { resolveIsolatedTargetDirectory } from "../isolated-env.js";

export interface CommandFlags {
  dryRun: boolean;
  assumeYes: boolean;
  verbose: boolean;
}

export interface ExecutionResources {
  logger: ScopedLogger;
  context: CommandContext;
}

export function resolveCommandFlags(program: Command): CommandFlags {
  const opts = program.optsWithGlobals();
  return {
    dryRun: Boolean(opts.dryRun),
    assumeYes: Boolean(opts.yes),
    verbose: Boolean(opts.verbose)
  };
}

export function createExecutionResources(
  container: CliContainer,
  flags: CommandFlags,
  scope: string
): ExecutionResources {
  const baseLogger = container.loggerFactory.create({
    dryRun: flags.dryRun,
    verbose: flags.verbose,
    scope
  });
  const runner = createLoggingCommandRunner(container.commandRunner, baseLogger);
  const context = container.contextFactory.create({
    dryRun: flags.dryRun,
    logger: baseLogger,
    runner
  });

  return {
    logger: baseLogger,
    context
  };
}

export function buildProviderContext(
  container: CliContainer,
  adapter: ProviderService,
  resources: ExecutionResources
): ProviderContext {
  const runCheck = createCheckRunner(resources);
  return {
    env: container.env,
    command: resources.context,
    logger: resources.logger,
    runCheck
  };
}

function createCheckRunner(
  resources: ExecutionResources
): (check: CommandCheck) => Promise<void> {
  return async (check) => {
    await check.run({
      isDryRun: resources.logger.context.dryRun,
      runCommand: resources.context.runCommand,
      logDryRun: (message) => resources.logger.dryRun(message)
    });
  };
}

export function listIsolatedServiceIds(container: CliContainer): string[] {
  return container.registry
    .list()
    .filter((provider) => Boolean(provider.isolatedEnv))
    .map((provider) => provider.name);
}

export function resolveServiceAdapter(
  container: CliContainer,
  service: string
): ProviderService {
  const adapter = container.registry.get(service);
  if (!adapter) {
    throw new Error(`Unknown agent "${service}".`);
  }
  return adapter;
}

export function formatServiceList(names: string[]): string {
  const unique = Array.from(new Set(names.filter((name) => name.length > 0)));
  if (unique.length === 0) {
    return "";
  }
  return ` (${unique.join(" | ")})`;
}

export async function applyIsolatedConfiguration(input: {
  adapter: ProviderService;
  providerContext: ProviderContext;
  payload: unknown;
  isolated: ProviderIsolatedEnv;
  providerName: string;
  observers?: MutationObservers;
}): Promise<void> {
  await input.adapter.configure(
    {
      fs: input.providerContext.command.fs,
      env: input.providerContext.env,
      command: input.providerContext.command,
      options: input.payload,
      pathMapper: {
        mapTargetDirectory: ({ targetDirectory }) =>
          resolveIsolatedTargetDirectory({
            targetDirectory,
            isolated: input.isolated,
            env: input.providerContext.env,
            providerName: input.providerName
          })
      }
    },
    input.observers ? { observers: input.observers } : undefined
  );
}
