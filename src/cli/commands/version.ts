import type { Command } from "commander";
import { text } from "toolcraft-design";
import type { CliContainer } from "../container.js";
import { checkForUpdate } from "../../services/version.js";
import { createPoeCodeUpdatePlan, formatPoeCodeUpdateCommand } from "../../services/update.js";
import { VersionExit } from "../exit-signals.js";

export function registerVersionOption(
  program: Command,
  container: CliContainer,
  currentVersion: string
): void {
  program.option("-V, --version", "Output the version number.");

  program.hook("preAction", async (thisCommand) => {
    const opts = thisCommand.optsWithGlobals();
    if (opts.version) {
      await displayVersion(container, currentVersion, { dryRun: Boolean(opts.dryRun) });
      throw new VersionExit();
    }
  });
}

async function displayVersion(
  container: CliContainer,
  currentVersion: string,
  options: { dryRun: boolean }
): Promise<void> {
  const { loggerFactory, httpClient, env } = container;
  const logger = loggerFactory.create({
    dryRun: options.dryRun,
    verbose: false,
    scope: "version"
  });

  logger.intro("version");

  const versionValue =
    currentVersion === "0.0.0-dev"
      ? `${currentVersion} ${text.badge("local build")}`
      : currentVersion;
  logger.resolved("poe-code", versionValue);

  if (options.dryRun) {
    return;
  }

  const result = await checkForUpdate({
    currentVersion,
    httpClient
  });

  if (result?.updateAvailable) {
    logger.warn(
      `Update available: ${result.currentVersion} -> ${result.latestVersion}`
    );
    logger.resolved(
      "Update",
      formatPoeCodeUpdateCommand(createPoeCodeUpdatePlan({ env: env.variables }))
    );
  }
}
