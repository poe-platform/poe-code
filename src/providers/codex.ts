import type { CliEnvironment } from "../cli/environment.js";
import {
  createBinaryExistsCheck,
  createSpawnHealthCheck
} from "../utils/command-checks.js";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import {
  configMutation,
  fileMutation,
  templateMutation,
  type ConfigObject,
  isConfigObject
} from "@poe-code/config-mutations";
import { createProvider } from "./create-provider.js";
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

const PROFILE_KEYWORDS = ["opus", "sonnet", "haiku", "codex", "pro"] as const;

export function deriveCodexProfileName(model: string): string {
  const stripped = stripModelNamespace(model);
  const parts = stripped.split(/[-_.]/);
  for (const keyword of PROFILE_KEYWORDS) {
    if (parts.includes(keyword)) return keyword;
  }
  return stripped;
}

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
      id: "install-codex-cli-bun",
      command: "bun",
      args: ["install", "--global", "@openai/codex"]
    }
  ],
  successMessage: "Installed Codex CLI via Bun."
};

function stripCodexConfiguration(
  document: ConfigObject
): { changed: boolean; empty: boolean } {
  if (!isConfigObject(document)) {
    return { changed: false, empty: false };
  }

  let changed = false;

  // Handle flat (legacy) config: top-level model_provider = "poe"
  if (document["model_provider"] === CODEX_PROVIDER_ID) {
    delete document["model_provider"];
    delete document["model"];
    delete document["model_reasoning_effort"];
    delete document["model_verbosity"];
    changed = true;
  }

  // Handle profile-based config
  const profiles = document["profiles"];
  if (isConfigObject(profiles)) {
    for (const name of Object.keys(profiles)) {
      const profile = profiles[name];
      if (isConfigObject(profile) && profile["model_provider"] === CODEX_PROVIDER_ID) {
        delete profiles[name];
        changed = true;
      }
    }
    if (isTableEmpty(profiles)) {
      delete document["profiles"];
    }
  }

  // Clean up model_providers.poe
  const providers = document["model_providers"];
  if (isConfigObject(providers) && CODEX_PROVIDER_ID in providers) {
    delete providers[CODEX_PROVIDER_ID];
    if (isTableEmpty(providers)) {
      delete document["model_providers"];
    }
    changed = true;
  }

  return {
    changed,
    empty: isTableEmpty(document)
  };
}

function isTableEmpty(value: unknown): value is ConfigObject {
  return isConfigObject(value) && Object.keys(value).length === 0;
}

export const codexService = createProvider<
  CodexConfigureContext,
  CodexUnconfigureContext
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
    agentBinary: codexAgent.binaryName!,
    configProbe: { kind: "isolatedFile", relativePath: "config.toml" },
    env: {
      CODEX_HOME: { kind: "isolatedDir" },
      XDG_CONFIG_HOME: { kind: "isolatedDir" }
    }
  },
  test(context) {
    return context.runCheck(
      createSpawnHealthCheck("codex", {
        model: context.model ?? DEFAULT_CODEX_MODEL,
        expectedOutput: "CODEX_OK"
      })
    );
  },
  manifest: {
    configure: [
      fileMutation.ensureDirectory({ path: "~/.codex" }),
      fileMutation.backup({ target: "~/.codex/config.toml" }),
      configMutation.transform({
        target: "~/.codex/config.toml",
        transform: (document) => {
          const result = stripCodexConfiguration(document as ConfigObject);
          return { changed: result.changed, content: result.empty ? null : document };
        }
      }),
      templateMutation.mergeToml({
        target: "~/.codex/config.toml",
        templateId: "codex/config.toml.hbs",
        context: (ctx) => {
          const options = ctx as unknown as CodexConfigureContext;
          const model = options.model ?? DEFAULT_CODEX_MODEL;
          return {
            apiKey: options.apiKey,
            baseUrl: options.env.poeApiBaseUrl,
            model: stripModelNamespace(model),
            reasoningEffort: options.reasoningEffort,
            profileName: deriveCodexProfileName(model)
          };
        }
      })
    ],
    unconfigure: [
      configMutation.transform({
        target: "~/.codex/config.toml",
        transform: (document) => {
          const result = stripCodexConfiguration(document as ConfigObject);
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
  install: CODEX_INSTALL_DEFINITION
});

export const provider = codexService;
