import {
  createBinaryExistsCheck,
  createCommandExpectationCheck
} from "../utils/command-checks.js";
import {
  configMutation,
  fileMutation
} from "@poe-code/config-mutations";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import {
  CLAUDE_CODE_VARIANTS,
  DEFAULT_CLAUDE_CODE_MODEL,
  stripModelNamespace
} from "../cli/constants.js";
import { createProvider } from "./create-provider.js";
import type { CliEnvironment } from "../cli/environment.js";
import type {
  ModelConfigureOptions,
  ProviderSpawnOptions
} from "./spawn-options.js";
import { claudeCodeAgent } from "@poe-code/agent-defs";

type ClaudeCodeConfigureContext = ModelConfigureOptions & {
  env: CliEnvironment;
  apiKey: string;
};

type ClaudeCodeUnconfigureContext = {
  env: CliEnvironment;
};

export const CLAUDE_CODE_INSTALL_DEFINITION: ServiceInstallDefinition = {
  id: "claude-code",
  summary: "Claude CLI",
  check: createBinaryExistsCheck(
    "claude",
    "claude-cli-binary",
    "Claude CLI binary must exist"
  ),
  steps: [
    {
      id: "install-claude-cli-unix",
      command: "bash",
      args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"],
      platforms: ["darwin", "linux"]
    },
    {
      id: "install-claude-cli-windows",
      command: "powershell",
      args: ["-Command", "irm https://claude.ai/install.ps1 | iex"],
      platforms: ["win32"]
    }
  ],
  successMessage: "Installed Claude CLI."
};

const CLAUDE_SPAWN_DEFAULTS = [
  "--allowedTools",
  "Bash,Read",
  "--permission-mode",
  "acceptEdits",
  "--output-format",
  "text"
] as const;

function buildClaudeArgs(
  prompt: string | undefined,
  extraArgs?: string[],
  model?: string
): string[] {
  const modelArgs = model ? ["--model", model] : [];
  if (prompt == null) {
    return [
      "-p",
      "--input-format",
      "text",
      ...modelArgs,
      ...CLAUDE_SPAWN_DEFAULTS,
      ...(extraArgs ?? [])
    ];
  }
  return ["-p", prompt, ...modelArgs, ...CLAUDE_SPAWN_DEFAULTS, ...(extraArgs ?? [])];
}

export const claudeCodeService = createProvider<
  ClaudeCodeConfigureContext,
  ClaudeCodeUnconfigureContext,
  ProviderSpawnOptions
>({
  ...claudeCodeAgent,
  supportsStdinPrompt: true,
  configurePrompts: {
    model: {
      label: "Claude Code default model",
      defaultValue: DEFAULT_CLAUDE_CODE_MODEL,
      choices: Object.values(CLAUDE_CODE_VARIANTS).map((id) => ({
        title: id,
        value: id
      }))
    }
  },
  postConfigureMessages: [
    "If using VSCode - Open the Disable Login Prompt setting and check the box. vscode://settings/claudeCode.disableLoginPrompt"
  ],
  isolatedEnv: {
    agentBinary: claudeCodeAgent.binaryName,
    env: {
      ANTHROPIC_API_KEY: { kind: "poeApiKey" },
      ANTHROPIC_BASE_URL: { kind: "poeBaseUrl" }
    },
    requiresConfig: false
  },
  test(context) {
    return context.runCheck(
      createCommandExpectationCheck({
        id: "claude-cli-health",
        command: "claude",
        args: buildClaudeArgs(
          "Output exactly: CLAUDE_CODE_OK",
          undefined,
          stripModelNamespace(DEFAULT_CLAUDE_CODE_MODEL)
        ),
        expectedOutput: "CLAUDE_CODE_OK"
      })
    );
  },
  mcp: {
    configFile: "~/.claude.json",
    configKey: "mcpServers"
  },
  manifest: {
    configure: [
      fileMutation.ensureDirectory({ path: "~/.claude" }),
      configMutation.merge({
        target: "~/.claude/settings.json",
        value: (ctx) => {
          const options = ctx as unknown as ClaudeCodeConfigureContext;
          return {
            apiKeyHelper: `echo ${options.apiKey}`,
            env: {
              ANTHROPIC_BASE_URL: options.env.poeBaseUrl
            },
            model: stripModelNamespace(options.model ?? DEFAULT_CLAUDE_CODE_MODEL)
          };
        }
      })
    ],
    unconfigure: [
      configMutation.prune({
        target: "~/.claude/settings.json",
        shape: {
          apiKeyHelper: true,
          env: {
            ANTHROPIC_BASE_URL: true,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: true,
            ANTHROPIC_DEFAULT_SONNET_MODEL: true,
            ANTHROPIC_DEFAULT_OPUS_MODEL: true
          },
          model: true
        }
      })
    ]
  },
  install: CLAUDE_CODE_INSTALL_DEFINITION,
  spawn(context, options) {
    const shouldUseStdin = Boolean(options.useStdin);
    const args = buildClaudeArgs(
      shouldUseStdin ? undefined : options.prompt,
      options.args,
      options.model
    );
    if (shouldUseStdin) {
      if (options.cwd) {
        return context.command.runCommand(
          "poe-code",
          ["wrap", "claude-code", ...args],
          {
          cwd: options.cwd,
          stdin: options.prompt
          }
        );
      }
      return context.command.runCommand("poe-code", ["wrap", "claude-code", ...args], {
        stdin: options.prompt
      });
    }

    if (options.cwd) {
      return context.command.runCommand("poe-code", ["wrap", "claude-code", ...args], {
        cwd: options.cwd
      });
    }
    return context.command.runCommand("poe-code", ["wrap", "claude-code", ...args]);
  }
});
