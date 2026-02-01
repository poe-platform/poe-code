import {
  DEFAULT_FRONTIER_MODEL,
  FRONTIER_MODELS,
  PROVIDER_NAME
} from "../cli/constants.js";
import {
  createBinaryExistsCheck,
  createCommandExpectationCheck
} from "../utils/command-checks.js";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import {
  configMutation,
  fileMutation
} from "@poe-code/config-mutations";
import { createProvider } from "./create-provider.js";
import type { ProviderSpawnOptions } from "./spawn-options.js";
import { openCodeAgent } from "@poe-code/agent-defs";

function providerModel(model?: string): string {
  const value = model ?? DEFAULT_FRONTIER_MODEL;
  const prefix = `${PROVIDER_NAME}/`;
  return value.startsWith(prefix) ? value : `${prefix}${value}`;
}

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
  ...openCodeAgent,
  supportsStdinPrompt: false,
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
    agentBinary: openCodeAgent.binaryName!,
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
      fileMutation.ensureDirectory({ path: "~/.config/opencode" }),
      configMutation.merge({
        target: "~/.config/opencode/config.json",
        value: (ctx) => {
          const { model } = (ctx ?? {}) as { model?: string };
          return {
            $schema: "https://opencode.ai/config.json",
            model: providerModel(model),
            enabled_providers: [PROVIDER_NAME]
          };
        }
      }),
      fileMutation.ensureDirectory({ path: "~/.opencode-data" }),
      configMutation.merge({
        target: "~/.opencode-data/auth.json",
        value: (ctx) => {
          const { apiKey } = (ctx ?? {}) as { apiKey?: string };
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
      configMutation.prune({
        target: "~/.config/opencode/config.json",
        shape: { enabled_providers: true }
      }),
      configMutation.prune({
        target: "~/.opencode-data/auth.json",
        shape: { [PROVIDER_NAME]: true }
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
