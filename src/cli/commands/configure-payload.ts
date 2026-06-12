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
import { POE_PROVIDER_ID, type AuthProvider } from "@poe-code/providers";
import type { ModelChoice, ModelChoices } from "../prompts.js";

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
      explicitShapeBaseUrls
    });
    payload.provider = activeProvider;
  }

  const modelPrompt = adapter.configurePrompts?.model;
  if (modelPrompt) {
    const configModel = await resolveConfigModel(
      {
        fs: container.fs,
        filePath: container.env.configPath
      },
      adapter.name
    );
    const model =
      provider?.modelInput?.kind === "freeform" && typeof modelPrompt.choices !== "function"
        ? await resolveFreeformProviderModel({
            container,
            flags,
            options,
            label: modelPrompt.label,
            configModel,
            provider,
            logger
          })
        : await container.options.resolveModel({
            value: options.model,
            assumeDefault: flags.assumeYes,
            defaultValue: configModel ?? modelPrompt.defaultValue,
            choices: await resolveChoices(),
            label: modelPrompt.label,
            onResolve: (label, value) => logger.resolved(label, value)
          });
    payload.model = model;
  }

  const reasoningPrompt = adapter.configurePrompts?.reasoningEffort;
  if (reasoningPrompt) {
    const reasoningEffort = await container.options.resolveReasoning({
      value: options.reasoningEffort,
      assumeDefault: flags.assumeYes,
      defaultValue: reasoningPrompt.defaultValue,
      label: reasoningPrompt.label
    });
    payload.reasoningEffort = reasoningEffort;
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
  label: string;
  configModel: string | null;
  provider: AuthProvider;
  logger: ScopedLogger;
}): Promise<string> {
  const explicitModel = resolveNonEmpty(input.options.model);
  if (explicitModel !== undefined) {
    input.logger.resolved(input.label, explicitModel);
    return explicitModel;
  }

  const configuredModel = resolveNonEmpty(input.configModel ?? undefined);
  if (configuredModel !== undefined) {
    input.logger.resolved(input.label, configuredModel);
    return configuredModel;
  }

  if (input.flags.assumeYes) {
    throw new Error(
      `Provider "${input.provider.id}" requires a model for "${input.label}". Pass --model.`
    );
  }

  return await input.container.options.ensure({
    descriptor: {
      name: "model",
      message: input.label,
      type: "text"
    }
  });
}
