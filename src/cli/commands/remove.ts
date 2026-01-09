import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import type { ProviderContext } from "../service-registry.js";
import { removeConfiguredService } from "../../services/credentials.js";
import { createMutationReporter } from "../../services/mutation-events.js";
import { resolveIsolatedTargetDirectory } from "../isolated-env.js";
import {
  buildProviderContext,
  createExecutionResources,
  resolveCommandFlags,
  resolveServiceAdapter,
} from "./shared.js";

export interface RemoveCommandOptions {
  configName?: string;
}

export function registerRemoveCommand(
  program: Command,
  container: CliContainer
): Command {
  return program
    .command("remove")
    .description("Remove existing Poe API tooling configuration.")
    .argument(
      "<service>",
      "Service to remove (claude-code | codex | opencode)"
    )
    .action(async (service: string, options: RemoveCommandOptions) => {
      await executeRemove(program, container, service, options);
    });
}

 export async function executeRemove(
  program: Command,
  container: CliContainer,
  service: string,
  options: RemoveCommandOptions
): Promise<void> {
  const adapter = resolveServiceAdapter(container, service);
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(
    container,
    flags,
    `remove:${service}`
  );
  const providerContext = buildProviderContext(
    container,
    adapter,
    resources
  );
  const mutationLogger = createMutationReporter(resources.logger);

  const payload = await createRemovePayload({
    service,
    container,
    options,
    context: providerContext
  });

  const removed = await container.registry.invoke(
    service,
    "remove",
    async (entry) => {
      if (!entry.remove) {
        throw new Error(`Service "${service}" does not support remove.`);
      }
      const result = await entry.remove(
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
        await entry.remove(
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
    await removeConfiguredService({
      fs: container.fs,
      filePath: providerContext.env.credentialsPath,
      service
    });
  }

  const messages = formatRemovalMessages(
    service,
    adapter.label,
    removed,
    payload
  );

  resources.context.complete(messages);
}

interface RemovePayloadInit {
  service: string;
  container: CliContainer;
  options: RemoveCommandOptions;
  context: ProviderContext;
}

async function createRemovePayload(init: RemovePayloadInit): Promise<unknown> {
  const { service, context } = init;
  switch (service) {
    case "claude-code":
      return { env: context.env };
    case "codex":
      return { env: context.env };
    case "opencode":
      return { env: context.env };
    default:
      return {};
    }
}

function formatRemovalMessages(
  service: string,
  label: string,
  removed: unknown,
  _payload: unknown
): { success: string; dry: string } {
  const didRemove = typeof removed === "boolean" ? removed : Boolean(removed);
  switch (service) {
    case "claude-code":
      return {
        success: didRemove
          ? "Removed Claude Code configuration."
          : "No Claude Code configuration found.",
        dry: "Dry run: would remove Claude Code configuration."
      };
    case "codex":
      return {
        success: didRemove
          ? "Removed Codex configuration."
          : "No Codex configuration found.",
        dry: "Dry run: would remove Codex configuration."
      };
    case "opencode":
      return {
        success: didRemove
          ? "Removed OpenCode CLI configuration."
          : "No OpenCode CLI configuration found.",
        dry: "Dry run: would remove OpenCode CLI configuration."
      };
    default:
      return {
        success: didRemove
          ? `Removed ${label} configuration.`
          : `No ${label} configuration found.`,
        dry: `Dry run: would remove ${label} configuration.`
      };
  }
}
