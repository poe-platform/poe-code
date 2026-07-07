import type { CliEnvironment } from "../cli/environment.js";
import {
  createBinaryExistsCheck,
  createCommandExpectationCheck,
  type CommandRunnerOptions
} from "../utils/command-checks.js";
import { configMutation, fileMutation, type ConfigObject } from "@poe-code/config-mutations";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import { createProvider } from "./create-provider.js";
import { DEFAULT_GOOSE_MODEL, GOOSE_MODELS, stripModelNamespace } from "../cli/constants.js";
import type { ProviderSpawnOptions } from "./spawn-options.js";
import { gooseAgent } from "@poe-code/agent-defs";
import { serializeGooseMcpArgs } from "@poe-code/agent-spawn";
import type { ActiveProvider } from "../cli/commands/shared.js";

type GooseConfigureContext = {
  env: CliEnvironment;
  provider: ActiveProvider;
  model?: string;
  modelContextLimits?: Record<string, number>;
};

type GooseUnconfigureContext = {
  env: CliEnvironment;
};

const CUSTOM_PROVIDER_ID = "custom_poe";
const CUSTOM_PROVIDER_FILE = "~/.config/goose/custom_providers/custom_poe.json";
const GOOSE_CONFIG_FILE = "~/.config/goose/config.yaml";
const GOOSE_SECRETS_FILE = "~/.config/goose/secrets.yaml";
const CUSTOM_PROVIDER_API_KEY_ENV = "CUSTOM_POE_API_KEY";
const GOOSE_FILE_SECRETS_ENV = { GOOSE_DISABLE_KEYRING: "1" };
const HEALTH_CHECK_PROMPT = "Reply with exactly: GOOSE_OK";
type GooseModelsResponse = {
  data?: unknown;
};

export const GOOSE_INSTALL_DEFINITION: ServiceInstallDefinition = {
  id: "goose",
  summary: "Goose CLI",
  check: createBinaryExistsCheck("goose", "goose-cli-binary", "Goose CLI binary must exist"),
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

function buildCustomProvider(
  baseUrl: string,
  modelContextLimits: Record<string, number> = {}
): ConfigObject {
  return {
    name: CUSTOM_PROVIDER_ID,
    engine: "openai",
    display_name: "Poe",
    description: "Poe OpenAI-compatible API",
    api_key_env: CUSTOM_PROVIDER_API_KEY_ENV,
    base_url: `${baseUrl}/chat/completions`,
    models: GOOSE_MODELS.map((name) => ({
      name,
      context_limit: resolveGooseModelContextLimit(name, modelContextLimits)
    })),
    supports_streaming: true,
    requires_auth: true
  };
}

const GOOSE_MODEL_CONTEXT_LIMIT_FALLBACKS: Record<string, number> = {
  "anthropic/claude-opus-4.7": 200_000,
  "anthropic/claude-sonnet-5": 983_040,
  "openai/gpt-5.3-codex": 128_000,
  "openai/gpt-5.4-pro": 1_050_000,
  "google/gemini-3.1-pro": 1_000_000
};

function resolveGooseModelContextLimit(
  model: string,
  modelContextLimits: Record<string, number>
): number {
  const stripped = stripModelNamespace(model);
  const dynamicValue = modelContextLimits[model] ?? modelContextLimits[stripped];
  if (typeof dynamicValue === "number" && Number.isFinite(dynamicValue) && dynamicValue > 0) {
    return dynamicValue;
  }
  const fallback = GOOSE_MODEL_CONTEXT_LIMIT_FALLBACKS[model];
  if (typeof fallback === "number") {
    return fallback;
  }
  throw new Error(`Missing Goose model context limit for ${model}.`);
}

function extractGooseModelContextLimits(response: GooseModelsResponse): Record<string, number> {
  const entries = Array.isArray(response.data) ? response.data : [];
  const wanted = new Map(GOOSE_MODELS.map((model) => [stripModelNamespace(model), model]));
  const limits: Record<string, number> = {};

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const rawId = (entry as { id?: unknown }).id;
    const resolvedModel = typeof rawId === "string" ? wanted.get(rawId) : undefined;
    if (!resolvedModel) {
      continue;
    }

    const rawContextLength = (
      entry as {
        context_window?: { context_length?: unknown } | null;
      }
    ).context_window?.context_length;

    if (
      typeof rawContextLength !== "number" ||
      !Number.isFinite(rawContextLength) ||
      rawContextLength <= 0
    ) {
      continue;
    }

    limits[resolvedModel] = rawContextLength;
  }

  return limits;
}

