import path from "node:path";
import type { Command } from "commander";
import {
  collectEnvOverrides,
  deepMergeDocuments,
  loadProviderShapeBaseUrls,
  readMergedDocument,
  readMergedDocumentReadonly,
  type ConfigDocument
} from "@poe-code/poe-code-config/core";
import type { CliContainer } from "../container.js";
import type { ProviderService, ProviderContext, ProviderIsolatedEnv } from "../service-registry.js";
import { createLoggingCommandRunner, type CommandContext } from "../context.js";
import type { ScopedLogger } from "../logger.js";
import type { CommandCheck } from "../../utils/command-checks.js";
import type { MutationObservers } from "@poe-code/config-mutations";
import type { PromptForSecret } from "@poe-code/providers";
import { resolveIsolatedTargetDirectory } from "../isolated-env.js";
import {
  getSpawnConfig,
  listSpawnableAgents,
  resolveSpawnableAgent,
  type HookBridgeOptions
} from "@poe-code/agent-spawn";
import {
  allAgents,
  formatAgentCapabilityError,
  formatAgentSpecifier,
  parseAgentSpecifier,
  resolveAgentId,
  type AgentCapability,
  type AgentDefinition
} from "@poe-code/agent-defs";
import { knownConfigScopes, loadConfiguredServices } from "../../services/config.js";
import {
  resolveApiShape,
  type ApiShapeBinding,
  type ApiShapeId,
  type AuthProvider,
  type EnvValueSource,
  type ProviderModelInput
} from "@poe-code/providers";
import { OperationCancelledError, ValidationError } from "../errors.js";

export interface CommandFlags {
  dryRun: boolean;
  assumeYes: boolean;
  verbose: boolean;
}

export interface ActiveProvider {
  id: string;
  apiShape: ApiShapeId;
  baseUrl: string;
  agentBaseUrl: string;
  credential: string;
  modelInput?: ProviderModelInput;
  extraEnv: Record<string, string>;
}

export async function buildActiveProvider(input: {
  container: CliContainer;
  provider: AuthProvider;
  agent: Pick<AgentDefinition, "id" | "apiShapes">;
  credential: string;
  explicitBaseUrl?: string;
  explicitShapeBaseUrls?: Partial<Record<ApiShapeId, string>>;
  readOnly?: boolean;
}): Promise<ActiveProvider> {
  const apiShape = resolveApiShape(input.provider, input.agent);
  if (!apiShape) {
    throw new Error(`Provider "${input.provider.id}" cannot configure agent "${input.agent.id}".`);
  }

  const shape = input.provider.apiShapes?.find((candidate) => candidate.id === apiShape);
  if (!shape) {
    throw new Error(
      `Provider "${input.provider.id}" does not declare base URL for API shape "${apiShape}".`
    );
  }

  const providerBaseUrlEnv = resolveProviderBaseUrlEnv(input.container, input.provider);
  const environmentBaseUrl = resolveBaseUrlRoot(providerBaseUrlEnv, input.provider.baseUrlEnvPath);
  const explicitBaseUrlRoot = resolveBaseUrlRoot(
    resolveNonEmpty(input.explicitBaseUrl),
    input.provider.baseUrlEnvPath
  );

  const configuredBaseUrl =
    resolveNonEmpty(input.explicitShapeBaseUrls?.[apiShape]) ??
    resolveProviderShapeBaseUrl(input.provider, shape, input.explicitBaseUrl) ??
    resolveShapeBaseUrl(environmentBaseUrl, shape.envBaseUrlPath ?? shape.baseUrlPath) ??
    (await resolveStoredShapeBaseUrl(input.container, input.provider.id, apiShape, {
      readOnly: input.readOnly
    }));

  if (input.provider.requiresBaseUrl === true && configuredBaseUrl === undefined) {
    throw new Error(
      `Provider "${input.provider.id}" requires a base URL for API shape "${apiShape}". Run \`poe-code provider login ${input.provider.id} --base-url <url>\`, set ${input.provider.baseUrlEnvVar ?? "the provider base URL env var"}, or pass --base-url.`
    );
  }

  const defaultBaseUrl = resolveDefaultShapeBaseUrl(input.provider, shape);
  if (configuredBaseUrl === undefined && defaultBaseUrl === undefined) {
    throw new Error(
      `Provider "${input.provider.id}" does not declare a default base URL for API shape "${apiShape}". Pass --base-url or --shape-base-url ${apiShape}=<url>.`
    );
  }

  const baseUrl = configuredBaseUrl ?? defaultBaseUrl;
  if (baseUrl === undefined) {
    throw new Error(
      `Provider "${input.provider.id}" does not declare a default base URL for API shape "${apiShape}". Pass --base-url or --shape-base-url ${apiShape}=<url>.`
    );
  }
  assertHttpBaseUrl(input.provider.id, baseUrl);
  const declaresAgentBaseUrl =
    input.provider.agentBaseUrlPath !== undefined || input.provider.agentBaseUrl !== undefined;
  const agentBaseUrl =
    resolveNonEmpty(input.explicitShapeBaseUrls?.[apiShape]) ??
    (declaresAgentBaseUrl
      ? resolveShapeBaseUrl(explicitBaseUrlRoot, input.provider.agentBaseUrlPath)
      : undefined) ??
    resolveShapeBaseUrl(environmentBaseUrl, input.provider.agentBaseUrlPath) ??
    input.provider.agentBaseUrl ??
    baseUrl;

  return {
    id: input.provider.id,
    apiShape,
    baseUrl,
    agentBaseUrl,
    credential: input.credential,
    modelInput: input.provider.modelInput,
    extraEnv: resolveProviderEnv(input.provider, {
      baseUrl,
      credential: input.credential
    })
  };
}

