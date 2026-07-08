import {
  DEFAULT_FRONTIER_MODEL,
  FRONTIER_MODELS,
  PROVIDER_NAME
} from "../cli/constants.js";
import {
  createBinaryExistsCheck,
  createSpawnHealthCheck,
  formatCommandRunnerResult
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
import type { ProviderContext } from "../cli/service-registry.js";
import { resolveIsolatedEnvDetails } from "../cli/isolated-env.js";

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

async function ensureHealthWorkspace(context: ProviderContext): Promise<string> {
  const dir = context.env.resolveHomePath(".poe-code", "opencode-health");
  await context.command.fs.mkdir(dir, { recursive: true });

  const check = await context.command.runCommand("git", [
    "-C",
    dir,
    "rev-parse",
    "--is-inside-work-tree"
  ]);
  if (check.exitCode === 0 && check.stdout.trim() === "true") {
    return dir;
  }

  const init = await context.command.runCommand("git", ["-C", dir, "init", "-q"]);
  if (init.exitCode !== 0) {
    throw new Error(
      [
        "Failed to initialize OpenCode health check workspace.",
        formatCommandRunnerResult(init)
      ].join("\n")
    );
  }

  return dir;
}


const openCodeIsolatedEnv = {
  agentBinary: openCodeAgent.binaryName!,
  configProbe: {
    kind: "isolatedFile" as const,
    relativePath: ".config/opencode/config.json"
  },
  env: {
    XDG_CONFIG_HOME: { kind: "isolatedDir" as const, relativePath: ".config" },
    XDG_DATA_HOME: { kind: "isolatedDir" as const, relativePath: ".local/share" }
  }
};

export const openCodeService = createProvider({
  ...openCodeAgent,
  configurationLabel: "OpenCode CLI",
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
  isolatedEnv: openCodeIsolatedEnv,
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
  async test(context) {
    const healthDir = context.logger.context.dryRun
      ? context.env.resolveHomePath(".poe-code", "opencode-health")
      : await ensureHealthWorkspace(context);

    return context.runCheck(
      createSpawnHealthCheck("opencode", {
        expectedOutput: "OPEN_CODE_OK",
        invocation: {
          command: "opencode",
          args: [
            "run",
            "Output exactly: OPEN_CODE_OK",
            "--pure",
            "--format",
            "json",
            "--model",
            providerModel(context.model),
            "--dir",
            healthDir
          ]
        }
      })
    );
  },
  async spawn(context, options) {
    const opts = (options ?? {}) as ProviderSpawnOptions;
    const args = [
      ...getModelArgs(opts.model),
      "run",
      opts.prompt,
      ...(opts.args ?? [])
    ];
    const activeProvider = context.activeProvider;
    const details = await resolveIsolatedEnvDetails(
      context.env,
      openCodeIsolatedEnv,
      openCodeAgent.id,
      activeProvider
    );
    const mcpEnv = opts.mcpServers ? serializeOpenCodeMcpEnv(opts.mcpServers) : undefined;
    return context.command.runCommand("opencode", args, {
      cwd: opts.cwd,
      env: {
        ...(activeProvider?.extraEnv ?? {}),
        ...(details?.env ?? {}),
        ...(mcpEnv ?? {}),
        ...(opts.env ?? {})
      }
    });
  }
});

export const provider = openCodeService;
