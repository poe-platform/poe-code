import { createBinaryExistsCheck, createSpawnHealthCheck } from "../utils/command-checks.js";
import {
  configMutation,
  fileMutation,
  isConfigObject,
  type ConfigObject
} from "@poe-code/config-mutations";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import { DEFAULT_GEMINI_MODEL } from "../cli/constants.js";
import { createProvider } from "./create-provider.js";
import type { ModelConfigureOptions } from "./spawn-options.js";
import { geminiCliAgent } from "@poe-code/agent-defs";
import type { CliEnvironment } from "../cli/environment.js";
import type { ActiveProvider } from "../cli/commands/shared.js";
import type { ModelChoice } from "../cli/prompts.js";
import { spawnAcp } from "@poe-code/agent-spawn";
import { resolveIsolatedEnvDetails } from "../cli/isolated-env.js";
import type { SpawnCommandOptions } from "./spawn-options.js";

const GOOGLE_MODELS_PATH = "v1beta/models";
const FALLBACK_GEMINI_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-3-pro",
  "gemini-3-flash"
] as const;

type GeminiConfigureContext = ModelConfigureOptions & {
  env: CliEnvironment;
  provider: ActiveProvider;
};

type GeminiUnconfigureContext = {
  env: CliEnvironment;
};

export const GEMINI_CLI_INSTALL_DEFINITION: ServiceInstallDefinition = {
  id: "gemini-cli",
  summary: "Gemini CLI",
  check: createBinaryExistsCheck("gemini", "gemini-cli-binary", "Gemini CLI binary must exist"),
  steps: [
    {
      id: "install-gemini-cli-npm",
      command: "npm",
      args: ["install", "-g", "@google/gemini-cli"]
    }
  ],
  successMessage: "Installed Gemini CLI via npm."
};

export const geminiCliService = createProvider<
  GeminiConfigureContext,
  GeminiUnconfigureContext,
  SpawnCommandOptions
>({
  ...geminiCliAgent,
  supportsStdinPrompt: true,
  supportsMcpSpawn: true,
  configurePrompts: {
    model: {
      label: "Gemini model",
      defaultValue: DEFAULT_GEMINI_MODEL,
      choices: async ({ httpClient, provider }) => {
        try {
          const response = await httpClient(buildGoogleModelsUrl(provider.baseUrl), {
            headers: {
              Authorization: `Bearer ${provider.credential}`
            }
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const choices = parseGoogleModelChoices(await response.json());
          if (choices.length === 0) {
            throw new Error("model list response did not include usable models");
          }
          return choices;
        } catch {
          return FALLBACK_GEMINI_MODELS.map((value) => ({ title: value, value }));
        }
      }
    }
  },
  isolatedEnv: {
    agentBinary: "gemini",
    configProbe: { kind: "isolatedFile", relativePath: "settings.json" },
    env: {
      GEMINI_API_KEY: { kind: "providerCredential" },
      GOOGLE_GEMINI_BASE_URL: { kind: "providerBaseUrl" },
      HOME: { kind: "isolatedDir" }
    }
  },
  test: async (context) => {
    await context.runCheck(
      createBinaryExistsCheck("gemini", "gemini-cli-binary", "Gemini CLI binary must exist")
    );
    await context.runCheck(
      createSpawnHealthCheck("gemini-cli", {
        expectedOutput: "GEMINI_OK",
        invocation: {
          command: "gemini",
          args: [
            "-p",
            "say GEMINI_OK",
            "--sandbox=false",
            "--output-format",
            "text",
            "--model",
            context.model ?? DEFAULT_GEMINI_MODEL
          ]
        }
      })
    );
  },
  async spawn(context, options) {
    const activeProvider = context.activeProvider;
    if (!activeProvider) {
      throw new Error("Gemini CLI spawn requires an active configured provider.");
    }
    const isolated = geminiCliService.isolatedEnv!;
    const details = await resolveIsolatedEnvDetails(
      context.env,
      isolated,
      geminiCliService.name,
      activeProvider
    );
    const { done } = spawnAcp({
      agentId: geminiCliService.name,
      prompt: options.prompt,
      cwd: options.cwd,
      model: options.model ?? DEFAULT_GEMINI_MODEL,
      mode: options.mode,
      mcpServers: options.mcpServers,
      resumeThreadId: options.resumeThreadId,
      signal: options.signal,
      env: { ...activeProvider.extraEnv, ...details.env }
    });
    return done;
  },
  manifest: {
    configure: [
      fileMutation.ensureDirectory({ path: "~/.gemini" }),
      fileMutation.backup({ target: "~/.gemini/settings.json" }),
      configMutation.merge({
        target: "~/.gemini/settings.json",
        value: (ctx) => {
          const options = ctx as unknown as ModelConfigureOptions;
          return {
            selectedAuthType: "gemini-api-key",
            model: options.model ?? DEFAULT_GEMINI_MODEL,
            mcpServers: {}
          };
        }
      })
    ],
    unconfigure: [
      configMutation.transform({
        target: "~/.gemini/settings.json",
        transform: (document) => {
          if (!isConfigObject(document)) {
            return { changed: false, content: document };
          }

          const content = document as ConfigObject;
          if (content.selectedAuthType !== "gemini-api-key") {
            return { changed: false, content };
          }

          delete content.selectedAuthType;
          delete content.model;
          if (isConfigObject(content.mcpServers) && Object.keys(content.mcpServers).length === 0) {
            delete content.mcpServers;
          }

          return {
            changed: true,
            content: Object.keys(content).length === 0 ? null : content
          };
        }
      })
    ]
  },
  install: GEMINI_CLI_INSTALL_DEFINITION
});

export const provider = geminiCliService;

function buildGoogleModelsUrl(baseUrl: string): string {
  return `${trimTrailingSlash(baseUrl)}/${GOOGLE_MODELS_PATH}`;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parseGoogleModelChoices(payload: unknown): ReadonlyArray<ModelChoice> {
  if (!isRecord(payload) || !Array.isArray(payload.models)) {
    throw new Error("model list response did not include models");
  }

  const choices: ModelChoice[] = [];
  for (const model of payload.models) {
    if (!isRecord(model) || typeof model.name !== "string") {
      continue;
    }
    const value = stripModelsPrefix(model.name);
    choices.push({
      title: value,
      value
    });
  }
  return choices;
}

function stripModelsPrefix(value: string): string {
  const prefix = "models/";
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
