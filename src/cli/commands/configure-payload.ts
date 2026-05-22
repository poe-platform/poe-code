import {
  loadProviderShapeBaseUrls,
  resolveConfigModel
} from "@poe-code/poe-code-config";
import type { CliContainer } from "../container.js";
import type { ScopedLogger } from "../logger.js";
import type { ProviderContext, ProviderService } from "../service-registry.js";
import {
  buildActiveProvider,
  parseProviderShapeBaseUrls,
  resolveAgentDefinition,
  type ActiveProvider,
  type CommandFlags
} from "./shared.js";
import type { ConfigureCommandOptions } from "./configure.js";
import {
  POE_PROVIDER_ID,
  resolveApiShape,
  type ApiShapeId,
  type AuthProvider
} from "@poe-code/providers";

interface ConfigurePayloadInit {
  container: CliContainer;
  flags: CommandFlags;
  options: ConfigureCommandOptions;
  context: ProviderContext;
  adapter: ProviderService;
  logger: ScopedLogger;
  providerId?: string;
}

export async function createConfigurePayload(init: ConfigurePayloadInit): Promise<unknown> {
  const { container, flags, options, context, adapter, logger, providerId } = init;
  const payload: Record<string, unknown> = { env: context.env };
  let provider: AuthProvider | undefined;

  if (providerId) {
    provider = container.providerRegistry.get(providerId);
    if (!provider) {
      throw new Error(`Unknown provider "${providerId}".`);
    }
    const explicitShapeBaseUrls = parseProviderShapeBaseUrls(provider, options.shapeBaseUrl ?? []);
    const agent = resolveAgentDefinition(adapter.name) ?? { id: adapter.name };
    const apiKey =
      providerId === POE_PROVIDER_ID
        ? await container.options.resolveApiKey({
            value: options.apiKey,
            envValue:
              provider.auth.kind === "api-key"
                ? container.env.getVariable(provider.auth.envVar)
                : undefined,
            dryRun: flags.dryRun,
            assumeYes: flags.assumeYes
          })
        : await container.providerRegistry.resolveCredential(
            providerId,
            { apiKey: options.apiKey },
            { envVars: container.env.variables }
          );
    const explicitBaseUrl = await resolveConfigureBaseUrl({
      container,
      flags,
      logger,
      provider,
      agent,
      options,
      explicitShapeBaseUrls
    });
    const activeProvider: ActiveProvider = await buildActiveProvider({
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
    const model = provider?.modelInput?.kind === "freeform"
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
          choices: modelPrompt.choices,
          label: modelPrompt.label,
          onResolve: (label, value) => logger.resolved(label, value)
        });
    payload.model = model;
  }

  const reasoningPrompt = adapter.configurePrompts?.reasoningEffort;
  if (reasoningPrompt) {
    const reasoningEffort = await container.options.resolveReasoning({
      value: options.reasoningEffort,
      defaultValue: reasoningPrompt.defaultValue,
      label: reasoningPrompt.label
    });
    payload.reasoningEffort = reasoningEffort;
  }

  const extension = await adapter.extendConfigurePayload?.({
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
}

async function resolveConfigureBaseUrl(input: {
  container: CliContainer;
  flags: CommandFlags;
  logger: ScopedLogger;
  provider: AuthProvider;
  agent: { id: string; apiShapes?: readonly ApiShapeId[] };
  options: ConfigureCommandOptions;
  explicitShapeBaseUrls: Partial<Record<ApiShapeId, string>>;
}): Promise<string | undefined> {
  const explicitBaseUrl = nonEmpty(input.options.baseUrl);
  if (explicitBaseUrl !== undefined) {
    return explicitBaseUrl;
  }
  if (input.provider.requiresBaseUrl !== true || input.flags.assumeYes) {
    return undefined;
  }

  const apiShape = resolveApiShape(input.provider, input.agent);
  if (!apiShape) {
    return undefined;
  }
  if (nonEmpty(input.explicitShapeBaseUrls[apiShape]) !== undefined) {
    return undefined;
  }
  if (resolveProviderBaseUrlEnv(input.container, input.provider) !== undefined) {
    return undefined;
  }
  if (await hasStoredShapeBaseUrl(input.container, input.provider.id, apiShape)) {
    return undefined;
  }

  const descriptor = input.container.promptLibrary.providerBaseUrl(input.provider.label);
  while (true) {
    const baseUrl = await input.container.options.ensure({ descriptor });
    if (isHttpBaseUrl(baseUrl)) {
      return baseUrl;
    }
    input.logger.warn("Base URL must start with http:// or https://. Paste the Cloudflare gateway URL, not the API token.");
  }
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
  const explicitModel = nonEmpty(input.options.model);
  if (explicitModel !== undefined) {
    input.logger.resolved(input.label, explicitModel);
    return explicitModel;
  }

  const configuredModel = nonEmpty(input.configModel ?? undefined);
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

function resolveProviderBaseUrlEnv(
  container: CliContainer,
  provider: AuthProvider
): string | undefined {
  const envVar = provider.baseUrlEnvVar;
  if (!envVar) {
    return undefined;
  }
  return nonEmpty(container.env.getVariable(envVar));
}

async function hasStoredShapeBaseUrl(
  container: CliContainer,
  providerId: string,
  apiShape: ApiShapeId
): Promise<boolean> {
  const shapeBaseUrls = await loadProviderShapeBaseUrls({
    fs: container.fs,
    filePath: container.env.servicesConfigPath,
    providerId
  });
  return nonEmpty(shapeBaseUrls[apiShape]) !== undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isHttpBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
