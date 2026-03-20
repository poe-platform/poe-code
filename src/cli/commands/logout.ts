import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import {
  deleteConfig,
  loadConfiguredServices
} from "../../services/config.js";
import {
  createExecutionResources,
  resolveCommandFlags
} from "./shared.js";
import { executeUnconfigure } from "./unconfigure.js";

export function registerLogoutCommand(
  program: Command,
  container: CliContainer
): void {
  program
    .command("logout")
    .description("Remove all Poe API configuration.")
    .action(async () => {
      await executeLogout(program, container);
    });
}

export async function executeLogout(
  program: Command,
  container: CliContainer
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(
    container,
    flags,
    "logout"
  );

  resources.logger.intro("logout");

  const configuredServices = await loadConfiguredServices({
    fs: container.fs,
    filePath: container.env.configPath
  });

  for (const serviceName of Object.keys(configuredServices)) {
    const adapter = container.registry.get(serviceName);
    if (!adapter) {
      continue;
    }
    await executeUnconfigure(program, container, serviceName, {});
  }

  if (flags.dryRun) {
    resources.context.complete({
      success: "Logged out.",
      dry: `Dry run: would delete config at ${container.env.configPath}.`
    });
    resources.context.finalize();
    return;
  }

  await container.deleteApiKey();

  const deleted = await deleteConfig({
    fs: container.fs,
    filePath: container.env.configPath
  });

  resources.context.complete({
    success: deleted ? "Logged out." : "Already logged out.",
    dry: `Dry run: would delete config at ${container.env.configPath}.`
  });

  resources.context.finalize();
}
