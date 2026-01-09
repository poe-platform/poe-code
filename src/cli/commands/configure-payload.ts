import type { CliContainer } from "../container.js";
import type { ProviderContext, ProviderService } from "../service-registry.js";
import type { CommandFlags } from "./shared.js";
import type { ConfigureCommandOptions } from "./configure.js";

interface ConfigurePayloadInit {
  container: CliContainer;
  flags: CommandFlags;
  options: ConfigureCommandOptions;
  context: ProviderContext;
  adapter: ProviderService;
}

export async function createConfigurePayload(
  init: ConfigurePayloadInit
): Promise<unknown> {
  const { container, flags, options, context, adapter } = init;

  const payload: Record<string, unknown> = { env: context.env };
  if (adapter.requiresApiKey !== false) {
    const apiKey = await container.options.resolveApiKey({
      value: options.apiKey,
      dryRun: flags.dryRun
    });
    payload.apiKey = apiKey;
  }

  const modelPrompt = adapter.configurePrompts?.model;
  if (modelPrompt) {
    const model = await container.options.resolveModel({
      value: options.model,
      assumeDefault: flags.assumeYes,
      defaultValue: modelPrompt.defaultValue,
      choices: modelPrompt.choices,
      label: modelPrompt.label
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

  return payload;
}
