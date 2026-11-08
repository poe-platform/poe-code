import type { CliContainer } from "../container.js";
import type { ScopedLogger } from "../logger.js";
import type { ProviderContext, ProviderService } from "../service-registry.js";
import {
  buildActiveProvider,
  parseProviderShapeBaseUrls,
  resolveAgentDefinition,
  resolveNonEmpty,
  type CommandFlags
} from "./shared.js";
import type { ConfigureCommandOptions } from "./configure.js";
import { ValidationError } from "../errors.js";
import { POE_PROVIDER_ID, type AuthProvider } from "@poe-code/providers";

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
    const activeProvider = await buildActiveProvider({
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

  if (resolveNonEmpty(options.model) !== undefined) {
    throw new ValidationError("configure does not accept --model; pass it to spawn instead.");
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
}

async function resolveConfigureBaseUrl(input: {
  options: ConfigureCommandOptions;
}): Promise<string | undefined> {
  return resolveNonEmpty(input.options.baseUrl);
}
