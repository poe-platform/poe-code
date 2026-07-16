import type { ActiveProvider } from "./commands/shared.js";
import type { CliEnvironment } from "./environment.js";
import type { HttpClient } from "./http.js";

export type ModelChoice = { title: string; value: string };
export type ModelChoices =
  | ReadonlyArray<ModelChoice>
  | ((ctx: {
      httpClient: HttpClient;
      provider: ActiveProvider;
      env: CliEnvironment;
    }) => Promise<ReadonlyArray<ModelChoice>>);

export interface PromptDescriptor<TName extends string = string> {
  readonly name: TName;
  readonly message: string;
  readonly type?: string;
  readonly initial?: string | number;
  readonly choices?: ReadonlyArray<ModelChoice>;
  readonly validate?: (value: string | undefined) => string | undefined;
}

export interface ModelPromptInput {
  label: string;
  defaultValue: string;
  choices?: ModelChoices;
  /** Short names accepted on the command line, mapped to their catalog id. */
  aliases?: Readonly<Record<string, string>>;
  /** Set when `choices` is the complete set the agent accepts, so unknown ids are rejected. */
  strictChoices?: boolean;
}

export interface ResolvedModelPromptInput {
  label: string;
  defaultValue: string;
  choices?: ReadonlyArray<ModelChoice>;
}

export interface ReasoningPromptInput {
  label: string;
  defaultValue: string;
}

export interface ServiceSelectionInput {
  message: string;
  choices: ReadonlyArray<ModelChoice>;
}

export interface PromptLibrary {
  loginApiKey(): PromptDescriptor<"apiKey">;
  providerBaseUrl(label: string): PromptDescriptor<"baseUrl">;
  model(input: ResolvedModelPromptInput): PromptDescriptor<"model">;
  reasoningEffort(input: ReasoningPromptInput): PromptDescriptor<"reasoningEffort">;
  configName(defaultName: string): PromptDescriptor<"configName">;
  serviceSelection(
    input: ServiceSelectionInput
  ): PromptDescriptor<"serviceSelection"> & { type: "select" };
}

export function createPromptLibrary(): PromptLibrary {
  const describe = <TName extends string>(
    descriptor: PromptDescriptor<TName>
  ): PromptDescriptor<TName> => descriptor;

  return {
    loginApiKey: () =>
      describe({
        name: "apiKey",
        message: "Enter your Poe API key - get one at https://poe.com/api/keys",
        type: "password"
      }),
    providerBaseUrl: (label: string) =>
      describe({
        name: "baseUrl",
        message: `${label} base URL`,
        type: "text"
      }),
    model: ({ label, defaultValue, choices }) => {
      if (!choices || choices.length === 0) {
        return describe({
          name: "model",
          message: label,
          type: "text",
          initial: defaultValue
        });
      }
      const initial = Math.max(
        choices.findIndex((choice) => choice.value === defaultValue),
        0
      );
      return describe({
        name: "model",
        message: label,
        type: "select",
        initial,
        choices
      });
    },
    reasoningEffort: ({ label, defaultValue }) =>
      describe({
        name: "reasoningEffort",
        message: label,
        type: "text",
        initial: defaultValue
      }),
    configName: (defaultName: string) =>
      describe({
        name: "configName",
        message: "Configuration name",
        type: "text",
        initial: defaultName
      }),
    serviceSelection: ({ message, choices }) => {
      const descriptor: PromptDescriptor<"serviceSelection"> & {
        type: "select";
      } = {
        name: "serviceSelection",
        message,
        type: "select",
        choices
      };
      return descriptor;
    }
  };
}
