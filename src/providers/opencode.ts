import {
  DEFAULT_FRONTIER_MODEL,
  FRONTIER_MODELS,
  PROVIDER_NAME
} from "../cli/constants.js";
import {
  createBinaryExistsCheck,
  createSpawnHealthCheck
} from "../utils/command-checks.js";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import {
  configMutation,
  fileMutation,
  type ConfigObject
} from "@poe-code/config-mutations";
import { createProvider } from "./create-provider.js";
import type { ProviderSpawnOptions } from "./spawn-options.js";
import { openCodeAgent } from "@poe-code/agent-defs";
import { serializeOpenCodeMcpEnv } from "@poe-code/agent-spawn";
import type { ActiveProvider } from "../cli/commands/shared.js";

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
  supportsMcpSpawn: true,
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
      configMutation.transform({
        target: "~/.config/opencode/config.json",
        transform: (document, ctx) => {
          const { model } = (ctx ?? {}) as { model?: string };
          const enabledProviders = Array.isArray(document.enabled_providers)
            ? document.enabled_providers.filter((value): value is string => typeof value === "string")
            : [];
          const nextEnabledProviders = enabledProviders.includes(PROVIDER_NAME)
            ? enabledProviders
            : [...enabledProviders, PROVIDER_NAME];
          const content: ConfigObject = {
            ...document,
            $schema: "https://opencode.ai/config.json",
            model: providerModel(model),
            enabled_providers: nextEnabledProviders
          };
          return {
            content,
            changed: JSON.stringify(document) !== JSON.stringify(content)
          };
        }
      }),
      fileMutation.ensureDirectory({ path: "~/.local/share/opencode" }),
      configMutation.merge({
        target: "~/.local/share/opencode/auth.json",
        value: (ctx) => {
          const { provider } = (ctx ?? {}) as { provider?: ActiveProvider };
          return {
            [PROVIDER_NAME]: {
              type: "api",
              key: provider?.credential ?? ""
            }
          };
        }
      })
    ],
    unconfigure: [
      configMutation.transform({
        target: "~/.config/opencode/config.json",
        transform: (document) => {
          const content: ConfigObject = { ...document };
          const providers = Array.isArray(document.enabled_providers)
            ? document.enabled_providers.filter((value): value is string => typeof value === "string")
            : [];
          const enabledProviders = providers.filter((value) => value !== PROVIDER_NAME);
          let changed = enabledProviders.length !== providers.length;
          if (enabledProviders.length === 0) {
            if ("enabled_providers" in content) {
              delete content.enabled_providers;
              changed = true;
            }
          } else if (changed) {
            content.enabled_providers = enabledProviders;
          }
          if (typeof content.model === "string" && content.model.startsWith(`${PROVIDER_NAME}/`)) {
            delete content.model;
            changed = true;
          }
          return { content, changed };
        }
      }),
      configMutation.prune({
        target: "~/.local/share/opencode/auth.json",
        shape: { [PROVIDER_NAME]: true }
      })
    ]
  },
  install: OPEN_CODE_INSTALL_DEFINITION,
  test(context) {
    return context.runCheck(
      createSpawnHealthCheck("opencode", {
        model: context.model,
        prompt: "Output exactly: OPEN_CODE_OK",
        expectedOutput: '"type":"step_start"'
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
    if (!opts.cwd && !opts.mcpServers) {
      return context.command.runCommand("poe-code", ["wrap", "opencode", ...args]);
    }
    return context.command.runCommand("poe-code", ["wrap", "opencode", ...args], {
      cwd: opts.cwd,
      env: opts.mcpServers ? serializeOpenCodeMcpEnv(opts.mcpServers) : undefined
    });
  }
});

export const provider = openCodeService;
