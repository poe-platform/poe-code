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
  PROVIDER_NAME,
  stripModelNamespace
} from "../cli/constants.js";
import { codexAgent } from "@poe-code/agent-defs";
import type { ActiveProvider } from "../cli/commands/shared.js";

type CodexConfigureContext = {
  env: CliEnvironment;
  provider: ActiveProvider;
  model: string;
  reasoningEffort: string;
  timestamp?: () => string;
};

type CodexUnconfigureContext = {
  env: CliEnvironment;
  provider?: { id: string };
};

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
      id: "install-codex-cli-npm",
      command: "npm",
      args: ["install", "-g", "@openai/codex"]
    }
  ],
  successMessage: "Installed Codex CLI via npm."
};

function deriveProviderIdFromDocument(document: ConfigObject): string | undefined {
  if (typeof document["model_provider"] === "string") {
    return document["model_provider"] as string;
  }
  const profiles = document["profiles"];
  if (isConfigObject(profiles)) {
    for (const name of Object.keys(profiles)) {
      const profile = profiles[name];
      if (isConfigObject(profile) && typeof profile["model_provider"] === "string") {
        return profile["model_provider"] as string;
      }
    }
  }
  const providers = document["model_providers"];
  if (isConfigObject(providers)) {
    const keys = Object.keys(providers);
    if (keys.length > 0) {
      return keys[0]!;
    }
  }
  return undefined;
}

function stripCodexConfiguration(
  document: ConfigObject,
  providerId?: string
): { changed: boolean; empty: boolean } {
  if (!isConfigObject(document)) {
    return { changed: false, empty: false };
  }

  const id = providerId ?? deriveProviderIdFromDocument(document);
  if (!id) {
    return { changed: false, empty: false };
  }

  let changed = false;

  // Handle flat (legacy) config: top-level model_provider matches provider
  if (document["model_provider"] === id) {
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
      if (isConfigObject(profile) && profile["model_provider"] === id) {
        delete profiles[name];
        changed = true;
      }
    }
    if (isTableEmpty(profiles)) {
      delete document["profiles"];
    }
  }

  // Clean up model_providers entry for this provider
  const providers = document["model_providers"];
  if (isConfigObject(providers) && id in providers) {
    delete providers[id];
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
        transform: (document, ctx) => {
          const options = ctx as unknown as CodexConfigureContext;
          const result = stripCodexConfiguration(document as ConfigObject, options.provider?.id);
          return { changed: result.changed, content: result.empty ? null : document };
        }
      }),
      templateMutation.mergeToml({
        target: "~/.codex/config.toml",
        templateId: "codex/config.toml.mustache",
        context: (ctx) => {
          const options = ctx as unknown as CodexConfigureContext;
          const model = options.model ?? DEFAULT_CODEX_MODEL;
          return {
            apiKey: options.provider?.credential,
            baseUrl: options.provider?.baseUrl ?? "",
            model: stripModelNamespace(model),
            providerId: options.provider?.id ?? PROVIDER_NAME,
            reasoningEffort: options.reasoningEffort,
            profileName: deriveCodexProfileName(model)
          };
        }
      })
    ],
    unconfigure: [
      configMutation.transform({
        target: "~/.codex/config.toml",
        transform: (document, ctx) => {
          const options = ctx as unknown as CodexUnconfigureContext;
          const result = stripCodexConfiguration(document as ConfigObject, options.provider?.id);
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
