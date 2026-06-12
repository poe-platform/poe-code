import type { ModelChoice, PromptDescriptor, PromptLibrary } from "./prompts.js";
import type { PromptFn } from "./types.js";

/**
 * Strips bracketed paste artifacts from input.
 *
 * When pasting in tmux/iTerm2, terminals send bracketed paste escape sequences
 * (\x1b[200~ at start, \x1b[201~ at end). Some prompt inputs leak these into the
 * captured value and produce artifacts like "undefined" or "ndefined". We strip
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
  envValue?: string;
  dryRun: boolean;
  assumeYes?: boolean;
  allowStored?: boolean;
}

export interface ResolveModelInput {
  value?: string;
  assumeDefault?: boolean;
  defaultValue: string;
  choices?: ReadonlyArray<ModelChoice>;
  label: string;
  onResolve?: (label: string, value: string) => void;
}

export interface ResolveReasoningInput {
  value?: string;
  assumeDefault?: boolean;
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
}

export interface OptionResolverInit {
  prompts: PromptFn;
  promptLibrary: PromptLibrary;
  apiKeyStore: ApiKeyStore;
  confirm: (message: string) => Promise<boolean>;
  checkAuth: (apiKey: string) => Promise<boolean>;
  loginViaOAuth?: () => Promise<string>;
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

  const validateApiKey = async (apiKey: string): Promise<boolean> => {
    return await init.checkAuth(apiKey);
  };

  const resolveApiKey = async (
    input: ResolveApiKeyInput
  ): Promise<string> => {
    const assumeYes = input.assumeYes ?? false;
    const allowStored = input.allowStored ?? true;

    if (input.value != null) {
      const apiKey = normalizeApiKey(input.value);
      if (!await validateApiKey(apiKey)) {
        throw new Error("API key rejected.");
      }
      if (!input.dryRun) {
        await init.apiKeyStore.write(apiKey);
      }
      return apiKey;
    }

    const envValue = input.envValue;
    if (typeof envValue === "string" && envValue.trim().length > 0) {
      const useEnv = assumeYes ||
        await init.confirm(
          "Use API key from POE_API_KEY environment variable?"
        );
      if (useEnv) {
        const apiKey = normalizeApiKey(envValue);
        if (await validateApiKey(apiKey)) {
          if (!input.dryRun) {
            await init.apiKeyStore.write(apiKey);
          }
          return apiKey;
        }
        if (assumeYes) {
          throw new Error("API key rejected.");
        }
      }
    }

    if (allowStored) {
      const stored = await init.apiKeyStore.read();
      if (stored) {
        return normalizeApiKey(stored);
      }
    }

    if (assumeYes) {
      throw new Error(
        "No API key found. Pass --api-key, set POE_API_KEY, or run without --yes to authenticate interactively."
      );
    }

    if (init.loginViaOAuth) {
      const apiKey = await init.loginViaOAuth();
      const normalized = normalizeApiKey(apiKey);
      if (!input.dryRun) {
        await init.apiKeyStore.write(normalized);
      }
      return normalized;
    }

    while (true) {
      const descriptor = init.promptLibrary.loginApiKey();
      const response = await init.prompts(descriptor);
      const result = response[descriptor.name];
      if (typeof result !== "string") {
        continue;
      }
      let apiKey: string;
      try {
        apiKey = normalizeApiKey(result);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "POE API key cannot be empty."
        ) {
          continue;
        }
        throw error;
      }
      if (!await validateApiKey(apiKey)) {
        continue;
      }
      if (!input.dryRun) {
        await init.apiKeyStore.write(apiKey);
      }
      return apiKey;
    }
  };

  const resolveModel = async ({
    value,
    assumeDefault,
    defaultValue,
    choices = [],
    label,
    onResolve
  }: ResolveModelInput): Promise<string> => {
    if (value != null) {
      onResolve?.(label, value);
      return value;
    }
    if (choices.length === 1) {
      onResolve?.(label, choices[0]!.value);
      return choices[0]!.value;
    }
    if (assumeDefault) {
      onResolve?.(label, defaultValue);
      return defaultValue;
    }
    if (!choices || choices.length === 0) {
      return await ensure({
        value,
        descriptor: init.promptLibrary.model({
          label,
          defaultValue
        })
      });
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
    assumeDefault,
    defaultValue,
    label
  }: ResolveReasoningInput): Promise<string> =>
    await ensure({
      value,
      descriptor: init.promptLibrary.reasoningEffort({
        label,
        defaultValue
      }),
      fallback: assumeDefault ? defaultValue : undefined
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
    resolveApiKey
  };
}
