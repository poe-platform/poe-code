import path from "node:path";
import {
  DEFAULT_FRONTIER_MODEL,
  FRONTIER_MODELS,
  stripModelNamespace
} from "../cli/constants.js";
import { ApiError, ValidationError } from "../cli/errors.js";
import type {
  ProviderBuildConfigurePayloadInit,
  ProviderConfigurePayload,
  ProviderService,
  ServiceExecutionContext
} from "../cli/service-registry.js";
import {
  createBinaryExistsCheck,
  formatCommandRunnerResult,
  type CommandRunnerResult
} from "../utils/command-checks.js";

const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 4_096;
const MAX_SHORTLIST_MODELS = 8;
const OPENCLAW_BINARY = "openclaw";
const OPENCLAW_PROVIDER_PATH = "models.providers.poe";
const OPENCLAW_PRIMARY_MODEL_PATH = "agents.defaults.model.primary";
const OPENCLAW_PROVIDER_API = "openai-completions";

interface PoeModelEntry {
  id: string;
  created: number;
  owned_by: string;
  metadata?: {
    display_name?: string | null;
  } | null;
  architecture?: {
    input_modalities?: string[] | null;
    output_modalities?: string[] | null;
  } | null;
  pricing?: {
    prompt?: number | null;
    completion?: number | null;
    input_cache_read?: number | null;
    input_cache_write?: number | null;
  } | null;
  context_window?: {
    context_length?: number | null;
    max_output_tokens?: number | null;
  } | null;
  reasoning?: unknown;
}

interface PoeModelsResponse {
  object: string;
  data: PoeModelEntry[];
}

interface OpenClawModelConfig {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
}

interface OpenClawProviderConfig {
  baseUrl: string;
  apiKey: string;
  api: string;
  models: OpenClawModelConfig[];
}

interface OpenClawConfigureOptions {
  apiKey: string;
  model: string;
  providerConfig: OpenClawProviderConfig;
  configPath: string;
  dryRun: boolean;
}

interface OpenClawUnconfigureOptions {
  dryRun?: boolean;
}

interface NormalizedPoeModel {
  id: string;
  name: string;
  created: number;
  ownedBy: string;
  config: OpenClawModelConfig;
}

interface OpenClawValidateResponse {
  valid?: boolean;
  path?: string;
}

export const provider: ProviderService<
  OpenClawConfigureOptions,
  OpenClawUnconfigureOptions
> = {
  id: "openclaw",
  name: "openclaw",
  label: "OpenClaw",
  summary: "Configure OpenClaw to use Poe as a model provider.",
  async buildConfigurePayload(
    init
  ): Promise<ProviderConfigurePayload<OpenClawConfigureOptions>> {
    await init.context.runCheck(
      createBinaryExistsCheck(
        OPENCLAW_BINARY,
        "openclaw-cli-binary",
        "OpenClaw CLI binary must exist"
      )
    );

    const configPath = await resolveOpenClawConfigPath(init);
    await validateOpenClawConfig(init, configPath);

    const apiKey = await init.container.options.resolveApiKey({
      value: readOptionString(init.options, "apiKey"),
      envValue: init.container.env.getVariable("POE_API_KEY"),
      dryRun: init.flags.dryRun,
      assumeYes: init.flags.assumeYes
    });
    const models = await fetchPoeModels(init, apiKey);
    const providerModels = normalizePoeModels(models);
    if (providerModels.length === 0) {
      throw new ValidationError(
        "Poe did not return any text models that OpenClaw can use."
      );
    }

    const model = await resolveSelectedModel(init, providerModels);
    const providerConfig = buildProviderConfig(
      init.context.env.poeApiBaseUrl,
      apiKey,
      providerModels
    );

    return {
      options: {
        apiKey,
        model,
        providerConfig,
        configPath,
        dryRun: init.flags.dryRun
      },
      files: [configPath]
    };
  },
  async configure(context: ServiceExecutionContext<OpenClawConfigureOptions>) {
    const { options } = context;
    if (options.dryRun) {
      return;
    }

    await runOpenClawCommand(
      context,
      [
        "config",
        "set",
        OPENCLAW_PROVIDER_PATH,
        JSON.stringify(options.providerConfig),
        "--strict-json"
      ],
      "configure the Poe provider"
    );
    await runOpenClawCommand(
      context,
      ["models", "set", `poe/${options.model}`],
      "set the default OpenClaw model"
    );
    const validationResult = await runOpenClawCommand(
      context,
      ["config", "validate", "--json"],
      "validate the OpenClaw configuration"
    );
    assertOpenClawValidationPassed(
      validationResult,
      "OpenClaw configuration became invalid."
    );
  },
  async unconfigure(
    context: ServiceExecutionContext<OpenClawUnconfigureOptions>
  ) {
    const configFileResult = await runOpenClawCommand(
      context,
      ["config", "file"],
      "locate the OpenClaw config file"
    );
    const configPath = normalizeOpenClawPath(
      configFileResult.stdout,
      context.env.homeDir,
      context.env.cwd
    );
    await validateExistingOpenClawConfig(context, configPath);

    const isDryRun = context.options?.dryRun === true;
    const providerConfig = await readOpenClawConfigValue(
      context,
      OPENCLAW_PROVIDER_PATH
    );
    const primaryModel = await readStringConfigValue(
      context,
      OPENCLAW_PRIMARY_MODEL_PATH
    );
    const shouldClearPrimaryModel = primaryModel?.startsWith("poe/") === true;
    const changed = providerConfig !== undefined || shouldClearPrimaryModel;

    if (isDryRun || !changed) {
      return changed;
    }

    if (providerConfig !== undefined) {
      await runOpenClawCommand(
        context,
        ["config", "unset", OPENCLAW_PROVIDER_PATH],
        "remove the Poe provider"
      );
    }

    if (shouldClearPrimaryModel) {
      await runOpenClawCommand(
        context,
        ["config", "unset", OPENCLAW_PRIMARY_MODEL_PATH],
        "clear the Poe default model"
      );
    }

    const validationResult = await runOpenClawCommand(
      context,
      ["config", "validate", "--json"],
      "validate the OpenClaw configuration"
    );
    assertOpenClawValidationPassed(
      validationResult,
      "OpenClaw configuration became invalid."
    );
    return true;
  }
};

