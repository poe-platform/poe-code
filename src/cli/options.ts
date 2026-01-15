import type { PromptDescriptor, PromptLibrary } from "./prompts.js";
import type { PromptFn } from "./types.js";

/**
 * Strips bracketed paste artifacts from input.
 *
 * When pasting in tmux/iTerm2, terminals send bracketed paste escape sequences
 * (\x1b[200~ at start, \x1b[201~ at end). The prompts library mishandles these
 * and produces artifacts like "undefined" or "ndefined" in the output. We strip
 * both the raw escape sequences and the mangled string artifacts.
 */
function stripBracketedPaste(value: string): string {
  return value
    .replace(/\x1b\[200~/g, "")
    .replace(/\x1b\[201~/g, "")
    .replace(/undefinedndefined$/, "")
    .replace(/undefined$/, "")
    .replace(/ndefined$/, "");
}

export interface ApiKeyStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

export interface EnsureOptionInput<TName extends string = string> {
  value?: string;
  fallback?: string;
  descriptor: PromptDescriptor<TName>;
}

export interface ResolveApiKeyInput {
  value?: string;
  dryRun: boolean;
}

export interface ResolveModelInput {
  value?: string;
  assumeDefault?: boolean;
  defaultValue: string;
  choices: Array<{ title: string; value: string }>;
  label: string;
}

export interface ResolveReasoningInput {
  value?: string;
  defaultValue: string;
  label: string;
}

export interface OptionResolvers {
  ensure<TName extends string>(
    input: EnsureOptionInput<TName>
  ): Promise<string>;
  resolveModel(
    input: ResolveModelInput
  ): Promise<string>;
  resolveReasoning(input: ResolveReasoningInput): Promise<string>;
  resolveConfigName(
    value: string | undefined,
    defaultValue: string
  ): Promise<string>;
  resolveApiKey(input: ResolveApiKeyInput): Promise<string>;
  normalizeApiKey(value: string): string;
}

export interface OptionResolverInit {
  prompts: PromptFn;
  promptLibrary: PromptLibrary;
  apiKeyStore: ApiKeyStore;
}

export function createOptionResolvers(
  init: OptionResolverInit
): OptionResolvers {
  const ensure = async <TName extends string>(
    input: EnsureOptionInput<TName>
  ): Promise<string> => {
    if (input.value != null) {
      return input.value;
    }
    if (input.fallback != null) {
      return input.fallback;
    }
    const response = await init.prompts(input.descriptor);
    const result = response[input.descriptor.name];
    if (typeof result !== "string" || result.trim() === "") {
      throw new Error(`Missing value for "${input.descriptor.name}".`);
    }
    return result;
  };

  const normalizeApiKey = (value: string): string => {
    const sanitized = stripBracketedPaste(value);
    const trimmed = sanitized.trim();
    if (trimmed.length === 0) {
      throw new Error("POE API key cannot be empty.");
    }
    return trimmed;
  };

  const resolveApiKey = async (
    input: ResolveApiKeyInput
  ): Promise<string> => {
    if (input.value != null) {
      const apiKey = normalizeApiKey(input.value);
      if (!input.dryRun) {
        await init.apiKeyStore.write(apiKey);
      }
      return apiKey;
    }

    const stored = await init.apiKeyStore.read();
    if (stored) {
      return normalizeApiKey(stored);
    }

    const descriptor = init.promptLibrary.loginApiKey();
    const response = await init.prompts(descriptor);
    const result = response[descriptor.name];
    if (typeof result !== "string") {
      throw new Error("POE API key is required.");
    }
    const apiKey = normalizeApiKey(result);
    if (!input.dryRun) {
      await init.apiKeyStore.write(apiKey);
    }
    return apiKey;
  };

  const resolveModel = async ({
    value,
    assumeDefault,
    defaultValue,
    choices,
    label
  }: ResolveModelInput): Promise<string> => {
    if (value != null) {
      return value;
    }
    if (choices.length === 1) {
      return choices[0]!.value;
    }
    if (assumeDefault) {
      return defaultValue;
    }
    const descriptor = init.promptLibrary.model({
      label,
      defaultValue,
      choices
    });
    const response = await init.prompts(descriptor);
    const result = response[descriptor.name];
    if (typeof result !== "string" || result.trim() === "") {
      throw new Error(`Missing value for "${descriptor.name}".`);
    }
    return result;
  };

  const resolveReasoning = async ({
    value,
    defaultValue,
    label
  }: ResolveReasoningInput): Promise<string> =>
    await ensure({
      value,
      descriptor: init.promptLibrary.reasoningEffort({
        label,
        defaultValue
      }),
      fallback: defaultValue
    });

  const resolveConfigName = async (
    value: string | undefined,
    defaultValue: string
  ): Promise<string> =>
    await ensure({
      value,
      descriptor: init.promptLibrary.configName(defaultValue),
      fallback: defaultValue
    });

  return {
    ensure,
    resolveModel,
    resolveReasoning,
    resolveConfigName,
    resolveApiKey,
    normalizeApiKey
  };
}
