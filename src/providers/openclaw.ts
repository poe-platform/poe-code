import {
  DEFAULT_FRONTIER_MODEL,
  FRONTIER_MODELS,
  PROVIDER_NAME,
  stripModelNamespace
} from "../cli/constants.js";
import { createBinaryExistsCheck } from "../utils/command-checks.js";
import { type ServiceInstallDefinition } from "../services/service-install.js";
import {
  configMutation,
  fileMutation
} from "@poe-code/config-mutations";
import { createProvider } from "./create-provider.js";
import type { ModelConfigureOptions } from "./spawn-options.js";
import type { CliEnvironment } from "../cli/environment.js";
import { openClawAgent } from "@poe-code/agent-defs";

type OpenClawConfigureContext = ModelConfigureOptions & {
  env: CliEnvironment;
  apiKey: string;
};

type OpenClawUnconfigureContext = {
  env: CliEnvironment;
};

export const OPEN_CLAW_INSTALL_DEFINITION: ServiceInstallDefinition = {
  id: "openclaw",
  summary: "OpenClaw CLI",
  check: createBinaryExistsCheck(
    "openclaw",
    "openclaw-cli-binary",
    "OpenClaw CLI binary must exist"
  ),
  steps: [
    {
      id: "install-openclaw-npm",
      command: "npm",
      args: ["install", "-g", "openclaw@latest"]
    }
  ],
  successMessage: "Installed OpenClaw CLI via npm."
};

export const openClawService = createProvider<
  OpenClawConfigureContext,
  OpenClawUnconfigureContext
>({
  ...openClawAgent,
  configurePrompts: {
    model: {
      label: "OpenClaw default model",
      defaultValue: DEFAULT_FRONTIER_MODEL,
      choices: FRONTIER_MODELS.map((id) => ({
        title: id,
        value: id
      }))
    }
  },
  isolatedEnv: {
    agentBinary: openClawAgent.binaryName!,
    configProbe: {
      kind: "isolatedFile",
      relativePath: ".openclaw/openclaw.json"
    },
    env: {
      HOME: { kind: "isolatedDir" }
    }
  },
  manifest: {
    configure: [
      fileMutation.ensureDirectory({ path: "~/.openclaw" }),
      configMutation.merge({
        target: "~/.openclaw/openclaw.json",
        value: (ctx) => {
          const { model, apiKey, env } = (ctx ?? {}) as {
            model?: string;
            apiKey?: string;
            env: CliEnvironment;
          };
          return {
            agents: {
              defaults: {
                model: {
                  primary: `${PROVIDER_NAME}/${stripModelNamespace(model ?? DEFAULT_FRONTIER_MODEL)}`
                }
              }
            },
            models: {
              providers: {
                [PROVIDER_NAME]: {
                  baseUrl: env.poeApiBaseUrl,
                  apiKey: apiKey ?? "",
                  api: "openai-completions",
                  models: FRONTIER_MODELS.map((id) => ({
                    id: stripModelNamespace(id)
                  }))
                }
              }
            }
          };
        }
      })
    ],
    unconfigure: [
      configMutation.prune({
        target: "~/.openclaw/openclaw.json",
        shape: {
          agents: {
            defaults: {
              model: {
                primary: true
              }
            }
          },
          models: {
            providers: {
              [PROVIDER_NAME]: true
            }
          }
        }
      })
    ]
  },
  install: OPEN_CLAW_INSTALL_DEFINITION
});

export const provider = openClawService;
