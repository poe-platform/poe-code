import {
  createBinaryExistsCheck,
  createCommandExpectationCheck
} from "../utils/command-checks.js";
import {
  ensureDirectory,
  jsonPruneMutation,
  jsonMergeMutation,
  removeFileMutation
} from "../services/service-manifest.js";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import {
  CLAUDE_CODE_VARIANTS,
  DEFAULT_CLAUDE_CODE_MODEL
} from "../cli/constants.js";
import { createProvider } from "./create-provider.js";
import type {
  ProviderSpawnOptions,
  ModelConfigureOptions,
  EmptyProviderOptions
} from "./spawn-options.js";

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
      id: "install-claude-cli-npm",
      command: "npm",
      args: ["install", "-g", "@anthropic-ai/claude-code"]
    }
  ],
  successMessage: "Installed Claude CLI via npm."
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
  ModelConfigureOptions,
  EmptyProviderOptions,
  ProviderSpawnOptions
>({
  name: "claude-code",
  aliases: ["claude"],
  label: "Claude Code",
  id: "claude-code",
  summary: "Configure Claude Code to route through Poe.",
  supportsStdinPrompt: true,
  requiresApiKey: false,
  branding: {
    colors: {
      dark: "#C15F3C",
      light: "#C15F3C"
    }
  },
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
  isolatedEnv: {
    agentBinary: "claude",
    env: {
      ANTHROPIC_API_KEY: { kind: "envVar", name: "POE_API_KEY" },
      ANTHROPIC_BASE_URL: "https://api.poe.com"
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
          DEFAULT_CLAUDE_CODE_MODEL
        ),
        expectedOutput: "CLAUDE_CODE_OK"
      })
    );
  },
  manifest: {
    configure: [
      ensureDirectory({ targetDirectory: "~/.claude" }),
      jsonPruneMutation({
        targetDirectory: "~/.claude",
        targetFile: "settings.json",
        shape: () => ({
          apiKeyHelper: true
        })
      }),
      jsonMergeMutation({
        targetDirectory: "~/.claude",
        targetFile: "settings.json",
        value: ({ options }) => ({
          env: {
            ANTHROPIC_BASE_URL: "https://api.poe.com"
          },
          model: options.model
        })
      })
    ],
    remove: [
      jsonPruneMutation({
        targetDirectory: "~/.claude",
        targetFile: "settings.json",
        shape: () => ({
          apiKeyHelper: true,
          env: {
            ANTHROPIC_BASE_URL: true,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: true,
            ANTHROPIC_DEFAULT_SONNET_MODEL: true,
            ANTHROPIC_DEFAULT_OPUS_MODEL: true
          },
          model: true
        })
      }),
      removeFileMutation({
        targetDirectory: "~/.claude",
        targetFile: "anthropic_key.sh"
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