function resolveDefaultShapeBaseUrl(
  provider: AuthProvider,
  shape: ApiShapeBinding
): string | undefined {
  if (shape.defaultBaseUrl !== undefined) {
    return shape.defaultBaseUrl;
  }
  const providerDefaultRoot = resolveBaseUrlRoot(provider.baseUrl, provider.baseUrlEnvPath);
  return resolveShapeBaseUrl(providerDefaultRoot, shape.envBaseUrlPath ?? shape.baseUrlPath);
}

function resolveProviderEnv(
  provider: AuthProvider,
  input: { baseUrl: string; credential: string }
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(provider.env ?? {}).map(([key, source]) => [
      key,
      resolveProviderEnvValue(provider, source, input)
    ])
  );
}

function resolveProviderEnvValue(
  provider: AuthProvider,
  source: EnvValueSource,
  input: { baseUrl: string; credential: string }
): string {
  switch (source.kind) {
    case "literal":
      return source.value;
    case "providerCredential":
      return `${source.prefix ?? ""}${input.credential}`;
    case "providerBaseUrl":
      return input.baseUrl;
    case "providerField": {
      const value = provider[source.path as keyof AuthProvider];
      if (typeof value !== "string") {
        throw new Error(`Provider field "${source.path}" must resolve to a string.`);
      }
      return value;
    }
  }
}

