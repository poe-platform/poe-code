import {
  createBinaryExistsCheck,
  createSpawnHealthCheck
} from "../utils/command-checks.js";
import {
  configMutation,
  fileMutation
} from "@poe-code/config-mutations";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import { createProvider } from "./create-provider.js";
import type { CliEnvironment } from "../cli/environment.js";
import type { ModelConfigureOptions } from "./spawn-options.js";
import { claudeCodeAgent } from "@poe-code/agent-defs";
import type { ActiveProvider } from "../cli/commands/shared.js";

type ClaudeCodeConfigureContext = ModelConfigureOptions & {
  env: CliEnvironment;
  provider: ActiveProvider;
  reasoningEffort?: string;
};

const CLAUDE_CODE_EFFORT_LEVELS = ["none", "low", "medium", "high", "max"];

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

export const claudeCodeService = createProvider<
  ClaudeCodeConfigureContext,
  ClaudeCodeUnconfigureContext
>({
  ...claudeCodeAgent,
  supportsStdinPrompt: true,
  configurePrompts: {
    reasoningEffort: {
      label: "Claude Code reasoning effort",
      levels: CLAUDE_CODE_EFFORT_LEVELS
    }
  },
  postConfigureMessages: [
    "If using VSCode - Open the Disable Login Prompt setting and check the box. vscode://settings/claudeCode.disableLoginPrompt"
  ],
  runtimeEnv: {
    ANTHROPIC_BASE_URL: { kind: "agentBaseUrl" }
  },
  isolatedEnv: {
    agentBinary: claudeCodeAgent.binaryName!,
    env: {},
    requiresConfig: false,
    cliSettings: {
      values: {},
      env: {
        ANTHROPIC_BASE_URL: { kind: "agentBaseUrl" }
      }
    }
  },
  test(context) {
    return context.runCheck(
      createSpawnHealthCheck("claude-code", {
        model: context.model,
        expectedOutput: "CLAUDE_CODE_OK"
      })
    );
  },
  manifest: {
    configure: [
      fileMutation.ensureDirectory({ path: "~/.claude" }),
      fileMutation.backup({ target: "~/.claude/settings.json", once: true }),
      configMutation.prune({
        target: "~/.claude/settings.json",
        shape: {
          apiKeyHelper: true,
          env: {
            ANTHROPIC_API_KEY: true
          }
        }
      }),
      configMutation.merge({
        target: "~/.claude/settings.json",
        value: (ctx) => {
          const options = ctx as unknown as ClaudeCodeConfigureContext;
          return {
            env: {
              ...options.provider?.extraEnv,
              ANTHROPIC_BASE_URL: options.provider?.agentBaseUrl ?? options.provider?.baseUrl
            },
            ...(options.reasoningEffort === undefined
              ? {}
              : { effortLevel: options.reasoningEffort })
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
            ANTHROPIC_API_KEY: true,
            ANTHROPIC_CUSTOM_HEADERS: true,
            ANTHROPIC_BASE_URL: true,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: true,
            ANTHROPIC_DEFAULT_SONNET_MODEL: true,
            ANTHROPIC_DEFAULT_OPUS_MODEL: true
          },
          model: true,
          effortLevel: true
        }
      }),
      fileMutation.restoreBackup({ target: "~/.claude/settings.json" })
    ]
  },
  install: CLAUDE_CODE_INSTALL_DEFINITION
});

export const provider = claudeCodeService;