async function resolveOpenClawConfigPath(
  init: ProviderBuildConfigurePayloadInit
): Promise<string> {
  const result = await init.context.command.runCommand(OPENCLAW_BINARY, [
    "config",
    "file"
  ]);
  if (result.exitCode !== 0) {
    throw buildOpenClawConfigError(
      "OpenClaw must already be configured on this machine. Run `openclaw onboard` or `openclaw doctor` first.",
      result
    );
  }

  const configPath = normalizeOpenClawPath(
    result.stdout,
    init.context.env.homeDir,
    init.context.env.cwd
  );
  if (configPath.length === 0) {
    throw new ValidationError(
      "OpenClaw did not report an active configuration file. Run `openclaw onboard` or `openclaw doctor` first."
    );
  }

  return configPath;
}

async function validateOpenClawConfig(
  init: ProviderBuildConfigurePayloadInit,
  configPath: string
): Promise<void> {
  await validateOpenClawConfigAtPath(
    init.context.command.runCommand,
    configPath,
    `OpenClaw configuration is not valid at ${configPath}. Run \`openclaw onboard\` or \`openclaw doctor\`.`
  );
}

async function fetchPoeModels(
  init: ProviderBuildConfigurePayloadInit,
  apiKey: string
): Promise<PoeModelEntry[]> {
  const response = await init.container.httpClient(
    `${init.context.env.poeApiBaseUrl}/models`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    }
  );
  if (!response.ok) {
    throw new ApiError(
      `Failed to fetch Poe models for OpenClaw (HTTP ${response.status})`,
      {
        httpStatus: response.status,
        endpoint: "/models"
      }
    );
  }

  const payload = (await response.json()) as PoeModelsResponse;
  return Array.isArray(payload.data) ? payload.data : [];
}

function normalizePoeModels(models: PoeModelEntry[]): NormalizedPoeModel[] {
  const byId = new Map<string, NormalizedPoeModel>();
  for (const model of models) {
    if (!supportsTextOutput(model)) {
      continue;
    }

    const input = resolveInputModalities(model);
    if (!input) {
      continue;
    }

    const name = resolveModelName(model);
    const normalized: NormalizedPoeModel = {
      id: model.id,
      name,
      created: model.created,
      ownedBy: model.owned_by,
      config: {
        id: model.id,
        name,
        reasoning: Boolean(model.reasoning),
        input,
        cost: {
          input: numberOrZero(model.pricing?.prompt),
          output: numberOrZero(model.pricing?.completion),
          cacheRead: numberOrZero(model.pricing?.input_cache_read),
          cacheWrite: numberOrZero(model.pricing?.input_cache_write)
        },
        contextWindow: numberOrDefault(
          model.context_window?.context_length,
          DEFAULT_CONTEXT_WINDOW
        ),
        maxTokens: numberOrDefault(
          model.context_window?.max_output_tokens,
          DEFAULT_MAX_TOKENS
        )
      }
    };
    byId.set(normalized.id, normalized);
  }

  return Array.from(byId.values()).sort((left, right) =>
    left.id.localeCompare(right.id)
  );
}

