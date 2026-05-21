import { resolveConfigModel } from "@poe-code/poe-code-config";
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

  if (providerId) {
    const provider = container.providerRegistry.get(providerId);
    if (!provider) {
      throw new Error(`Unknown provider "${providerId}".`);
    }
    const explicitShapeBaseUrls = parseProviderShapeBaseUrls(provider, options.shapeBaseUrl ?? []);
    const apiKey = await container.options.resolveApiKey({
      value: options.apiKey,
      envValue:
        provider.auth.kind === "api-key"
          ? container.env.getVariable(provider.auth.envVar)
          : undefined,
      dryRun: flags.dryRun,
      assumeYes: flags.assumeYes
    });
    const activeProvider: ActiveProvider = await buildActiveProvider({
      container,
      provider,
      agent: resolveAgentDefinition(adapter.name) ?? { id: adapter.name },
      credential: apiKey,
      explicitBaseUrl: options.baseUrl,
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
    const model = await container.options.resolveModel({
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
