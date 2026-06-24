import type { Command } from "commander";
import { Option } from "commander";
import { withSpinner } from "toolcraft-design";
import type { CliContainer } from "../container.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import {
  createPoeCodeUpdatePlan,
  formatPoeCodeUpdateCommand,
  updatePoeCode,
  type PoeCodePackageManager
} from "../../services/update.js";

interface UpdateCommandOptions {
  force?: boolean;
  packageManager?: PoeCodePackageManager;
  versionCheck?: boolean;
}

export function registerUpdateCommand(
  program: Command,
  container: CliContainer,
  currentVersion: string
): Command {
  return program
    .command("update")
    .description("Update poe-code to the latest published version.")
    .option("--force", "Run the installer even when poe-code is already current.")
    .option("--no-version-check", "Skip the npm registry version check before updating.")
    .addOption(
      new Option("--package-manager <manager>", "Override package manager detection.").choices([
        "npm",
        "bun",
        "pnpm",
        "yarn"
      ])
    )
    .action(async (options: UpdateCommandOptions) => {
      await executeUpdate(program, container, currentVersion, options);
    });
}

export async function executeUpdate(
  program: Command,
  container: CliContainer,
  currentVersion: string,
  options: UpdateCommandOptions
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "update");
  const plan = createPoeCodeUpdatePlan({
    packageManager: options.packageManager,
    env: container.env.variables
  });

  resources.logger.intro("update");
  resources.logger.resolved("Command", formatPoeCodeUpdateCommand(plan));

  if (flags.dryRun) {
    resources.logger.dryRun(`Dry run: would run ${formatPoeCodeUpdateCommand(plan)}.`);
    return;
  }

  const result = await withSpinner({
    message: "Updating poe-code...",
    fn: () =>
      updatePoeCode({
        currentVersion,
        httpClient: container.httpClient,
        runCommand: resources.context.runCommand,
        env: container.env.variables,
        packageManager: options.packageManager,
        force: options.force,
        checkVersion: options.versionCheck
      })
  });

  if (result.status === "current") {
    resources.logger.success(`poe-code is already up to date (${currentVersion}).`);
    resources.context.finalize();
    return;
  }

  if (options.versionCheck !== false && result.version === null) {
    resources.logger.warn("Could not check the npm registry; ran the installer anyway.");
  }

  const latestVersion = result.version?.latestVersion;
  resources.logger.success(
    latestVersion ? `Updated poe-code to ${latestVersion}.` : "Updated poe-code."
  );
  resources.context.finalize();
}