async function resolveSelectedModel(
  init: ProviderBuildConfigurePayloadInit,
  models: NormalizedPoeModel[]
): Promise<string> {
  const explicitModel = readOptionString(init.options, "model");
  const available = new Map<string, NormalizedPoeModel>();
  for (const model of models) {
    available.set(model.id, model);
  }

  if (explicitModel) {
    if (!available.has(explicitModel)) {
      throw new ValidationError(
        `Unknown Poe model "${explicitModel}" for OpenClaw. Use an exact model id from https://api.poe.com/v1/models.`
      );
    }
    init.logger.resolved("OpenClaw default model", explicitModel);
    return explicitModel;
  }

  const shortlist = buildModelShortlist(models);
  const defaultModel = resolveDefaultModel(shortlist, models);
  const selected = await init.container.options.resolveModel({
    assumeDefault: init.flags.assumeYes,
    defaultValue: defaultModel,
    choices: shortlist.map((model) => ({
      title: model.name,
      value: model.id
    })),
    label: "OpenClaw default model",
    onResolve: (label, value) => init.logger.resolved(label, value)
  });
  return selected;
}

function buildModelShortlist(models: NormalizedPoeModel[]): NormalizedPoeModel[] {
  const byId = new Map<string, NormalizedPoeModel>();
  for (const model of models) {
    byId.set(model.id, model);
  }

  const selected = new Set<string>();
  const shortlist: NormalizedPoeModel[] = [];
  for (const modelId of FRONTIER_MODELS) {
    const stripped = stripModelNamespace(modelId);
    const model = byId.get(stripped);
    if (!model || selected.has(model.id)) {
      continue;
    }
    shortlist.push(model);
    selected.add(model.id);
  }

  const newestFrontier = models
    .filter((model) => !selected.has(model.id) && isFrontierOwner(model.ownedBy))
    .sort((left, right) => right.created - left.created);
  for (const model of newestFrontier) {
    if (shortlist.length >= MAX_SHORTLIST_MODELS) {
      break;
    }
    shortlist.push(model);
    selected.add(model.id);
  }

  if (shortlist.length >= MAX_SHORTLIST_MODELS) {
    return shortlist;
  }

  const newestRemaining = models
    .filter((model) => !selected.has(model.id))
    .sort((left, right) => right.created - left.created);
  for (const model of newestRemaining) {
    if (shortlist.length >= MAX_SHORTLIST_MODELS) {
      break;
    }
    shortlist.push(model);
  }

  return shortlist;
}

function resolveDefaultModel(
  shortlist: NormalizedPoeModel[],
  models: NormalizedPoeModel[]
): string {
  const defaultId = stripModelNamespace(DEFAULT_FRONTIER_MODEL);
  const shortlistDefault = shortlist.find((model) => model.id === defaultId);
  if (shortlistDefault) {
    return shortlistDefault.id;
  }
  if (shortlist.length > 0) {
    return shortlist[0]!.id;
  }
  if (models.length > 0) {
    return models[0]!.id;
  }
  throw new ValidationError(
    "Poe did not return any models that OpenClaw can configure."
  );
}

function buildProviderConfig(
  baseUrl: string,
  apiKey: string,
  models: NormalizedPoeModel[]
): OpenClawProviderConfig {
  return {
    baseUrl,
    apiKey,
    api: OPENCLAW_PROVIDER_API,
    models: models.map((model) => model.config)
  };
}

function supportsTextOutput(model: PoeModelEntry): boolean {
  return (model.architecture?.output_modalities ?? []).includes("text");
}

function resolveInputModalities(model: PoeModelEntry): string[] | undefined {
  const declared = model.architecture?.input_modalities;
  if (!Array.isArray(declared) || declared.length === 0) {
    return ["text"];
  }

  const resolved: string[] = [];
  for (const modality of declared) {
    if (modality !== "text" && modality !== "image") {
      continue;
    }
    if (!resolved.includes(modality)) {
      resolved.push(modality);
    }
  }
  if (resolved.length > 0) {
    return resolved;
  }
  return undefined;
}

function resolveModelName(model: PoeModelEntry): string {
  const displayName = model.metadata?.display_name;
  if (typeof displayName === "string" && displayName.trim().length > 0) {
    const trimmed = displayName.trim();
    if (trimmed.toLowerCase() !== model.id.toLowerCase()) {
      return trimmed;
    }
  }

  return humanizeModelId(model.id);
}

function humanizeModelId(modelId: string): string {
  const tokens = modelId.split("-");
  if (tokens.length === 0) {
    return modelId;
  }

  if (tokens[0] === "gpt") {
    if (tokens.length === 1) {
      return "GPT";
    }
    const version = formatModelToken(tokens[1]!);
    if (tokens.length === 2) {
      return `GPT-${version}`;
    }
    const suffix = tokens.slice(2).map(formatModelToken).join(" ");
    return suffix.length > 0
      ? `GPT-${version} ${suffix}`
      : `GPT-${version}`;
  }

  return tokens.map(formatModelToken).join(" ");
}

