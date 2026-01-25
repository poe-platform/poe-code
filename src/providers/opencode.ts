import {
  DEFAULT_FRONTIER_MODEL,
  FRONTIER_MODELS,
  PROVIDER_NAME
} from "../cli/constants.js";
import type { JsonObject } from "../utils/json.js";
import {
  createBinaryExistsCheck,
  createCommandExpectationCheck
} from "../utils/command-checks.js";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import {
  ensureDirectory,
  jsonMergeMutation,
  jsonPruneMutation
} from "../services/service-manifest.js";
import { createProvider } from "./create-provider.js";
import type { ProviderSpawnOptions } from "./spawn-options.js";

function providerModel(model?: string): string {
  const value = model ?? DEFAULT_FRONTIER_MODEL;
  const prefix = `${PROVIDER_NAME}/`;
  return value.startsWith(prefix) ? value : `${prefix}${value}`;
}

const FRONTIER_MODEL_RECORD = FRONTIER_MODELS.reduce<
  Record<string, { name: string }>
>((acc, id) => {
  acc[id] = { name: id };
  return acc;
}, {});

export const OPEN_CODE_INSTALL_DEFINITION: ServiceInstallDefinition = {
  id: "opencode",
  summary: "OpenCode CLI",
  check: createBinaryExistsCheck(
    "opencode",
    "opencode-cli-binary",
    "OpenCode CLI binary must exist"
  ),
  steps: [
    {
      id: "install-opencode-cli-npm",
      command: "npm",
      args: ["install", "-g", "opencode-ai"]
    }
  ],
  successMessage: "Installed OpenCode CLI via npm."
};

function getModelArgs(model?: string): string[] {
  return ["--model", providerModel(model)];
}

export const openCodeService = createProvider({
  name: "opencode",
  label: "OpenCode CLI",
  id: "opencode",
  summary: "Configure OpenCode CLI to use the Poe API.",
  supportsStdinPrompt: false,
  branding: {
    colors: {
      dark: "#4A4F55",
      light: "#2F3338"
    }
  },
  configurePrompts: {
    model: {
      label: "OpenCode model",
      defaultValue: DEFAULT_FRONTIER_MODEL,
      choices: FRONTIER_MODELS.map((id) => ({
        title: id,
        value: id
      }))
    }
  },
  isolatedEnv: {
    agentBinary: "opencode",
    configProbe: {
      kind: "isolatedFile",
      relativePath: ".config/opencode/config.json"
    },
    env: {
      XDG_CONFIG_HOME: { kind: "isolatedDir", relativePath: ".config" },
      XDG_DATA_HOME: { kind: "isolatedDir", relativePath: ".local/share" }
    }
  },
  manifest: {
    configure: [
        ensureDirectory({
          targetDirectory: "~/.config/opencode"
        }),
        ensureDirectory({
          targetDirectory: "~/.local/share/opencode"
        }),
        jsonMergeMutation({
          targetDirectory: "~/.config/opencode",
          targetFile: "config.json",
          value: ({ options }) => {
            const { model, env } = (options ?? {}) as {
              model?: string;
              env: { poeApiBaseUrl: string };
            };
            const baseUrl = env.poeApiBaseUrl;
            return {
              $schema: "https://opencode.ai/config.json",
              model: providerModel(model),
              provider: {
                [PROVIDER_NAME]: {
                  npm: "@ai-sdk/openai-compatible",
                  name: "poe.com",
                  options: {
                    baseURL: baseUrl
                  },
                  models: FRONTIER_MODEL_RECORD
                }
              }
            };
          }
        }),
        jsonMergeMutation({
          targetDirectory: "~/.local/share/opencode",
          targetFile: "auth.json",
          value: ({ options }) => {
            const { apiKey } = (options ?? {}) as { apiKey?: string };
            return {
              [PROVIDER_NAME]: {
                type: "api",
                key: apiKey ?? ""
              }
            };
          }
        })
    ],
    unconfigure: [
        jsonPruneMutation({
          targetDirectory: "~/.config/opencode",
          targetFile: "config.json",
          shape: (): JsonObject => ({
            provider: {
              [PROVIDER_NAME]: true
            }
          })
        }),
        jsonPruneMutation({
          targetDirectory: "~/.local/share/opencode",
          targetFile: "auth.json",
          shape: (): JsonObject => ({
            [PROVIDER_NAME]: true
          })
        })
    ]
  },
  install: OPEN_CODE_INSTALL_DEFINITION,
  test(context) {
    return context.runCheck(
      createCommandExpectationCheck({
        id: "opencode-cli-health",
        command: "opencode",
        args: [
          ...getModelArgs(DEFAULT_FRONTIER_MODEL),
          "run",
          "Output exactly: OPEN_CODE_OK"
        ],
        expectedOutput: "OPEN_CODE_OK"
      })
    );
  },
  spawn(context, options) {
    const opts = (options ?? {}) as ProviderSpawnOptions;
    const args = [
      ...getModelArgs(opts.model),
      "run",
      opts.prompt,
      ...(opts.args ?? [])
    ];
    if (opts.cwd) {
      return context.command.runCommand("poe-code", ["wrap", "opencode", ...args], {
        cwd: opts.cwd
      });
    }
    return context.command.runCommand("poe-code", ["wrap", "opencode", ...args]);
  }
});
