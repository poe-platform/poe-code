import type { CliEnvironment } from "../cli/environment.js";
import {
  createBinaryExistsCheck,
  createCommandExpectationCheck
} from "../utils/command-checks.js";
import { isTomlTable, type TomlTable } from "../utils/toml.js";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import {
  configMutation,
  fileMutation,
  templateMutation
} from "@poe-code/config-mutations";
import { createProvider } from "./create-provider.js";
import type { ProviderSpawnOptions } from "./spawn-options.js";
import {
  CODEX_MODELS,
  DEFAULT_CODEX_MODEL,
  DEFAULT_REASONING,
  stripModelNamespace
} from "../cli/constants.js";
import { codexAgent } from "@poe-code/agent-defs";

type CodexConfigureContext = {
  env: CliEnvironment;
  apiKey: string;
  model: string;
  reasoningEffort: string;
  timestamp?: () => string;
};

type CodexUnconfigureContext = {
  env: CliEnvironment;
};

const CODEX_PROVIDER_ID = "poe";
const CODEX_TOP_LEVEL_FIELDS = [
  "model",
  "model_reasoning_effort"
] as const;
export const CODEX_INSTALL_DEFINITION: ServiceInstallDefinition = {
  id: "codex",
  summary: "Codex CLI",
  check: createBinaryExistsCheck(
    "codex",
    "codex-cli-binary",
    "Codex CLI binary must exist"
  ),
  steps: [
    {
      id: "install-codex-cli-npm",
      command: "npm",
      args: ["install", "-g", "@openai/codex"]
    }
  ],
  successMessage: "Installed Codex CLI via npm."
};

function stripCodexConfiguration(
  document: TomlTable,
  baseUrl: string
): { changed: boolean; empty: boolean } {
  if (!isTomlTable(document)) {
    return { changed: false, empty: false };
  }

  if (document["model_provider"] !== CODEX_PROVIDER_ID) {
    return { changed: false, empty: false };
  }

  const providers = document["model_providers"];
  if (!isTomlTable(providers)) {
    return { changed: false, empty: false };
  }

  const poeConfig = providers[CODEX_PROVIDER_ID];
  if (
    !isTomlTable(poeConfig) ||
    !matchesExpectedProviderConfig(poeConfig, baseUrl)
  ) {
    return { changed: false, empty: false };
  }

  for (const field of CODEX_TOP_LEVEL_FIELDS) {
    if (typeof document[field] !== "string") {
      return { changed: false, empty: false };
    }
  }

  delete document["model_provider"];

  for (const field of CODEX_TOP_LEVEL_FIELDS) {
    delete document[field];
  }

  delete providers[CODEX_PROVIDER_ID];

  if (isTableEmpty(providers)) {
    delete document["model_providers"];
  }

  return {
    changed: true,
    empty: isTableEmpty(document)
  };
}

function matchesExpectedProviderConfig(
  table: TomlTable,
  baseUrl: string
): boolean {
  if (table["name"] !== "poe") {
    return false;
  }
  if (table["base_url"] !== baseUrl) {
    return false;
  }
  if (table["wire_api"] !== "chat") {
    return false;
  }

  const envKey = table["env_key"];
  if (
    envKey != null &&
    envKey !== "OPENAI_API_KEY" &&
    envKey !== "POE_API_KEY"
  ) {
    return false;
  }

  const bearer = table["experimental_bearer_token"];
  if (bearer != null && typeof bearer !== "string") {
    return false;
  }

  return true;
}

function isTableEmpty(value: unknown): value is TomlTable {
  return isTomlTable(value) && Object.keys(value).length === 0;
}

const CODEX_DEFAULT_EXEC_ARGS = [
  "--full-auto",
  "--skip-git-repo-check"
] as const;

export function buildCodexExecArgs(
  prompt: string,
  extraArgs: string[] = [],
  model?: string
): string[] {
  const modelArgs = model ? ["--model", model] : [];
  return [...modelArgs, "exec", prompt, ...CODEX_DEFAULT_EXEC_ARGS, ...extraArgs];
}

export const codexService = createProvider<
  CodexConfigureContext,
  CodexUnconfigureContext,
  ProviderSpawnOptions
>({
  ...codexAgent,
  supportsStdinPrompt: true,
  configurePrompts: {
    model: {
      label: "Codex model",
      defaultValue: DEFAULT_CODEX_MODEL,
      choices: CODEX_MODELS.map((id) => ({
        title: id,
        value: id
      }))
    },
    reasoningEffort: {
      label: "Codex reasoning effort",
      defaultValue: DEFAULT_REASONING
    }
  },
  isolatedEnv: {
    agentBinary: codexAgent.binaryName,
    configProbe: { kind: "isolatedFile", relativePath: "config.toml" },
    env: {
      CODEX_HOME: { kind: "isolatedDir" },
      XDG_CONFIG_HOME: { kind: "isolatedDir" }
    }
  },
  mcp: {
    configFile: "~/.codex/config.toml",
    configKey: "mcp_servers",
    format: "toml"
  },
  test(context) {
    return context.runCheck(
      createCommandExpectationCheck({
        id: "codex-cli-health",
        command: "codex",
        args: buildCodexExecArgs(
          "Output exactly: CODEX_OK",
          [],
          stripModelNamespace(DEFAULT_CODEX_MODEL)
        ),
        expectedOutput: "CODEX_OK"
      })
    );
  },
  manifest: {
    configure: [
      fileMutation.ensureDirectory({ path: "~/.codex" }),
      fileMutation.backup({ target: "~/.codex/config.toml" }),
      templateMutation.mergeToml({
        target: "~/.codex/config.toml",
        templateId: "codex/config.toml.hbs",
        context: (ctx) => {
          const options = ctx as unknown as CodexConfigureContext;
          return {
            apiKey: options.apiKey,
            baseUrl: options.env.poeApiBaseUrl,
            model: stripModelNamespace(options.model ?? DEFAULT_CODEX_MODEL),
            reasoningEffort: options.reasoningEffort
          };
        }
      })
    ],
    unconfigure: [
      configMutation.transform({
        target: "~/.codex/config.toml",
        transform: (document, ctx) => {
          const options = ctx as unknown as CodexUnconfigureContext;
          const result = stripCodexConfiguration(
            document as TomlTable,
            options.env.poeApiBaseUrl
          );
          if (!result.changed) {
            return { changed: false, content: document };
          }
          return {
            changed: true,
            content: result.empty ? null : document
          };
        }
      })
    ]
  },
  install: CODEX_INSTALL_DEFINITION,
  spawn(context, options) {
    const shouldUseStdin = Boolean(options.useStdin);
    const args = buildCodexExecArgs(
      shouldUseStdin ? "-" : options.prompt,
      options.args,
      options.model
    );
    if (shouldUseStdin) {
      if (options.cwd) {
        return context.command.runCommand("poe-code", ["wrap", "codex", ...args], {
          cwd: options.cwd,
          stdin: options.prompt
        });
      }
      return context.command.runCommand("poe-code", ["wrap", "codex", ...args], {
        stdin: options.prompt
      });
    }

    if (options.cwd) {
      return context.command.runCommand("poe-code", ["wrap", "codex", ...args], {
        cwd: options.cwd
      });
    }
    return context.command.runCommand("poe-code", ["wrap", "codex", ...args]);
  }
});