function formatModelToken(token: string): string {
  if (token === "gpt") {
    return "GPT";
  }
  if (token.length === 0) {
    return token;
  }
  return `${token[0]!.toUpperCase()}${token.slice(1)}`;
}

function isFrontierOwner(owner: string): boolean {
  const normalized = owner.toLowerCase();
  return normalized === "anthropic" ||
    normalized === "openai" ||
    normalized === "google";
}

function numberOrZero(value: number | null | undefined): number {
  return typeof value === "number" ? value : 0;
}

function numberOrDefault(
  value: number | null | undefined,
  fallback: number
): number {
  return typeof value === "number" ? value : fallback;
}

async function runOpenClawCommand(
  context: ServiceExecutionContext<
    OpenClawConfigureOptions | OpenClawUnconfigureOptions
  >,
  args: string[],
  description: string
): Promise<CommandRunnerResult> {
  const result = await context.command.runCommand(OPENCLAW_BINARY, args);
  if (result.exitCode === 0) {
    return result;
  }

  throw new ValidationError(
    `Failed to ${description}.\n${formatCommandRunnerResult(result)}`
  );
}

async function readOpenClawConfigValue(
  context: ServiceExecutionContext<OpenClawUnconfigureOptions>,
  path: string
): Promise<unknown> {
  const result = await context.command.runCommand(OPENCLAW_BINARY, [
    "config",
    "get",
    path,
    "--json"
  ]);
  if (result.exitCode !== 0) {
    if (configPathWasNotFound(result, path)) {
      return undefined;
    }
    throw new ValidationError(
      `Failed to read OpenClaw config value at ${path}.\n${formatCommandRunnerResult(result)}`
    );
  }
  return parseJsonOutput(result, `OpenClaw config value for ${path}`);
}

async function readStringConfigValue(
  context: ServiceExecutionContext<OpenClawUnconfigureOptions>,
  path: string
): Promise<string | undefined> {
  const value = await readOpenClawConfigValue(context, path);
  return typeof value === "string" ? value : undefined;
}

function parseJsonOutput<T>(
  result: CommandRunnerResult,
  label: string
): T {
  const output = result.stdout.trim();
  if (output.length === 0) {
    throw new ValidationError(`${label} returned empty output.`);
  }

  try {
    return JSON.parse(output) as T;
  } catch {
    throw new ValidationError(`${label} returned invalid JSON.`);
  }
}

async function validateExistingOpenClawConfig(
  context: ServiceExecutionContext<OpenClawUnconfigureOptions>,
  configPath: string
): Promise<void> {
  await validateOpenClawConfigAtPath(
    context.command.runCommand,
    configPath,
    `OpenClaw configuration is not valid at ${configPath}. Run \`openclaw onboard\` or \`openclaw doctor\`.`
  );
}

async function validateOpenClawConfigAtPath(
  runCommand: ServiceExecutionContext<
    OpenClawConfigureOptions | OpenClawUnconfigureOptions
  >["command"]["runCommand"],
  configPath: string,
  message: string
): Promise<void> {
  const result = await runCommand(OPENCLAW_BINARY, [
    "config",
    "validate",
    "--json"
  ]);
  if (result.exitCode !== 0) {
    throw buildOpenClawConfigError(message, result);
  }
  assertOpenClawValidationPassed(result, message);
}

function assertOpenClawValidationPassed(
  result: CommandRunnerResult,
  message: string
): void {
  const payload = parseJsonOutput<OpenClawValidateResponse>(
    result,
    "OpenClaw config validation"
  );
  if (payload.valid !== true) {
    throw new ValidationError(message);
  }
}

function normalizeOpenClawPath(
  input: string,
  homeDir: string,
  cwd: string
): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed === "~") {
    return homeDir;
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith(`~${path.sep}`)) {
    return path.join(homeDir, trimmed.slice(2));
  }
  if (trimmed.startsWith("~./") || trimmed.startsWith(`~.${path.sep}`)) {
    return path.join(homeDir, `.${trimmed.slice(3)}`);
  }
  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }
  return path.resolve(cwd, trimmed);
}

function configPathWasNotFound(
  result: CommandRunnerResult,
  path: string
): boolean {
  const combined = `${result.stdout}\n${result.stderr}`;
  return combined.includes(`Config path not found: ${path}`);
}

function buildOpenClawConfigError(
  message: string,
  result: CommandRunnerResult
): ValidationError {
  return new ValidationError(
    `${message}\n${formatCommandRunnerResult(result)}`
  );
}

function readOptionString(options: unknown, key: string): string | undefined {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return undefined;
  }
  const value = (options as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
