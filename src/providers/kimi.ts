import {
  createBinaryExistsCheck,
  createSpawnHealthCheck
} from "../utils/command-checks.js";
import {
  configMutation,
  fileMutation,
  type ConfigObject
} from "@poe-code/config-mutations";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import { KIMI_MODELS, DEFAULT_KIMI_MODEL, PROVIDER_NAME, stripModelNamespace } from "../cli/constants.js";
import { createProvider } from "./create-provider.js";
import type {
  ProviderSpawnOptions,
  ModelConfigureOptions,
  EmptyProviderOptions
} from "./spawn-options.js";
import { kimiAgent } from "@poe-code/agent-defs";
import type { ActiveProvider } from "../cli/commands/shared.js";

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
  return ["--quiet", "-p", prompt, ...(extraArgs ?? [])];
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
  isolatedEnv: {
    // Use "kimi-cli" to avoid stripAgentHome stripping ".kimi" from paths
    agentBinary: "kimi-cli",
    configProbe: { kind: "isolatedFile", relativePath: ".kimi/config.toml" },
    env: {
      HOME: { kind: "isolatedDir" }
    }
  },
  test(context) {
    return context.runCheck(
      createSpawnHealthCheck("kimi", {
        model: context.model,
        expectedOutput: "KIMI_OK"
      })
    );
  },
  manifest: {
    configure: [
      fileMutation.ensureDirectory({ path: "~/.kimi" }),
      fileMutation.ensureDirectory({ path: "~/.kimi/credentials" }),
      configMutation.merge({
        target: "~/.kimi/credentials/kimi-code.json",
        value: () => ({
          access_token: "poe-managed",
          token_type: "Bearer",
          expires_at: Math.floor(Date.now() / 1000) + 86400 * 365 * 10
        })
      }),
      configMutation.transform({
        target: "~/.kimi/config.toml",
        transform: (document, ctx) => {
          const { model, provider } = (ctx ?? {}) as {
            model?: string;
            provider?: ActiveProvider;
          };
          const selectedModel = model ?? DEFAULT_KIMI_MODEL;

          const models: ConfigObject = {};
          for (const m of KIMI_MODELS) {
            models[providerModel(m)] = {
              provider: PROVIDER_NAME,
              model: stripModelNamespace(m),
              max_context_size: 256000
            };
          }

          const existingModels = toConfigObject(document.models);
          const retainedModels = Object.fromEntries(
            Object.entries(existingModels).filter(([, entry]) => !isPoeModel(entry))
          );
          const content: ConfigObject = {
            ...document,
            default_model: providerModel(selectedModel),
            default_thinking: true,
            models: { ...retainedModels, ...models },
            providers: {
              ...toConfigObject(document.providers),
              [PROVIDER_NAME]: {
                type: "openai_legacy",
                base_url: provider?.baseUrl ?? "",
                api_key: provider?.credential ?? ""
              }
            }
          };
          return {
            content,
            changed: JSON.stringify(document) !== JSON.stringify(content)
          };
        }
      })
    ],
    unconfigure: [
      configMutation.transform({
        target: "~/.kimi/config.toml",
        transform: (document) => {
          const providers = document.providers as ConfigObject | undefined;
          if (!providers || typeof providers !== "object") {
            return { changed: false, content: document };
          }
          if (!(PROVIDER_NAME in providers)) {
            return { changed: false, content: document };
          }
          const { [PROVIDER_NAME]: ignoredProvider, ...rest } = providers;
          void ignoredProvider;
          const updatedProviders = rest as ConfigObject;
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

export const provider = kimiService;

function toConfigObject(value: unknown): ConfigObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as ConfigObject)
    : {};
}

function isPoeModel(value: unknown): boolean {
  return toConfigObject(value).provider === PROVIDER_NAME;
}
