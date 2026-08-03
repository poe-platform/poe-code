import type { CliEnvironment } from "../cli/environment.js";
import { createBinaryExistsCheck, createSpawnHealthCheck } from "../utils/command-checks.js";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import {
  configMutation,
  fileMutation,
  templateMutation,
  type ConfigObject,
  isConfigObject
} from "@poe-code/config-mutations";
import { createProvider } from "./create-provider.js";
import { PROVIDER_NAME, stripModelNamespace } from "../cli/constants.js";
import { codexAgent } from "@poe-code/agent-defs";
import type { ActiveProvider } from "../cli/commands/shared.js";
import type {
  ProviderService,
  ServiceExecutionContext,
  ServiceRunOptions
} from "../cli/service-registry.js";

type CodexConfigureContext = {
  env: CliEnvironment;
  provider: ActiveProvider;
  model?: string;
  reasoningEffort?: string;
  timestamp?: () => string;
};

type CodexUnconfigureContext = {
  env: CliEnvironment;
  provider?: { id: string };
};

const PROFILE_KEYWORDS = ["opus", "sonnet", "haiku", "codex", "pro"] as const;
const CODEX_OPENAI_PROVIDER_ID = "openai";
/** Levels the Codex CLI accepts for model_reasoning_effort. */
const CODEX_EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh"];

export function deriveCodexProfileName(model: string): string {
  const stripped = stripModelNamespace(model);
  const parts = stripped.split(/[-_.]/);
  for (const keyword of PROFILE_KEYWORDS) {
    if (parts.includes(keyword)) return keyword;
  }
  return stripped;
}

function isCodexBuiltInProvider(providerId: string | undefined): boolean {
  return providerId === CODEX_OPENAI_PROVIDER_ID;
}

function resolveCodexHome(context: ServiceExecutionContext<CodexConfigureContext>): string {
  const codexDirectory = context.env.resolveHomePath(".codex");
  if (!context.pathMapper) {
    return codexDirectory;
  }
  return context.pathMapper.mapTargetDirectory({
    targetDirectory: codexDirectory,
    env: context.env
  });
}

async function loginCodexWithApiKey(
  context: ServiceExecutionContext<CodexConfigureContext>
): Promise<void> {
  const credential = context.options.provider?.credential;
  if (
    context.command.dryRun ||
    !isCodexBuiltInProvider(context.options.provider?.id) ||
    !credential
  ) {
    return;
  }

  const result = await context.command.runCommand(
    "codex",
    ["login", "--with-api-key"],
    {
      env: { CODEX_HOME: resolveCodexHome(context) },
      stdin: credential
    }
  );
  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(
      stderr.length > 0
        ? `codex login --with-api-key failed: ${stderr}`
        : `codex login --with-api-key failed with exit code ${result.exitCode}.`
    );
  }
}

export const CODEX_INSTALL_DEFINITION: ServiceInstallDefinition = {
  id: "codex",
  summary: "Codex CLI",
  check: createBinaryExistsCheck("codex", "codex-cli-binary", "Codex CLI binary must exist"),
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
  if (isConfigObject(providers) && Object.hasOwn(providers, id)) {
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

const baseCodexService = createProvider<CodexConfigureContext, CodexUnconfigureContext>({
  ...codexAgent,
  supportsStdinPrompt: true,
  configurePrompts: {
    reasoningEffort: {
      label: "Codex reasoning effort",
      levels: CODEX_EFFORT_LEVELS
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
        model: context.model,
        expectedOutput: "CODEX_OK",
        hooks: context.hooks
      })
    );
  },
  manifest: {
    configure: [
      fileMutation.ensureDirectory({ path: "~/.codex" }),
      fileMutation.backup({ target: "~/.codex/config.toml", once: true }),
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
          const templateContext: ConfigObject = {
            apiKey: options.provider?.credential,
            baseUrl: options.provider?.baseUrl ?? "",
            codexBuiltInProvider: isCodexBuiltInProvider(options.provider?.id),
            providerId: options.provider?.id ?? PROVIDER_NAME
          };
          if (isCodexBuiltInProvider(options.provider?.id)) {
            templateContext["forcedLoginMethod"] = "api";
          }
          if (options.reasoningEffort !== undefined) {
            templateContext["reasoningEffort"] = options.reasoningEffort;
          }
          return templateContext;
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
      }),
      fileMutation.restoreBackup({ target: "~/.codex/config.toml" })
    ]
  },
  install: CODEX_INSTALL_DEFINITION
});

export const codexService: ProviderService<CodexConfigureContext, CodexUnconfigureContext> = {
  ...baseCodexService,
  async configure(context, runOptions?: ServiceRunOptions) {
    await baseCodexService.configure(context, runOptions);
    if (runOptions?.sideEffects === false) {
      return;
    }
    await loginCodexWithApiKey(context);
  }
};

export const provider = codexService;
