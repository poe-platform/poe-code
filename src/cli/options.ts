import { ValidationError } from "./errors.js";
import type { ModelChoice, PromptDescriptor, PromptLibrary } from "./prompts.js";
import type { PromptFn } from "./types.js";

/**
 * Strips bracketed paste artifacts from input.
 *
 * When pasting in tmux/iTerm2, terminals send bracketed paste escape sequences
 * (\x1b[200~ at start, \x1b[201~ at end). Some prompt inputs leak these into the
 * captured value. Only the control sequences are removed so literal key bytes
 * are not mutated before validation or storage.
 */
function stripBracketedPaste(value: string): string {
  return value
    .split("\x1b[200~").join("")
    .split("\x1b[201~").join("");
}

export interface ApiKeyStore {
  read(options?: { readOnly?: boolean }): Promise<string | null>;
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
  /** Short names accepted on the command line, mapped to their catalog id. */
  aliases?: Readonly<Record<string, string>>;
  /** Set when `choices` is the complete catalog, so unknown ids can be rejected. */
  strictChoices?: boolean;
  label: string;
  onResolve?: (label: string, value: string) => void;
}

export interface ResolveReasoningInput {
  value: string;
  /** Levels the selected model accepts; anything else is rejected. */
  levels: ReadonlyArray<string>;
  label: string;
  onResolve?: (label: string, value: string) => void;
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

function unknownModelMessage(input: {
  value: string;
  choices: ReadonlyArray<ModelChoice>;
  aliases?: Readonly<Record<string, string>>;
  label: string;
}): string {
  const known = [
    ...Object.keys(input.aliases ?? {}),
    ...input.choices.map((choice) => choice.value)
  ];
  const needle = input.value.toLowerCase();
  const near = known.filter((candidate) => {
    const id = candidate.toLowerCase();
    return id.includes(needle) || needle.includes(id);
  });
  const hint =
    near.length > 0
      ? `Did you mean: ${near.join(", ")}?`
      : `Available models: ${known.join(", ")}.`;
  return `Unknown model "${input.value}" for ${input.label}. ${hint}`;
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
      const stored = await init.apiKeyStore.read({ readOnly: input.dryRun });
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
    aliases,
    strictChoices,
    label,
    onResolve
  }: ResolveModelInput): Promise<string> => {
    if (value != null) {
      const resolved = aliases?.[value] ?? value;
      if (
        strictChoices &&
        choices.length > 0 &&
        !choices.some((choice) => choice.value === resolved)
      ) {
        throw new ValidationError(unknownModelMessage({ value, choices, aliases, label }));
      }
      onResolve?.(label, resolved);
      return resolved;
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
    levels,
    label,
    onResolve
  }: ResolveReasoningInput): Promise<string> => {
    if (!levels.includes(value)) {
      throw new ValidationError(
        `Unknown reasoning effort "${value}" for ${label}. Supported levels: ${levels.join(", ")}.`
      );
    }
    onResolve?.(label, value);
    return value;
  };

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
