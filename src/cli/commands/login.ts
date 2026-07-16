import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import {
  apiKeyFlagDescription,
  buildProviderContext,
  buildActiveProvider,
  createExecutionResources,
  parseProviderShapeBaseUrls,
  resolveAgentDefinition,
  resolveCommandFlags,
  applyIsolatedConfiguration,
  warnApiKeyFlag
} from "./shared.js";
import { POE_PROVIDER_ID } from "@poe-code/providers";
import { AuthenticationError } from "../errors.js";
import { loadConfiguredServices, type ConfiguredServiceMetadata } from "../../services/config.js";
import { createOverlayFileSystem } from "./configure.js";
import type { FileSystem } from "../../utils/file-system.js";
import {
  combineMutationObservers,
  createMutationReporter
} from "../../services/mutation-events.js";

export interface LoginCommandOptions {
  apiKey?: string;
}

const PREVIEW_API_KEY = "<redacted>";

export function registerLoginCommand(program: Command, container: CliContainer): void {
  program
    .command("login")
    .description("Store a Poe API key for reuse across commands.")
    .option("--api-key <key>", apiKeyFlagDescription("POE_API_KEY"))
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
  warnApiKeyFlag(resources.logger, options.apiKey, "POE_API_KEY");

  try {
    const apiKey = flags.dryRun
      ? PREVIEW_API_KEY
      : await container.options.resolveApiKey({
          value: options.apiKey,
          envValue: container.env.getVariable("POE_API_KEY"),
          dryRun: true,
          assumeYes: flags.assumeYes,
          allowStored: false
        });

    const configuredServices = await loadConfiguredServices({
      fs: container.fs,
      filePath: container.env.configPath,
      projectFilePath: container.env.projectConfigPath,
      readOnly: flags.dryRun
    });

    if (flags.dryRun) {
      await reconfigureServices({ program, container, apiKey, configuredServices });
    } else {
      const transaction = createOverlayFileSystem(container.fs);
      const stagedStore = container.createPreviewProviderStore(POE_PROVIDER_ID, transaction.fs);
      if (stagedStore) {
        await stagedStore.set(apiKey);
        await reconfigureServices({
          program,
          container,
          apiKey,
          configuredServices,
          fs: transaction.fs
        });
        await transaction.commit();
      } else {
        const previousApiKey = await container.readApiKey({ readOnly: true });
        await reconfigureServices({
          program,
          container,
          apiKey,
          configuredServices,
          fs: transaction.fs
        });
        await container.providerRegistry.login(POE_PROVIDER_ID, { apiKey });
        try {
          await transaction.commit();
        } catch (error) {
          if (previousApiKey === null) {
            await container.deleteApiKey();
          } else {
            await container.writeApiKey(previousApiKey);
          }
          throw error;
        }
      }
    }

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
  configuredServices: Record<string, ConfiguredServiceMetadata>;
  fs?: FileSystem;
}

async function reconfigureServices(input: ReconfigureServicesInput): Promise<void> {
  const { program, container, apiKey, configuredServices } = input;
  const serviceNames = Object.keys(configuredServices).filter(
    (name) => configuredServices[name]!.provider === POE_PROVIDER_ID
  );

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
    const executionProviderContext = input.fs
      ? {
          ...providerContext,
          command: {
            ...providerContext.command,
            fs: input.fs
          }
        }
      : providerContext;

    const provider = container.providerRegistry.get(POE_PROVIDER_ID);
    if (!provider) {
      continue;
    }

    const metadata = configuredServices[serviceName]!;
    const payload = {
      env: container.env,
      provider: await buildActiveProvider({
        container,
        provider,
        agent: resolveAgentDefinition(serviceName) ?? { id: serviceName },
        credential: apiKey,
        explicitBaseUrl: metadata.baseUrl,
        explicitShapeBaseUrls: parseProviderShapeBaseUrls(provider, metadata.shapeBaseUrl ?? [])
      }),
      ...(metadata.model ? { model: metadata.model } : {}),
      ...(metadata.reasoningEffort ? { reasoningEffort: metadata.reasoningEffort } : {})
    };

    const mutationLogger = createMutationReporter(resources.logger);
    const observers = combineMutationObservers(mutationLogger);

    await container.registry.invoke(serviceName, "configure", async (entry) => {
      if (!entry.configure) {
        return;
      }

      await entry.configure(
        {
          fs: executionProviderContext.command.fs,
          env: executionProviderContext.env,
          command: executionProviderContext.command,
          options: payload
        },
        observers ? { observers } : undefined
      );

      const isolated = adapter.isolatedEnv;
      if (isolated && isolated.requiresConfig !== false) {
        await applyIsolatedConfiguration({
          adapter: entry,
          providerContext: executionProviderContext,
          payload,
          isolated,
          providerName: adapter.name,
          observers
        });
      }
    });
  }
}
