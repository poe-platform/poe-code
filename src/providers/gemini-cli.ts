import { createBinaryExistsCheck, createCommandExpectationCheck } from "../utils/command-checks.js";
import {
  configMutation,
  fileMutation,
  isConfigObject,
  type ConfigObject
} from "@poe-code/config-mutations";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import { createProvider } from "./create-provider.js";
import type { ModelConfigureOptions } from "./spawn-options.js";
import { geminiCliAgent } from "@poe-code/agent-defs";
import type { CliEnvironment } from "../cli/environment.js";
import type { ActiveProvider } from "../cli/commands/shared.js";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";

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

export const geminiCliService = createProvider<GeminiConfigureContext, GeminiUnconfigureContext>({
  ...geminiCliAgent,
  supportsStdinPrompt: true,
  configurePrompts: {
    model: {
      label: "Gemini model",
      defaultValue: DEFAULT_GEMINI_MODEL
    }
  },
  test: async (context) => {
    await context.runCheck(
      createBinaryExistsCheck("gemini", "gemini-cli-binary", "Gemini CLI binary must exist")
    );
    await context.runCheck(
      createCommandExpectationCheck({
        id: "gemini-cli-health",
        command: "gemini",
        args: [
          "-p",
          "say GEMINI_OK",
          "--sandbox=false",
          "--output-format",
          "text",
          "--model",
          context.model ?? DEFAULT_GEMINI_MODEL
        ],
        expectedOutput: "GEMINI_OK"
      })
    );
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

          let changed = false;
          const content = document as ConfigObject;
          if ("selectedAuthType" in content) {
            delete content["selectedAuthType"];
            changed = true;
          }
          if ("model" in content) {
            delete content["model"];
            changed = true;
          }
          if (isConfigObject(content.mcpServers) && Object.keys(content.mcpServers).length === 0) {
            delete content.mcpServers;
            changed = true;
          }

          return {
            changed,
            content: Object.keys(content).length === 0 ? null : content
          };
        }
      })
    ]
  },
  install: GEMINI_CLI_INSTALL_DEFINITION
});

export const provider = geminiCliService;