function assertHttpBaseUrl(providerId: string, baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Provider "${providerId}" base URL must be an http(s) URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Provider "${providerId}" base URL must be an http(s) URL.`);
  }
}

export function parseProviderShapeBaseUrls(
  provider: AuthProvider,
  values: readonly string[]
): Partial<Record<ApiShapeId, string>> {
  const exposedShapes = provider.apiShapes?.map((shape) => shape.id) ?? [];
  const exposed = new Set<ApiShapeId>(exposedShapes);
  const shapeBaseUrls: Partial<Record<ApiShapeId, string>> = {};

  for (const value of values) {
    const separatorIndex = value.indexOf("=");
    if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
      throw new Error(`Invalid --shape-base-url value "${value}". Use <shape-id>=<url>.`);
    }

    const shapeId = value.slice(0, separatorIndex).trim() as ApiShapeId;
    const baseUrl = value.slice(separatorIndex + 1).trim();
    if (!exposed.has(shapeId)) {
      throw new Error(
        `Unknown API shape "${shapeId}" for provider "${provider.id}". Exposed shapes: ${formatApiShapeList(exposedShapes)}.`
      );
    }
    if (baseUrl.length === 0) {
      throw new Error(`Invalid --shape-base-url value "${value}". Use <shape-id>=<url>.`);
    }

    shapeBaseUrls[shapeId] = baseUrl;
  }

  return shapeBaseUrls;
}

function formatApiShapeList(shapeIds: readonly ApiShapeId[]): string {
  return shapeIds.length > 0 ? shapeIds.join(", ") : "none";
}

export function resolveNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function resolveProviderBaseUrlEnv(
  container: CliContainer,
  provider: AuthProvider
): string | undefined {
  const envVar = provider.baseUrlEnvVar;
  return envVar ? resolveNonEmpty(container.env.getVariable(envVar)) : undefined;
}

export function resolveShapeBaseUrl(
  baseUrl: string | undefined,
  pathSuffix: string | undefined
): string | undefined {
  if (baseUrl === undefined) {
    return undefined;
  }
  const suffix = resolveNonEmpty(pathSuffix);
  if (suffix === undefined) {
    return baseUrl;
  }
  const normalizedBaseUrl = stripTrailingPathSegment(trimTrailingSlash(baseUrl), "compat");
  return `${normalizedBaseUrl}/${trimLeadingSlash(suffix)}`;
}

export function resolveProviderShapeBaseUrl(
  provider: AuthProvider,
  shape: ApiShapeBinding,
  baseUrl: string | undefined
): string | undefined {
  const normalizedBaseUrl = resolveNonEmpty(baseUrl);
  if (normalizedBaseUrl === undefined) {
    return undefined;
  }
  const providerRoot = resolveBaseUrlRoot(normalizedBaseUrl, provider.baseUrlEnvPath);
  if (providerRoot !== normalizedBaseUrl) {
    return resolveShapeBaseUrl(providerRoot, shape.envBaseUrlPath ?? shape.baseUrlPath);
  }
  return resolveShapeBaseUrl(normalizedBaseUrl, shape.baseUrlPath) ?? normalizedBaseUrl;
}

function resolveBaseUrlRoot(
  baseUrl: string | undefined,
  pathSuffix: string | undefined
): string | undefined {
  const normalizedBaseUrl = resolveNonEmpty(baseUrl);
  const normalizedSuffix = resolveNonEmpty(pathSuffix);
  if (normalizedBaseUrl === undefined || normalizedSuffix === undefined) {
    return normalizedBaseUrl;
  }
  return stripTrailingPathSegment(
    trimTrailingSlash(normalizedBaseUrl),
    trimLeadingSlash(normalizedSuffix)
  );
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function trimLeadingSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}

function stripTrailingPathSegment(value: string, segment: string): string {
  const suffix = `/${segment}`;
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}

export async function resolveActiveProviderForService(
  container: CliContainer,
  serviceName: string,
  options: { readOnly?: boolean } = {}
): Promise<ActiveProvider | undefined> {
  const configuredServices = await loadConfiguredServices({
    fs: container.fs,
    filePath: container.env.configPath,
    projectFilePath: container.env.projectConfigPath,
    readOnly: options.readOnly
  });
  const agent = resolveAgentDefinition(serviceName) ?? { id: serviceName };
  const metadata = configuredServices[serviceName];
  const configuredProviderId = metadata?.provider;
  const provider = configuredProviderId
    ? container.providerRegistry.get(configuredProviderId)
    : await resolveSingleProviderCandidate(container, agent, options);
  if (!provider || provider.auth.kind !== "api-key") {
    return undefined;
  }

  let credential: string;
  try {
    credential = await container.providerRegistry.resolveCredential(provider.id, undefined, {
      envVars: container.env.variables,
      readOnly: options.readOnly
    });
  } catch {
    return undefined;
  }

  return buildActiveProvider({
    container,
    provider,
    agent,
    credential,
    explicitBaseUrl: metadata?.baseUrl,
    explicitShapeBaseUrls: parseProviderShapeBaseUrls(provider, metadata?.shapeBaseUrl ?? []),
    readOnly: options.readOnly
  });
}

async function resolveSingleProviderCandidate(
  container: CliContainer,
  agent: Pick<AgentDefinition, "id" | "apiShapes">,
  options: { readOnly?: boolean }
): Promise<AuthProvider | undefined> {
  const candidates = container.providerRegistry.forAgent(agent);
  if (candidates.length === 1) {
    return candidates[0];
  }
  const loggedIn: AuthProvider[] = [];
  for (const candidate of candidates) {
    if (await container.providerRegistry.isLoggedIn(candidate.id, options)) {
      loggedIn.push(candidate);
    }
  }
  if (loggedIn.length === 1) {
    return loggedIn[0];
  }
  return undefined;
}

async function resolveStoredShapeBaseUrl(
  container: CliContainer,
  providerId: string,
  apiShape: ApiShapeId,
  options: { readOnly?: boolean } = {}
): Promise<string | undefined> {
  const shapeBaseUrls = await loadProviderShapeBaseUrls({
    fs: container.fs,
    filePath: container.env.servicesConfigPath,
    providerId,
    readOnly: options.readOnly
  });
  const value = shapeBaseUrls[apiShape];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function resolveAgentDefinition(serviceName: string): AgentDefinition | undefined {
  const { agent } = parseAgentSpecifier(serviceName);
  const resolvedId = resolveAgentId(agent) ?? agent;
  return allAgents.find((candidate) => candidate.id === resolvedId);
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

export function apiKeyFlagDescription(envVar: string): string {
  return `API key. Passing it here records the secret in shell history and ps output; prefer ${envVar} or the interactive prompt.`;
}

export function warnApiKeyFlag(
  logger: ScopedLogger,
  value: string | undefined,
  envVar: string
): void {
  if (resolveNonEmpty(value) === undefined) {
    return;
  }
  logger.warn(
    `--api-key was read from the command line, where shell history and ps output can capture it. Prefer ${envVar} or the interactive prompt.`
  );
}

export function requireInteractiveStdin(message: string): void {
  if (process.stdin.isTTY !== true) {
    throw new ValidationError(message);
  }
}

export function createExecutionResources(
  container: CliContainer,
  flags: CommandFlags,
  scope: string,
  env?: Record<string, string | undefined>
): ExecutionResources {
  const baseLogger = container.loggerFactory.create({
    dryRun: flags.dryRun,
    verbose: flags.verbose,
    scope
  });
  const runner = createLoggingCommandRunner(
    env
      ? (command, args, options) =>
          container.commandRunner(command, args, {
            ...options,
            env: { ...(options?.env ?? {}), ...env }
          })
      : container.commandRunner,
    baseLogger
  );
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
  options?: { model?: string; hooks?: HookBridgeOptions; activeProvider?: ActiveProvider }
): ProviderContext {
  const runCheck = createCheckRunner(resources);
  return {
    env: container.env,
    command: resources.context,
    logger: resources.logger,
    model: options?.model,
    hooks: options?.hooks,
    activeProvider: options?.activeProvider,
    runCheck
  };
}

function createCheckRunner(resources: ExecutionResources): (check: CommandCheck) => Promise<void> {
  return async (check) => {
    await check.run({
      isDryRun: resources.logger.context.dryRun,
      verbose: resources.logger.context.verbose,
      runCommand: resources.context.runCommand,
      logDryRun: (message) => resources.logger.dryRun(message),
      logWarning: (message) => resources.logger.warn(message)
    });
  };
}

export function listIsolatedServiceIds(container: CliContainer): string[] {
  return listServiceNames(
    container.registry.list().filter((provider) => Boolean(provider.isolatedEnv))
  );
}

export function listServiceNames(services: Array<{ name: string; aliases?: string[] }>): string[] {
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
  service: string,
  capability: AgentCapability = "configure"
): ProviderService {
  const adapter = container.registry.get(service);
  if (!adapter) {
    throw new ValidationError(formatAgentCapabilityError({ agent: service, capability }));
  }
  return adapter;
}

export type SpawnTarget = {
  id: string;
  name: string;
  label: string;
  aliases?: string[];
  supportsStdinPrompt?: boolean;
  supportsMcpSpawn?: boolean;
  requiresProvider?: boolean;
  spawn?: ProviderService["spawn"];
  provider?: ProviderService;
};

export function resolveSpawnTarget(container: CliContainer, service: string): SpawnTarget {
  const spawnable = resolveSpawnableAgent(service);
  if (spawnable) {
    const provider = container.registry.get(spawnable.id) ?? container.registry.get(service);
    return {
      id: spawnable.id,
      name: spawnable.name,
      label: spawnable.label,
      aliases: spawnable.aliases,
      supportsStdinPrompt: spawnable.supportsStdinPrompt || provider?.supportsStdinPrompt === true,
      supportsMcpSpawn: spawnable.supportsMcpSpawn || provider?.supportsMcpSpawn === true,
      requiresProvider: provider?.requiresProvider,
      spawn: provider?.spawn,
      provider
    };
  }

  const provider = container.registry.get(service);
  if (provider && typeof provider.spawn === "function") {
    return {
      id: provider.id,
      name: provider.name,
      label: provider.label,
      aliases: provider.aliases,
      supportsStdinPrompt: provider.supportsStdinPrompt,
      supportsMcpSpawn: provider.supportsMcpSpawn,
      requiresProvider: provider.requiresProvider,
      spawn: provider.spawn,
      provider
    };
  }

  throw new ValidationError(formatAgentCapabilityError({ agent: service, capability: "spawn" }));
}

export function listSpawnTargets(
  container: CliContainer,
  extraServices: string[] = []
): SpawnTarget[] {
  const byName = new Map<string, SpawnTarget>();

  for (const agent of listSpawnableAgents()) {
    byName.set(agent.name, {
      id: agent.id,
      name: agent.name,
      label: agent.label,
      aliases: agent.aliases,
      supportsStdinPrompt: agent.supportsStdinPrompt,
      supportsMcpSpawn: agent.supportsMcpSpawn
    });
  }

  for (const provider of container.registry.list()) {
    if (typeof provider.spawn !== "function" && !getSpawnConfig(provider.name)) {
      continue;
    }
    const existing = byName.get(provider.name);
    if (existing) {
      byName.set(provider.name, {
        ...existing,
        supportsStdinPrompt: existing.supportsStdinPrompt || provider.supportsStdinPrompt === true,
        supportsMcpSpawn: existing.supportsMcpSpawn || provider.supportsMcpSpawn === true,
        requiresProvider: provider.requiresProvider,
        spawn: provider.spawn,
        provider
      });
      continue;
    }
    byName.set(provider.name, {
      id: provider.id,
      name: provider.name,
      label: provider.label,
      aliases: provider.aliases,
      supportsStdinPrompt: provider.supportsStdinPrompt,
      supportsMcpSpawn: provider.supportsMcpSpawn,
      requiresProvider: provider.requiresProvider,
      spawn: provider.spawn,
      provider
    });
  }

  for (const service of extraServices) {
    const normalized = service.trim();
    if (!normalized || byName.has(normalized)) continue;
    const resolved = resolveAgentId(normalized) ?? normalized;
    const agent = allAgents.find((candidate) => candidate.id === resolved);
    byName.set(normalized, {
      id: resolved,
      name: agent?.name ?? normalized,
      label: agent?.label ?? normalized,
      aliases: agent?.aliases
    });
  }

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
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
  return needsCdPrefix ? `cd ${shlexQuote(resumeCwd)} && ${agentCommand}` : agentCommand;
}

export async function applyIsolatedConfiguration(input: {
  adapter: ProviderService;
  providerContext: ProviderContext;
  payload: unknown;
  isolated: ProviderIsolatedEnv;
  providerName: string;
  observers?: MutationObservers;
  sideEffects?: boolean;
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
    input.observers || input.sideEffects === false
      ? { observers: input.observers, sideEffects: input.sideEffects }
      : undefined
  );
}

export async function resolveMergedDocument(
  container: CliContainer,
  options: { readOnly?: boolean } = {}
): Promise<ConfigDocument> {
  const mergedDocument = await (options.readOnly ? readMergedDocumentReadonly : readMergedDocument)(
    container.fs,
    container.env.configPath,
    container.env.projectConfigPath
  );
  const envOverrides = collectEnvOverrides(knownConfigScopes, container.env.variables);
  return deepMergeDocuments(mergedDocument, envOverrides.document);
}

export async function resolveDefaultAgent(
  container: CliContainer,
  options: { readOnly?: boolean } = {}
): Promise<string | null> {
  const document = await resolveMergedDocument(container, options);
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

/**
 * The agent `--yes` assumes when neither the command line nor config names one.
 * Shared by install, plan and skill so the fallback cannot drift per command.
 */
const FALLBACK_DEFAULT_AGENT = "claude-code";

/**
 * Resolves the agent that `--yes` should assume and announces it: a defaulted
 * agent has real side effects (installs, written skills), so it is never silent.
 */
export async function resolveAssumedDefaultAgent(input: {
  container: CliContainer;
  logger: ScopedLogger;
  readOnly?: boolean;
}): Promise<string> {
  const fromConfig = await resolveDefaultAgent(input.container, { readOnly: input.readOnly });
  if (fromConfig === null) {
    input.logger.info(
      `Using default agent: ${FALLBACK_DEFAULT_AGENT} (built-in default; name an agent or set core.defaultAgent to change it).`
    );
    return FALLBACK_DEFAULT_AGENT;
  }

  const agent = parseAgentSpecifier(fromConfig).agent;
  input.logger.info(`Using default agent: ${agent} (from core.defaultAgent).`);
  return agent;
}

export function announceAssumedScope(logger: ScopedLogger, scope: string): void {
  logger.info(`Using default scope: ${scope} (pass --local or --global to change it).`);
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
