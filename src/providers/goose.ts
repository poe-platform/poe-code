import type { CliEnvironment } from "../cli/environment.js";
import {
  createBinaryExistsCheck,
  createCommandExpectationCheck,
  type CommandRunnerOptions
} from "../utils/command-checks.js";
import {
  configMutation,
  fileMutation,
  type ConfigObject
} from "@poe-code/config-mutations";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import { createProvider } from "./create-provider.js";
import { DEFAULT_GOOSE_MODEL, GOOSE_MODELS } from "../cli/constants.js";
import type { ProviderSpawnOptions } from "./spawn-options.js";
import { gooseAgent } from "@poe-code/agent-defs";

type GooseConfigureContext = {
  env: CliEnvironment;
  apiKey: string;
  model?: string;
};

type GooseUnconfigureContext = {
  env: CliEnvironment;
};

const CUSTOM_PROVIDER_ID = "custom_poe";
const CUSTOM_PROVIDER_FILE = "~/.config/goose/custom_providers/custom_poe.json";
const GOOSE_CONFIG_FILE = "~/.config/goose/config.yaml";
const HEALTH_CHECK_PROMPT = "Reply with exactly: GOOSE_OK";

export const GOOSE_INSTALL_DEFINITION: ServiceInstallDefinition = {
  id: "goose",
  summary: "Goose CLI",
  check: createBinaryExistsCheck(
    "goose",
    "goose-cli-binary",
    "Goose CLI binary must exist"
  ),
  steps: [
    {
      id: "install-goose-cli-homebrew-or-script",
      command: "sh",
      args: [
        "-c",
        [
          "if command -v brew >/dev/null 2>&1; then",
          "  brew install block-goose-cli || curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash;",
          "else",
          "  curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash;",
          "fi"
        ].join(" ")
      ],
      platforms: ["darwin"]
    },
    {
      id: "install-goose-cli-script-unix",
      command: "sh",
      args: [
        "-c",
        "curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash"
      ],
      platforms: ["linux"]
    },
    {
      id: "install-goose-cli-script-windows",
      command: "powershell",
      args: [
        "-Command",
        "irm https://github.com/block/goose/releases/download/stable/download_cli.ps1 | iex"
      ],
      platforms: ["win32"]
    }
  ],
  successMessage: "Installed Goose CLI."
};

function buildCustomProvider(baseUrl: string): ConfigObject {
  return {
    name: CUSTOM_PROVIDER_ID,
    engine: "openai",
    display_name: "Poe",
    description: "Poe OpenAI-compatible API",
    api_key_env: "CUSTOM_POE_API_KEY",
    base_url: `${baseUrl}/chat/completions`,
    models: [...GOOSE_MODELS],
    supports_streaming: true,
    requires_auth: true
  };
}

function buildRunOptions(
  options: ProviderSpawnOptions,
  model: string
): { args: string[]; commandOptions?: CommandRunnerOptions } {
  const baseArgs = [
    "run",
    "--provider",
    CUSTOM_PROVIDER_ID,
    "--model",
    model,
    "--output-format",
    "text"
  ];

  if (options.useStdin) {
    return {
      args: [...baseArgs, "--instructions", "-", ...(options.args ?? [])],
      commandOptions: {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        stdin: options.prompt
      }
    };
  }

  return {
    args: [...baseArgs, "--text", options.prompt, ...(options.args ?? [])],
    commandOptions: options.cwd ? { cwd: options.cwd } : undefined
  };
}

export const gooseService = createProvider<
  GooseConfigureContext,
  GooseUnconfigureContext,
  ProviderSpawnOptions
>({
  ...gooseAgent,
  supportsStdinPrompt: true,
  configurePrompts: {
    model: {
      label: "Goose default model",
      defaultValue: DEFAULT_GOOSE_MODEL,
      choices: GOOSE_MODELS.map((id) => ({
        title: id,
        value: id
      }))
    }
  },
  isolatedEnv: {
    agentBinary: gooseAgent.binaryName!,
    configProbe: { kind: "isolatedFile", relativePath: ".config/goose/config.yaml" },
    env: {
      GOOSE_PATH_ROOT: { kind: "isolatedDir", relativePath: "" },
      CUSTOM_POE_API_KEY: { kind: "poeApiKey" }
    }
  },
  manifest: {
    configure: [
      fileMutation.ensureDirectory({ path: "~/.config/goose/custom_providers" }),
      configMutation.merge({
        target: CUSTOM_PROVIDER_FILE,
        value: (ctx) => {
          const { env } = (ctx ?? {}) as unknown as GooseConfigureContext;
          return buildCustomProvider(env.poeApiBaseUrl);
        }
      }),
      configMutation.merge({
        target: GOOSE_CONFIG_FILE,
        format: "yaml",
        value: (ctx) => {
          const { model } = (ctx ?? {}) as unknown as GooseConfigureContext;
          return {
            GOOSE_PROVIDER: CUSTOM_PROVIDER_ID,
            GOOSE_MODEL: model ?? DEFAULT_GOOSE_MODEL
          };
        }
      })
    ],
    unconfigure: [
      fileMutation.remove({ target: CUSTOM_PROVIDER_FILE }),
      configMutation.prune({
        target: GOOSE_CONFIG_FILE,
        format: "yaml",
        onlyIf: (document) => document.GOOSE_PROVIDER === CUSTOM_PROVIDER_ID,
        shape: {
          GOOSE_PROVIDER: true,
          GOOSE_MODEL: true
        }
      })
    ]
  },
  install: GOOSE_INSTALL_DEFINITION,
  test(context) {
    return context.runCheck(
      createCommandExpectationCheck({
        id: "goose-cli-health",
        command: "goose",
        args: ["run", "--text", HEALTH_CHECK_PROMPT, "--output-format", "text"],
        expectedOutput: "GOOSE_OK"
      })
    );
  },
  spawn(context, options) {
    const model = options.model ?? DEFAULT_GOOSE_MODEL;
    const { args, commandOptions } = buildRunOptions(options, model);
    return commandOptions
      ? context.command.runCommand("goose", args, commandOptions)
      : context.command.runCommand("goose", args);
  }
});

export const provider = gooseService;
