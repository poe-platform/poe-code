import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import type { ProviderContext } from "../service-registry.js";
import { unconfigureService, loadConfiguredServices } from "../../services/config.js";
import { createMutationReporter } from "../../services/mutation-events.js";
import { resolveIsolatedTargetDirectory } from "../isolated-env.js";
import {
  buildProviderContext,
  createExecutionResources,
  resolveCommandFlags,
  resolveServiceAdapter,
  formatServiceList,
  listServiceNames
} from "./shared.js";
import { createOverlayFileSystem } from "./configure.js";

export interface UnconfigureCommandOptions {
  configName?: string;
}

export function registerUnconfigureCommand(program: Command, container: CliContainer): Command {
  const serviceNames = listServiceNames(
    container.registry.list().filter((service) => service.supportsConfigure !== false)
  );
  const serviceDescription = `Agent to unconfigure${formatServiceList(serviceNames)}`;
  return program
    .command("unconfigure")
    .alias("uc")
    .description("Remove existing Poe API tooling configuration.")
    .argument("<agent>", serviceDescription)
    .action(async (service: string, options: UnconfigureCommandOptions) => {
      await executeUnconfigure(program, container, service, options);
    });
}

export async function executeUnconfigure(
  program: Command,
  container: CliContainer,
  service: string,
  options: UnconfigureCommandOptions
): Promise<void> {
  const adapter = resolveServiceAdapter(container, service);
  if (adapter.supportsConfigure === false) {
    throw new Error(`${adapter.label} is spawn-only and does not support unconfigure.`);
  }
  const canonicalService = adapter.name;
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, `unconfigure:${canonicalService}`);

  resources.logger.intro(`unconfigure ${canonicalService}`);

  const providerContext = buildProviderContext(container, adapter, resources);
  const configuredServices = await loadConfiguredServices({
    fs: container.fs,
    filePath: providerContext.env.configPath,
    projectFilePath: providerContext.env.projectConfigPath,
    readOnly: flags.dryRun
  });
  const metadata = configuredServices[canonicalService];
  if (!metadata) {
    resources.context.complete(formatUnconfigureMessages(adapter, false, {}));
    resources.context.finalize();
    return;
  }
  const mutationLogger = createMutationReporter(resources.logger);
  const transaction = flags.dryRun ? undefined : createOverlayFileSystem(providerContext.command.fs);
  const executionProviderContext = transaction
    ? {
        ...providerContext,
        command: {
          ...providerContext.command,
          fs: transaction.fs
        }
      }
    : providerContext;

  const payload = await createUnconfigurePayload({
    service: canonicalService,
    container,
    options,
    context: providerContext,
    metadata
  });

  const unconfigured = await container.registry.invoke(
    canonicalService,
    "unconfigure",
    async (entry) => {
      if (!entry.unconfigure) {
        throw new Error(`Agent "${canonicalService}" does not support unconfigure.`);
      }
      const result = await entry.unconfigure(
        {
          fs: executionProviderContext.command.fs,
          env: executionProviderContext.env,
          command: executionProviderContext.command,
          options: payload
        },
        { observers: mutationLogger }
      );

      const isolated = adapter.isolatedEnv;
      if (isolated && isolated.requiresConfig !== false) {
        await entry.unconfigure(
          {
            fs: executionProviderContext.command.fs,
            env: executionProviderContext.env,
            command: executionProviderContext.command,
            options: payload,
            pathMapper: {
              mapTargetDirectory: ({ targetDirectory }: { targetDirectory: string }) =>
                resolveIsolatedTargetDirectory({
                  targetDirectory,
                  isolated,
                  env: executionProviderContext.env,
                  providerName: adapter.name
                })
            }
          },
          { observers: mutationLogger }
        );
      }

      if (!flags.dryRun) {
        await unconfigureService({
          fs: executionProviderContext.command.fs,
          filePath: providerContext.env.configPath,
          projectFilePath: providerContext.env.projectConfigPath,
          service: canonicalService
        });
      }

      await transaction?.commit();

      return result;
    }
  );

  const messages = formatUnconfigureMessages(adapter, unconfigured, payload);

  resources.context.complete(messages);

  resources.context.finalize();
}

interface UnconfigurePayloadInit {
  service: string;
  container: CliContainer;
  options: UnconfigureCommandOptions;
  context: ProviderContext;
  metadata: Awaited<ReturnType<typeof loadConfiguredServices>>[string];
}

async function createUnconfigurePayload(init: UnconfigurePayloadInit): Promise<unknown> {
  const { context, metadata } = init;
  return {
    env: context.env,
    provider: { id: metadata.provider }
  };
}

function formatUnconfigureMessages(
  adapter: { label: string; configurationLabel?: string },
  unconfigured: unknown,
  _payload: unknown
): { success: string; dry: string } {
  const didUnconfigure = typeof unconfigured === "boolean" ? unconfigured : Boolean(unconfigured);
  const label = adapter.configurationLabel ?? adapter.label;
  return {
    success: didUnconfigure
      ? `Removed ${label} configuration.`
      : `No ${label} configuration found.`,
    dry: didUnconfigure
      ? `Dry run: would remove ${label} configuration.`
      : `No ${label} configuration found.`
  };
}
