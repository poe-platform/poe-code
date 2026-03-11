import type { CliContainer } from "../container.js";
import type { ScopedLogger } from "../logger.js";
import type {
  ProviderConfigurePayload,
  ProviderContext,
  ProviderService
} from "../service-registry.js";
import type { CommandFlags } from "./shared.js";
import type { ConfigureCommandOptions } from "./configure.js";

interface ConfigurePayloadInit {
  container: CliContainer;
  flags: CommandFlags;
  options: ConfigureCommandOptions;
  context: ProviderContext;
  adapter: ProviderService;
  logger: ScopedLogger;
}

export async function createConfigurePayload(
  init: ConfigurePayloadInit
): Promise<ProviderConfigurePayload> {
  const { container, flags, options, context, adapter, logger } = init;

  if (adapter.buildConfigurePayload) {
    return await adapter.buildConfigurePayload({
      container,
      flags,
      options,
      context,
      logger
    });
  }

  const apiKey = await container.options.resolveApiKey({
    value: options.apiKey,
    envValue: container.env.getVariable("POE_API_KEY"),
    dryRun: flags.dryRun,
    assumeYes: flags.assumeYes
  });
  const payload: Record<string, unknown> = { env: context.env, apiKey };

  const modelPrompt = adapter.configurePrompts?.model;
  if (modelPrompt) {
    const model = await container.options.resolveModel({
      value: options.model,
      assumeDefault: flags.assumeYes,
      defaultValue: modelPrompt.defaultValue,
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

  return {
    options: payload
  };
}
