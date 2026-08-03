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
import { PROVIDER_NAME } from "../cli/constants.js";
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

function buildKimiArgs(prompt: string, model?: string, extraArgs?: string[]): string[] {
  return ["--quiet", "-p", prompt, ...(model ? ["--model", model] : []), ...(extraArgs ?? [])];
}

export const kimiService = createProvider<
  ModelConfigureOptions,
  EmptyProviderOptions,
  ProviderSpawnOptions
>({
  ...kimiAgent,
  disabled: false,
  supportsStdinPrompt: false,
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
          const { provider } = (ctx ?? {}) as {
            provider?: ActiveProvider;
          };
          const content: ConfigObject = {
            ...document,
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
      fileMutation.remove({ target: "~/.kimi/credentials/kimi-code.json" }),
      configMutation.transform({
        target: "~/.kimi/config.toml",
        transform: (document) => {
          const providers = toConfigObject(document.providers);
          const models = toConfigObject(document.models);
          const retainedModels = Object.fromEntries(
            Object.entries(models).filter(([, entry]) => !isPoeModel(entry))
          );
          const content: ConfigObject = { ...document };
          let changed = false;
          if (PROVIDER_NAME in providers) {
            const { [PROVIDER_NAME]: ignoredProvider, ...retainedProviders } = providers;
            void ignoredProvider;
            if (Object.keys(retainedProviders).length === 0) {
              delete content.providers;
            } else {
              content.providers = retainedProviders;
            }
            changed = true;
          }
          if (Object.keys(retainedModels).length !== Object.keys(models).length) {
            if (Object.keys(retainedModels).length === 0) {
              delete content.models;
            } else {
              content.models = retainedModels;
            }
            changed = true;
          }
          if (typeof content.default_model === "string" && content.default_model.startsWith(`${PROVIDER_NAME}/`)) {
            delete content.default_model;
            delete content.default_thinking;
            changed = true;
          }
          return { changed, content };
        }
      })
    ]
  },
  install: KIMI_INSTALL_DEFINITION,
  spawn(context, options) {
    const args = buildKimiArgs(options.prompt, options.model, options.args);
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
