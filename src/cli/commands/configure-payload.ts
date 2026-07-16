import { resolveConfigModel } from "@poe-code/poe-code-config";
import type { CliContainer } from "../container.js";
import type { ScopedLogger } from "../logger.js";
import type { ProviderContext, ProviderService } from "../service-registry.js";
import {
  buildActiveProvider,
  parseProviderShapeBaseUrls,
  resolveAgentDefinition,
  resolveNonEmpty,
  type ActiveProvider,
  type CommandFlags
} from "./shared.js";
import type { ConfigureCommandOptions } from "./configure.js";
import { ValidationError } from "../errors.js";
import { POE_PROVIDER_ID, type AuthProvider } from "@poe-code/providers";
import type { ModelChoice, ModelChoices, ModelPromptInput } from "../prompts.js";

interface ConfigurePayloadInit {
  container: CliContainer;
  flags: CommandFlags;
  options: ConfigureCommandOptions;
  context: ProviderContext;
  adapter: ProviderService;
  logger: ScopedLogger;
  providerId?: string;
}

const PREVIEW_API_KEY = "<redacted>";

export async function createConfigurePayload(init: ConfigurePayloadInit): Promise<unknown> {
  const { container, flags, options, context, adapter, logger, providerId } = init;
  const payload: Record<string, unknown> = { env: context.env };
  let provider: AuthProvider | undefined;
  let activeProvider: ActiveProvider | undefined;
  let resolvedModelChoices: ReadonlyArray<ModelChoice> | undefined;
  let hasResolvedModelChoices = false;

  if (providerId) {
    provider = container.providerRegistry.get(providerId);
    if (!provider) {
      throw new Error(`Unknown provider "${providerId}".`);
    }
    const explicitShapeBaseUrls = parseProviderShapeBaseUrls(provider, options.shapeBaseUrl ?? []);
    const agent = resolveAgentDefinition(adapter.name) ?? { id: adapter.name };
    const apiKey = flags.dryRun
      ? PREVIEW_API_KEY
      : providerId === POE_PROVIDER_ID
        ? await container.options.resolveApiKey({
              value: options.apiKey,
              envValue:
                provider.auth.kind === "api-key"
                  ? container.env.getVariable(provider.auth.envVar)
                  : undefined,
              dryRun: false,
              assumeYes: flags.assumeYes
            })
        : await container.providerRegistry.resolveCredential(
            providerId,
            { apiKey: options.apiKey },
            { envVars: container.env.variables }
          );
    const explicitBaseUrl = await resolveConfigureBaseUrl({
      options
    });
    activeProvider = await buildActiveProvider({
      container,
      provider,
      agent,
      credential: apiKey,
      explicitBaseUrl,
      explicitShapeBaseUrls,
      readOnly: flags.dryRun
    });
    logger.resolved(
      `${provider.label} ${activeProvider.apiShape} base URL`,
      activeProvider.baseUrl
    );
    logger.resolved(`${adapter.label} base URL`, activeProvider.agentBaseUrl);
    payload.provider = activeProvider;
  }

  const modelPrompt = adapter.configurePrompts?.model;
  // An agent takes a configure-time model either through a model prompt or through
  // its payload extension. With neither, --model would be accepted and dropped.
  if (
    !modelPrompt &&
    !adapter.extendConfigurePayload &&
    resolveNonEmpty(options.model) !== undefined
  ) {
    throw new ValidationError(`${adapter.label} does not support --model.`);
  }
  if (modelPrompt) {
    const configModel = await resolveConfigModel(
      {
        fs: container.fs,
        filePath: container.env.configPath,
        readOnly: flags.dryRun
      },
      adapter.name
    );
    const model =
      provider?.modelInput?.kind === "freeform" && typeof modelPrompt.choices !== "function"
        ? await resolveFreeformProviderModel({
            container,
            flags,
            options,
            modelPrompt,
            configModel,
            provider,
            logger
          })
        : await container.options.resolveModel({
            value: options.model,
            assumeDefault: flags.assumeYes,
            defaultValue: configModel ?? modelPrompt.defaultValue,
            choices: await resolveChoices(),
            aliases: modelPrompt.aliases,
            strictChoices:
              modelPrompt.strictChoices === true && typeof modelPrompt.choices !== "function",
            label: modelPrompt.label,
            onResolve: (label, value) => logger.resolved(label, value)
          });
    payload.model = model;
  }

  const requestedReasoning = resolveNonEmpty(options.reasoningEffort);
  if (requestedReasoning !== undefined) {
    const reasoning = adapter.configurePrompts?.reasoningEffort;
    if (!reasoning) {
      throw new ValidationError(`${adapter.label} does not support --reasoning-effort.`);
    }
    payload.reasoningEffort = await container.options.resolveReasoning({
      value: requestedReasoning,
      levels:
        typeof reasoning.levels === "function"
          ? reasoning.levels(payload.model as string | undefined)
          : reasoning.levels,
      label: reasoning.label,
      onResolve: (label, value) => logger.resolved(label, value)
    });
  }

  const extension = flags.dryRun
    ? undefined
    : await adapter.extendConfigurePayload?.({
        fs: container.fs,
        env: context.env,
        httpClient: container.httpClient,
        logger,
        payload,
        prompts: container.prompts,
        promptLibrary: container.promptLibrary,
        assumeYes: flags.assumeYes,
        commandOptions: options as Record<string, unknown>
      });
  if (extension) {
    Object.assign(payload, extension);
  }

  return payload;

  async function resolveChoices(): Promise<ReadonlyArray<ModelChoice> | undefined> {
    const choices = modelPrompt?.choices;
    if (!choices) {
      return undefined;
    }
    if (flags.dryRun && typeof choices === "function") {
      return [{ title: modelPrompt.defaultValue, value: modelPrompt.defaultValue }];
    }
    if (typeof choices !== "function") {
      return choices;
    }
    if (hasResolvedModelChoices) {
      return resolvedModelChoices;
    }
    hasResolvedModelChoices = true;
    resolvedModelChoices = await resolveDynamicModelChoices({
      choices,
      activeProvider,
      container,
      adapter,
      logger,
      fallbackModel: modelPrompt.defaultValue
    });
    return resolvedModelChoices;
  }
}

