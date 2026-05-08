import path from "node:path";
import type { Command } from "commander";
import {
  collectEnvOverrides,
  deepMergeDocuments,
  readMergedDocument,
  type ConfigDocument
} from "@poe-code/poe-code-config";
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
import type { PromptForSecret } from "@poe-code/providers";
import { resolveIsolatedTargetDirectory } from "../isolated-env.js";
import { getSpawnConfig } from "@poe-code/agent-spawn";
import {
  allAgents,
  formatAgentSpecifier,
  parseAgentSpecifier,
  resolveAgentId
} from "@poe-code/agent-defs";
import { knownConfigScopes, loadConfiguredServices } from "../../services/config.js";
import type { AuthProvider } from "@poe-code/providers";
import { OperationCancelledError, ValidationError } from "../errors.js";

export interface CommandFlags {
  dryRun: boolean;
  assumeYes: boolean;
  verbose: boolean;
}

export interface ActiveProvider {
  id: string;
  baseUrl: string;
  credential: string;
  extraEnv: Record<string, string>;
}

export function buildActiveProvider(
  id: string,
  baseUrl: string,
  credential: string
): ActiveProvider {
  return { id, baseUrl, credential, extraEnv: {} };
}

export async function resolveActiveProviderForService(
  container: CliContainer,
  serviceName: string
): Promise<ActiveProvider | undefined> {
  const configuredServices = await loadConfiguredServices({
    fs: container.fs,
    filePath: container.env.configPath,
    projectFilePath: container.env.projectConfigPath
  });
  const configuredProviderId = configuredServices[serviceName]?.provider;
  const provider = configuredProviderId
    ? container.providerRegistry.get(configuredProviderId)
    : resolveSingleProviderCandidate(container, serviceName);
  if (!provider || provider.auth.kind !== "api-key") {
    return undefined;
  }

  const envCredential = container.env.getVariable(provider.auth.envVar);
  const credential =
    typeof envCredential === "string" && envCredential.trim().length > 0
      ? envCredential
      : await container.readApiKey();
  if (!credential || credential.trim().length === 0) {
    return undefined;
  }

  return buildActiveProvider(provider.id, provider.baseUrl, credential);
}

function resolveSingleProviderCandidate(
  container: CliContainer,
  serviceName: string
): AuthProvider | undefined {
  const candidates = container.providerRegistry.forAgent(serviceName);
  if (candidates.length === 1) {
    return candidates[0];
  }
  return undefined;
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
  resources: ExecutionResources,
  options?: { model?: string }
): ProviderContext {
  const runCheck = createCheckRunner(resources);
  return {
    env: container.env,
    command: resources.context,
    logger: resources.logger,
    model: options?.model,
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
  return listServiceNames(
    container.registry
      .list()
      .filter((provider) => Boolean(provider.isolatedEnv))
  );
}

export function listServiceNames(
  services: Array<{ name: string; aliases?: string[] }>
): string[] {
  const names: string[] = [];

  const add = (value: string | undefined): void => {
    const normalized = value?.trim();
    if (!normalized || names.includes(normalized)) {
      return;
    }
    names.push(normalized);
  };

  for (const service of services) {
    add(service.name);
    for (const alias of service.aliases ?? []) {
      add(alias);
    }
  }

  return names;
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

export function createSecretPrompter(container: CliContainer): PromptForSecret {
  return async (prompt) => {
    const descriptor = {
      name: "apiKey" as const,
      message: prompt.title,
      type: "password" as const
    };
    const response = await container.prompts(descriptor);
    const value = response["apiKey"];
    if (typeof value !== "string" || !value.trim()) {
      throw new OperationCancelledError();
    }
    return value.trim();
  };
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
  if (spawnConfig?.kind !== "cli" || !spawnConfig.resume) {
    return undefined;
  }

  const resolvedId = resolveAgentId(canonicalService) ?? canonicalService;
  const agentDefinition = allAgents.find((agent) => agent.id === resolvedId);
  const binaryName = agentDefinition?.binaryName;
  if (!binaryName) {
    return undefined;
  }

  const resumeCwd = path.resolve(cwd);
  const composer = spawnConfig.resume.hintArgs ?? spawnConfig.resume.args;
  const args = composer(threadId, resumeCwd);
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

export async function resolveMergedDocument(
  container: CliContainer
): Promise<ConfigDocument> {
  const mergedDocument = await readMergedDocument(
    container.fs,
    container.env.configPath,
    container.env.projectConfigPath
  );
  const envOverrides = collectEnvOverrides(knownConfigScopes, container.env.variables);
  return deepMergeDocuments(mergedDocument, envOverrides.document);
}

export async function resolveDefaultAgent(
  container: CliContainer
): Promise<string | null> {
  const document = await resolveMergedDocument(container);
  const value = typeof document.core?.defaultAgent === "string" ? document.core.defaultAgent : "";
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const specifier = parseAgentSpecifier(trimmed);
  const resolvedAgent = resolveAgentId(specifier.agent);

  if (!resolvedAgent || !allAgents.some((agent) => agent.id === resolvedAgent)) {
    const supportedAgents = allAgents.map((agent) => agent.id).join(", ");
    throw new ValidationError(
      `Invalid value for core.defaultAgent: "${value}". Supported agents: ${supportedAgents}`
    );
  }

  return formatAgentSpecifier({
    agent: resolvedAgent,
    model: specifier.model
  });
}

export function shlexQuote(value: string): string {
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
