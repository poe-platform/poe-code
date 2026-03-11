import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import type { ProviderContext } from "../service-registry.js";
import { unconfigureService } from "../../services/config.js";
import { createMutationReporter } from "../../services/mutation-events.js";
import { resolveIsolatedTargetDirectory } from "../isolated-env.js";
import {
  buildProviderContext,
  createExecutionResources,
  resolveCommandFlags,
  resolveServiceAdapter,
  formatServiceList
} from "./shared.js";

export interface UnconfigureCommandOptions {
  configName?: string;
}

export function registerUnconfigureCommand(
  program: Command,
  container: CliContainer
): Command {
  const serviceNames = container.registry.list().map((service) => service.name);
  const serviceDescription =
    `Agent to unconfigure${formatServiceList(serviceNames)}`;
  return program
    .command("unconfigure")
    .description("Remove existing Poe API tooling configuration.")
    .argument(
      "<agent>",
      serviceDescription
    )
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
  const canonicalService = adapter.name;
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(
    container,
    flags,
    `unconfigure:${canonicalService}`
  );

  resources.logger.intro(`unconfigure ${canonicalService}`);

  const providerContext = buildProviderContext(
    container,
    adapter,
    resources
  );
  const mutationLogger = createMutationReporter(resources.logger);

  const payload = await createUnconfigurePayload({
    service: canonicalService,
    container,
    options,
    context: providerContext,
    dryRun: flags.dryRun
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
          fs: providerContext.command.fs,
          env: providerContext.env,
          command: providerContext.command,
          options: payload
        },
        { observers: mutationLogger }
      );

      const isolated = adapter.isolatedEnv;
      if (isolated && isolated.requiresConfig !== false) {
        await entry.unconfigure(
          {
            fs: providerContext.command.fs,
            env: providerContext.env,
            command: providerContext.command,
            options: payload,
            pathMapper: {
              mapTargetDirectory: ({ targetDirectory }: { targetDirectory: string }) =>
                resolveIsolatedTargetDirectory({
                  targetDirectory,
                  isolated,
                  env: providerContext.env,
                  providerName: adapter.name
                })
            }
          },
          { observers: mutationLogger }
        );
      }

      return result;
    }
  );

  if (!flags.dryRun) {
    await unconfigureService({
      fs: container.fs,
      filePath: providerContext.env.configPath,
      service: canonicalService
    });
  }

  const messages = formatUnconfigureMessages(
    canonicalService,
    adapter.label,
    unconfigured,
    payload
  );

  resources.context.complete(messages);

  resources.context.finalize();
}

interface UnconfigurePayloadInit {
  service: string;
  container: CliContainer;
  options: UnconfigureCommandOptions;
  context: ProviderContext;
  dryRun: boolean;
}

async function createUnconfigurePayload(init: UnconfigurePayloadInit): Promise<unknown> {
  const { context } = init;
  return { env: context.env, dryRun: init.dryRun };
}

function formatUnconfigureMessages(
  service: string,
  label: string,
  unconfigured: unknown,
  payload: unknown
): { success: string; dry: string } {
  const didUnconfigure = typeof unconfigured === "boolean" ? unconfigured : Boolean(unconfigured);
  const dry = resolveDryUnconfigureMessage(label, didUnconfigure, payload);
  switch (service) {
    case "claude-code":
      return {
        success: didUnconfigure
          ? "Removed Claude Code configuration."
          : "No Claude Code configuration found.",
        dry: resolveDryUnconfigureMessage("Claude Code", didUnconfigure, payload)
      };
    case "codex":
      return {
        success: didUnconfigure
          ? "Removed Codex configuration."
          : "No Codex configuration found.",
        dry: resolveDryUnconfigureMessage("Codex", didUnconfigure, payload)
      };
    case "opencode":
      return {
        success: didUnconfigure
          ? "Removed OpenCode CLI configuration."
          : "No OpenCode CLI configuration found.",
        dry: resolveDryUnconfigureMessage(
          "OpenCode CLI",
          didUnconfigure,
          payload
        )
      };
    default:
      return {
        success: didUnconfigure
          ? `Removed ${label} configuration.`
          : `No ${label} configuration found.`,
        dry
      };
  }
}

function resolveDryUnconfigureMessage(
  label: string,
  didUnconfigure: boolean,
  payload: unknown
): string {
  if (didUnconfigure) {
    return `Dry run: would remove ${label} configuration.`;
  }
  if (hasDryRunFlag(payload)) {
    return `Dry run: no ${label} configuration found.`;
  }
  return `Dry run: would remove ${label} configuration.`;
}

function hasDryRunFlag(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  return (payload as { dryRun?: unknown }).dryRun === true;
}