async function fetchGooseModelContextLimits(input: {
  apiBaseUrl: string;
  apiKey: string;
  httpClient: (
    url: string,
    init?: { method?: string; headers?: Record<string, string> }
  ) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}): Promise<Record<string, number>> {
  const response = await input.httpClient(`${input.apiBaseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${input.apiKey}`
    }
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Poe model catalog for Goose configuration (status ${response.status}).`
    );
  }

  const modelContextLimits = extractGooseModelContextLimits(
    (await response.json()) as GooseModelsResponse
  );
  for (const model of GOOSE_MODELS) {
    if (modelContextLimits[model] == null && GOOSE_MODEL_CONTEXT_LIMIT_FALLBACKS[model] != null) {
      modelContextLimits[model] = GOOSE_MODEL_CONTEXT_LIMIT_FALLBACKS[model]!;
    }
  }
  const missing = GOOSE_MODELS.filter((model) => modelContextLimits[model] == null);
  if (missing.length > 0) {
    throw new Error(`Missing Goose model context limit for ${missing[0]}.`);
  }
  return modelContextLimits;
}

const GOOSE_MODE_ENV: Record<string, string> = {
  yolo: "auto",
  edit: "smart_approve",
  read: "chat"
};

function buildRunOptions(options: ProviderSpawnOptions): {
  args: string[];
  commandOptions?: CommandRunnerOptions;
} {
  const baseArgs = [
    "run",
    "--provider",
    CUSTOM_PROVIDER_ID,
    ...(options.model ? ["--model", options.model] : []),
    "--output-format",
    "text"
  ];

  const mcpArgs = options.mcpServers ? serializeGooseMcpArgs(options.mcpServers) : [];
  const modeEnv =
    options.mode && GOOSE_MODE_ENV[options.mode]
      ? { GOOSE_MODE: GOOSE_MODE_ENV[options.mode] }
      : undefined;
  const commandEnv = { ...GOOSE_FILE_SECRETS_ENV, ...(modeEnv ?? {}) };

  if (options.useStdin) {
    return {
      args: [...baseArgs, ...mcpArgs, "--instructions", "-", ...(options.args ?? [])],
      commandOptions: {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        env: commandEnv,
        stdin: options.prompt
      }
    };
  }

  return {
    args: [...baseArgs, ...mcpArgs, "--text", options.prompt, ...(options.args ?? [])],
    commandOptions: { ...(options.cwd ? { cwd: options.cwd } : {}), env: commandEnv }
  };
}

export const gooseService = createProvider<
  GooseConfigureContext,
  GooseUnconfigureContext,
  ProviderSpawnOptions
>({
  ...gooseAgent,
  supportsStdinPrompt: true,
  supportsMcpSpawn: true,
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
  async extendConfigurePayload(context) {
    const { provider } = context.payload as GooseConfigureContext;
    const modelContextLimits = await fetchGooseModelContextLimits({
      apiBaseUrl: provider?.baseUrl ?? "",
      apiKey: provider?.credential ?? "",
      httpClient: context.httpClient
    });
    return {
      modelContextLimits
    };
  },
  isolatedEnv: {
    agentBinary: gooseAgent.binaryName!,
    configProbe: { kind: "isolatedFile", relativePath: ".config/goose/config.yaml" },
    env: {
      HOME: { kind: "isolatedDir", relativePath: "" },
      XDG_CONFIG_HOME: { kind: "isolatedDir", relativePath: ".config" }
    }
  },
  manifest: {
    configure: [
      fileMutation.ensureDirectory({ path: "~/.config/goose/custom_providers" }),
      fileMutation.backup({ target: CUSTOM_PROVIDER_FILE, once: true }),
      fileMutation.backup({ target: GOOSE_CONFIG_FILE, once: true }),
      fileMutation.backup({ target: GOOSE_SECRETS_FILE, once: true }),
      configMutation.merge({
        target: CUSTOM_PROVIDER_FILE,
        value: (ctx) => {
          const { provider, modelContextLimits } = (ctx ?? {}) as unknown as GooseConfigureContext;
          return buildCustomProvider(provider?.baseUrl ?? "", modelContextLimits);
        }
      }),
      configMutation.merge({
        target: GOOSE_CONFIG_FILE,
        format: "yaml",
        value: (ctx) => {
          const { model } = (ctx ?? {}) as unknown as GooseConfigureContext;
          return {
            GOOSE_PROVIDER: CUSTOM_PROVIDER_ID,
            GOOSE_MODEL: model ?? DEFAULT_GOOSE_MODEL,
            GOOSE_DISABLE_KEYRING: true
          };
        }
      }),
      configMutation.merge({
        target: GOOSE_SECRETS_FILE,
        format: "yaml",
        value: (ctx) => {
          const { provider } = (ctx ?? {}) as unknown as GooseConfigureContext;
          return {
            [CUSTOM_PROVIDER_API_KEY_ENV]: provider?.credential
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
          GOOSE_MODEL: true,
          GOOSE_DISABLE_KEYRING: true
        }
      }),
      configMutation.prune({
        target: GOOSE_SECRETS_FILE,
        format: "yaml",
        shape: {
          [CUSTOM_PROVIDER_API_KEY_ENV]: true
        }
      }),
      fileMutation.restoreBackup({ target: CUSTOM_PROVIDER_FILE }),
      fileMutation.restoreBackup({ target: GOOSE_CONFIG_FILE }),
      fileMutation.restoreBackup({ target: GOOSE_SECRETS_FILE })
    ]
  },
  install: GOOSE_INSTALL_DEFINITION,
  test(context) {
    return context.runCheck(
      createCommandExpectationCheck({
        id: "goose-cli-health",
        command: "goose",
        args: ["run", "--text", HEALTH_CHECK_PROMPT, "--output-format", "text"],
        expectedOutput: "GOOSE_OK",
        commandOptions: { env: GOOSE_FILE_SECRETS_ENV }
      })
    );
  },
  spawn(context, options) {
    const { args, commandOptions } = buildRunOptions(options);
    return commandOptions
      ? context.command.runCommand("goose", args, commandOptions)
      : context.command.runCommand("goose", args);
  }
});

export const provider = gooseService;
