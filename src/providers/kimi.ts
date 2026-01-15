import {
  createBinaryExistsCheck,
  createCommandExpectationCheck
} from "../utils/command-checks.js";
import {
  ensureDirectory,
  jsonMergeMutation,
  jsonPruneMutation
} from "../services/service-manifest.js";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import { KIMI_MODELS, DEFAULT_KIMI_MODEL, PROVIDER_NAME } from "../cli/constants.js";
import { createProvider } from "./create-provider.js";
import type { JsonObject } from "../utils/json.js";
import type {
  ProviderSpawnOptions,
  ModelConfigureOptions,
  EmptyProviderOptions
} from "./spawn-options.js";

export const KIMI_INSTALL_DEFINITION: ServiceInstallDefinition = {
  id: "kimi",
  summary: "Kimi CLI",
  check: createBinaryExistsCheck(
    "kimi",
    "kimi-cli-binary",
    "Kimi CLI binary must exist"
  ),
  steps: [
    {
      id: "install-kimi-cli-uv",
      command: "uv",
      args: ["tool", "install", "--python", "3.13", "kimi-cli"]
    }
  ],
  successMessage: "Installed Kimi CLI via uv."
};

function providerModel(model: string): string {
  const prefix = `${PROVIDER_NAME}/`;
  return model.startsWith(prefix) ? model : `${prefix}${model}`;
}

function buildKimiArgs(prompt: string, extraArgs?: string[]): string[] {
  return [prompt, ...(extraArgs ?? [])];
}

export const kimiService = createProvider<
  ModelConfigureOptions,
  EmptyProviderOptions,
  ProviderSpawnOptions
>({
  disabled: false,
  name: "kimi",
  aliases: ["kimi-cli"],
  label: "Kimi",
  id: "kimi",
  summary: "Configure Kimi CLI to use Poe API",
  supportsStdinPrompt: false,
  branding: {
    colors: {
      dark: "#7B68EE",
      light: "#6A5ACD"
    }
  },
  configurePrompts: {
    model: {
      label: "Kimi default model",
      defaultValue: DEFAULT_KIMI_MODEL,
      choices: KIMI_MODELS.map((id) => ({
        title: id,
        value: id
      }))
    }
  },
  test(context) {
    return context.runCheck(
      createCommandExpectationCheck({
        id: "kimi-cli-health",
        command: "kimi",
        args: buildKimiArgs("Output exactly: KIMI_OK"),
        expectedOutput: "KIMI_OK"
      })
    );
  },
  manifest: {
    configure: [
        ensureDirectory({
          targetDirectory: "~/.kimi"
        }),
        jsonMergeMutation({
          targetDirectory: "~/.kimi",
          targetFile: "config.json",
          value: ({ options }) => {
            const { model, apiKey } = (options ?? {}) as {
              model?: string;
              apiKey?: string;
            };
            const selectedModel = model ?? DEFAULT_KIMI_MODEL;
            return {
              default_model: providerModel(selectedModel),
              models: {
                [providerModel(selectedModel)]: {
                  provider: PROVIDER_NAME,
                  model: selectedModel,
                  max_context_size: 256000
                }
              },
              providers: {
                [PROVIDER_NAME]: {
                  type: "openai_legacy",
                  base_url: "https://api.poe.com/v1",
                  api_key: apiKey ?? ""
                }
              }
            };
          }
        })
    ],
    unconfigure: [
        jsonPruneMutation({
          targetDirectory: "~/.kimi",
          targetFile: "config.json",
          shape: (): JsonObject => ({
            providers: {
              [PROVIDER_NAME]: true
            }
          })
        })
    ]
  },
  install: KIMI_INSTALL_DEFINITION,
  spawn(context, options) {
    const args = buildKimiArgs(options.prompt, options.args);
    if (options.cwd) {
      return context.command.runCommand("kimi", args, {
        cwd: options.cwd
      });
    }
    return context.command.runCommand("kimi", args);
  }
});
