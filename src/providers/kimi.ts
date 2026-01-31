import {
  createBinaryExistsCheck,
  createCommandExpectationCheck
} from "../utils/command-checks.js";
import {
  configMutation,
  fileMutation
} from "@poe-code/config-mutations";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import { KIMI_MODELS, DEFAULT_KIMI_MODEL, PROVIDER_NAME, stripModelNamespace } from "../cli/constants.js";
import { createProvider } from "./create-provider.js";
import type { TomlTable } from "../utils/toml.js";
import type {
  ProviderSpawnOptions,
  ModelConfigureOptions,
  EmptyProviderOptions
} from "./spawn-options.js";
import { kimiAgent } from "@poe-code/agent-defs";

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
  const stripped = stripModelNamespace(model);
  return `${PROVIDER_NAME}/${stripped}`;
}

function buildKimiArgs(prompt: string, extraArgs?: string[]): string[] {
  return [prompt, ...(extraArgs ?? [])];
}

export const kimiService = createProvider<
  ModelConfigureOptions,
  EmptyProviderOptions,
  ProviderSpawnOptions
>({
  ...kimiAgent,
  disabled: false,
  supportsStdinPrompt: false,
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
  mcp: {
    configFile: "~/.kimi/mcp.json",
    configKey: "mcpServers"
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
      fileMutation.ensureDirectory({ path: "~/.kimi" }),
      configMutation.merge({
        target: "~/.kimi/config.toml",
        pruneByPrefix: { models: `${PROVIDER_NAME}/` },
        value: (ctx) => {
          const { model, apiKey, env } = (ctx ?? {}) as {
            model?: string;
            apiKey?: string;
            env: { poeApiBaseUrl: string };
          };
          const selectedModel = model ?? DEFAULT_KIMI_MODEL;

          const models: TomlTable = {};
          for (const m of KIMI_MODELS) {
            models[providerModel(m)] = {
              provider: PROVIDER_NAME,
              model: stripModelNamespace(m),
              max_context_size: 256000
            };
          }

          return {
            default_model: providerModel(selectedModel),
            default_thinking: true,
            models,
            providers: {
              [PROVIDER_NAME]: {
                type: "openai_legacy",
                base_url: env.poeApiBaseUrl,
                api_key: apiKey ?? ""
              }
            }
          };
        }
      })
    ],
    unconfigure: [
      configMutation.transform({
        target: "~/.kimi/config.toml",
        transform: (document) => {
          const providers = document.providers as TomlTable | undefined;
          if (!providers || typeof providers !== "object") {
            return { changed: false, content: document };
          }
          if (!(PROVIDER_NAME in providers)) {
            return { changed: false, content: document };
          }
          const { [PROVIDER_NAME]: ignoredProvider, ...rest } = providers;
          void ignoredProvider;
          const updatedProviders = rest as TomlTable;
          if (Object.keys(updatedProviders).length === 0) {
            const { providers: ignoredProviders, ...docWithoutProviders } = document;
            void ignoredProviders;
            return { changed: true, content: docWithoutProviders };
          }
          return { changed: true, content: { ...document, providers: updatedProviders } };
        }
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
