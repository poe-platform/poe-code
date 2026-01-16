import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import {
  buildProviderContext,
  createExecutionResources,
  resolveCommandFlags,
  applyIsolatedConfiguration
} from "./shared.js";
import {
  loadConfiguredServices,
  saveCredentials
} from "../../services/credentials.js";
import { ValidationError } from "../errors.js";
import {
  combineMutationObservers,
  createMutationReporter
} from "../../services/mutation-events.js";

export interface LoginCommandOptions {
  apiKey?: string;
}

export function registerLoginCommand(
  program: Command,
  container: CliContainer
): void {
  program
    .command("login")
    .description("Store a Poe API key for reuse across commands.")
    .option("--api-key <key>", "Poe API key")
    .action(async (options: LoginCommandOptions) => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(
        container,
        flags,
        "login"
      );

      resources.logger.intro("login");

      try {
        const input = await resolveApiKeyInput(container, options);
        const normalized = container.options.normalizeApiKey(input);

        const configuredServices = await loadConfiguredServices({
          fs: container.fs,
          filePath: container.env.credentialsPath
        });

        await saveCredentials({
          fs: resources.context.fs,
          filePath: container.env.credentialsPath,
          apiKey: normalized
        });

        await reconfigureServices({
          program,
          container,
          apiKey: normalized,
          configuredServices
        });

        resources.context.complete({
          success: `Poe API key stored at ${container.env.credentialsPath}.`,
          dry: `Dry run: would store Poe API key at ${container.env.credentialsPath}.`
        });

        resources.context.finalize();
      } catch (error) {
        if (error instanceof Error) {
          resources.logger.logException(error, "login command", {
            operation: "login",
            credentialsPath: container.env.credentialsPath
          });
        }
        throw error;
      }
    });
}

async function resolveApiKeyInput(
  container: CliContainer,
  options: LoginCommandOptions
): Promise<string> {
  if (options.apiKey) {
    return options.apiKey;
  }

  const descriptor = container.promptLibrary.loginApiKey();
  const response = await container.prompts(descriptor);
  const value = response[descriptor.name];

  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError("POE API key is required.", {
      operation: "login",
      field: "apiKey"
    });
  }

  return value;
}

interface ReconfigureServicesInput {
  program: Command;
  container: CliContainer;
  apiKey: string;
  configuredServices: Record<string, { files: string[] }>;
}

async function reconfigureServices(
  input: ReconfigureServicesInput
): Promise<void> {
  const { program, container, apiKey, configuredServices } = input;
  const serviceNames = Object.keys(configuredServices);

  for (const serviceName of serviceNames) {
    const adapter = container.registry.get(serviceName);
    if (!adapter) {
      continue;
    }

    const flags = resolveCommandFlags(program);
    const resources = createExecutionResources(
      container,
      flags,
      `login:reconfigure:${serviceName}`
    );
    const providerContext = buildProviderContext(container, adapter, resources);

    const payload = {
      env: container.env,
      apiKey
    };

    const mutationLogger = createMutationReporter(resources.logger);
    const observers = combineMutationObservers(mutationLogger);

    await container.registry.invoke(serviceName, "configure", async (entry) => {
      if (!entry.configure) {
        return;
      }

      await entry.configure(
        {
          fs: providerContext.command.fs,
          env: providerContext.env,
          command: providerContext.command,
          options: payload
        },
        observers ? { observers } : undefined
      );

      const isolated = adapter.isolatedEnv;
      if (isolated && isolated.requiresConfig !== false) {
        await applyIsolatedConfiguration({
          adapter: entry,
          providerContext,
          payload,
          isolated,
          providerName: adapter.name,
          observers
        });
      }
    });
  }
}
