import type { CliContainer } from "../container.js";
import type { ScopedLogger } from "../logger.js";
import type { ProviderContext, ProviderService } from "../service-registry.js";
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
): Promise<unknown> {
  const { container, flags, options, context, adapter, logger } = init;

  if (options.direct) {
    return createDirectPayload(init);
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

  return payload;
}

async function createDirectPayload(
  init: ConfigurePayloadInit
): Promise<unknown> {
  const { container, flags, options, context, adapter } = init;

  if (!adapter.supportsDirect) {
    throw new Error(
      `Provider "${adapter.name}" does not support --direct mode.`
    );
  }

  if (flags.assumeYes && !options.apiKey) {
    throw new Error(
      "--api-key is required in direct mode when --yes is set."
    );
  }

  let apiKey: string;
  if (options.apiKey) {
    apiKey = normalizeAnthropicKey(options.apiKey, container.options.normalizeApiKey);
  } else {
    const descriptor = container.promptLibrary.directApiKey();
    const response = await container.prompts(descriptor);
    const result = response[descriptor.name];
    if (typeof result !== "string") {
      throw new Error("Anthropic API key is required.");
    }
    apiKey = normalizeAnthropicKey(result, container.options.normalizeApiKey);
  }

  const payload: Record<string, unknown> = { env: context.env, apiKey, direct: true };

  const modelPrompt = adapter.configurePrompts?.model;
  if (modelPrompt) {
    payload.model = options.model ?? modelPrompt.defaultValue;
  }

  return payload;
}

function normalizeAnthropicKey(
  value: string,
  normalize: (v: string) => string
): string {
  try {
    return normalize(value);
  } catch {
    throw new Error("Anthropic API key cannot be empty.");
  }
}
