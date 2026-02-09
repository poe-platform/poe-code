import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import {
  deleteCredentials,
  loadConfiguredServices
} from "../../services/credentials.js";
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
    .description("Remove all Poe API configuration and stored credentials.")
    .action(async () => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(
        container,
        flags,
        "logout"
      );

      resources.logger.intro("logout");

      const configuredServices = await loadConfiguredServices({
        fs: container.fs,
        filePath: container.env.credentialsPath
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
          dry: `Dry run: would delete credentials at ${container.env.credentialsPath}.`
        });
        resources.context.finalize();
        return;
      }

      const deleted = await deleteCredentials({
        fs: container.fs,
        filePath: container.env.credentialsPath
      });

      resources.context.complete({
        success: deleted ? "Logged out." : "Already logged out.",
        dry: `Dry run: would delete credentials at ${container.env.credentialsPath}.`
      });

      resources.context.finalize();
    });
}
