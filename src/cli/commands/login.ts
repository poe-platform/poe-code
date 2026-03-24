import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import {
  buildProviderContext,
  createExecutionResources,
  resolveCommandFlags,
  applyIsolatedConfiguration
} from "./shared.js";
import { AuthenticationError } from "../errors.js";
import { loadConfiguredServices } from "../../services/config.js";
import {
  combineMutationObservers,
  createMutationReporter
} from "../../services/mutation-events.js";

export interface LoginCommandOptions {
  apiKey?: string;
}

export function registerLoginCommand(program: Command, container: CliContainer): void {
  program
    .command("login")
    .description("Store a Poe API key for reuse across commands.")
    .option("--api-key <key>", "Poe API key")
    .action(async (options: LoginCommandOptions) => {
      await executeLogin(program, container, options);
    });
}

export async function executeLogin(
  program: Command,
  container: CliContainer,
  options: LoginCommandOptions
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "login");

  resources.logger.intro("login");

  try {
    const apiKey = await container.options.resolveApiKey({
      value: options.apiKey,
      envValue: container.env.getVariable("POE_API_KEY"),
      dryRun: flags.dryRun,
      assumeYes: flags.assumeYes,
      allowStored: false
    });

    const configuredServices = await loadConfiguredServices({
      fs: container.fs,
      filePath: container.env.configPath,
      projectFilePath: container.env.projectConfigPath
    });

    await reconfigureServices({
      program,
      container,
      apiKey,
      configuredServices
    });

    resources.context.complete({
      success: "Logged in.",
      dry: "Dry run: would save API key."
    });

    resources.context.finalize();
  } catch (error) {
    if (error instanceof Error) {
      throw new AuthenticationError(error.message);
    }
    throw error;
  }
}

interface ReconfigureServicesInput {
  program: Command;
  container: CliContainer;
  apiKey: string;
  configuredServices: Record<string, { files: string[] }>;
}

async function reconfigureServices(input: ReconfigureServicesInput): Promise<void> {
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