async function resolveDynamicModelChoices(input: {
  choices: Exclude<ModelChoices, ReadonlyArray<ModelChoice>>;
  activeProvider?: ActiveProvider;
  container: CliContainer;
  adapter: ProviderService;
  logger: ScopedLogger;
  fallbackModel: string;
}): Promise<ReadonlyArray<ModelChoice>> {
  try {
    if (!input.activeProvider) {
      throw new Error("active provider is unavailable");
    }
    return await input.choices({
      httpClient: input.container.httpClient,
      provider: input.activeProvider,
      env: input.container.env
    });
  } catch (error) {
    input.logger.verbose(
      `Failed to resolve model choices for ${input.adapter.name}: ${formatErrorMessage(
        error
      )}. Using ${input.fallbackModel}.`
    );
    return [{ title: input.fallbackModel, value: input.fallbackModel }];
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "unknown error";
}

async function resolveConfigureBaseUrl(input: {
  options: ConfigureCommandOptions;
}): Promise<string | undefined> {
  return resolveNonEmpty(input.options.baseUrl);
}

async function resolveFreeformProviderModel(input: {
  container: CliContainer;
  flags: CommandFlags;
  options: ConfigureCommandOptions;
  modelPrompt: ModelPromptInput;
  configModel: string | null;
  provider: AuthProvider;
  logger: ScopedLogger;
}): Promise<string> {
  const label = input.modelPrompt.label;
  const explicitModel = resolveNonEmpty(input.options.model);
  if (explicitModel !== undefined) {
    input.logger.resolved(label, explicitModel);
    return explicitModel;
  }

  const configuredModel = resolveNonEmpty(input.configModel ?? undefined);
  if (configuredModel !== undefined) {
    input.logger.resolved(label, configuredModel);
    return configuredModel;
  }

  if (input.flags.assumeYes) {
    throw new ValidationError(
      `Provider "${input.provider.id}" requires a model for "${label}". ${formatFreeformModelHint(
        input.modelPrompt,
        input.provider
      )}`
    );
  }

  return await input.container.options.ensure({
    descriptor: {
      name: "model",
      message: label,
      type: "text"
    }
  });
}

/**
 * A freeform provider accepts any model its gateway routes, so the agent's declared
 * ids are offered as candidates rather than as the complete set.
 */
function formatFreeformModelHint(prompt: ModelPromptInput, provider: AuthProvider): string {
  const candidates = [
    ...Object.keys(prompt.aliases ?? {}),
    ...(typeof prompt.choices === "function" ? [] : prompt.choices ?? []).map(
      (choice) => choice.value
    )
  ];
  return candidates.length > 0
    ? `Pass --model with one of: ${candidates.join(", ")}, or any other model id your ${
        provider.label
      } exposes.`
    : `Pass --model with a model id your ${provider.label} exposes.`;
}
