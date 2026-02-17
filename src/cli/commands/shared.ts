import path from "node:path";
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
import { getSpawnConfig } from "@poe-code/agent-spawn";
import { allAgents, resolveAgentId } from "@poe-code/agent-defs";

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

export function buildResumeCommand(
  canonicalService: string,
  threadId: string,
  cwd: string
): string | undefined {
  const spawnConfig = getSpawnConfig(canonicalService);
  if (spawnConfig?.kind !== "cli" || !spawnConfig.resumeCommand) {
    return undefined;
  }

  const resolvedId = resolveAgentId(canonicalService) ?? canonicalService;
  const agentDefinition = allAgents.find((agent) => agent.id === resolvedId);
  const binaryName = agentDefinition?.binaryName;
  if (!binaryName) {
    return undefined;
  }

  const resumeCwd = path.resolve(cwd);
  const args = spawnConfig.resumeCommand(threadId, resumeCwd);
  const agentCommand = [binaryName, ...args.map(shlexQuote)].join(" ");
  const needsCdPrefix = !args.includes(resumeCwd);
  return needsCdPrefix
    ? `cd ${shlexQuote(resumeCwd)} && ${agentCommand}`
    : agentCommand;
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

function shlexQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }

  let isSafe = true;
  for (let index = 0; index < value.length; index += 1) {
    if (!isSafeShellChar(value.charCodeAt(index))) {
      isSafe = false;
      break;
    }
  }

  if (isSafe) {
    return value;
  }

  let output = "'";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "'") {
      output += `"'"'"'`;
      continue;
    }
    output += char;
  }
  output += "'";
  return output;
}

function isSafeShellChar(code: number): boolean {
  if (code >= 48 && code <= 57) {
    return true;
  }
  if (code >= 65 && code <= 90) {
    return true;
  }
  if (code >= 97 && code <= 122) {
    return true;
  }

  switch (code) {
    case 95: // _
    case 64: // @
    case 37: // %
    case 43: // +
    case 61: // =
    case 58: // :
    case 44: // ,
    case 46: // .
    case 47: // /
    case 45: // -
      return true;
    default:
      return false;
  }
}
