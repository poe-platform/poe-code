import type { Command } from "commander";
import { text } from "@poe-code/design-system";
import type { CliContainer } from "../container.js";
import { checkForUpdate } from "../../services/version.js";
import { VersionExit } from "../exit-signals.js";

export function registerVersionOption(
  program: Command,
  container: CliContainer,
  currentVersion: string
): void {
  program.option("-V, --version", "Output the version number.");

  program.hook("preAction", async (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.version) {
      await displayVersion(container, currentVersion);
      throw new VersionExit();
    }
  });
}

async function displayVersion(
  container: CliContainer,
  currentVersion: string
): Promise<void> {
  const { loggerFactory, httpClient } = container;
  const logger = loggerFactory.create({
    dryRun: false,
    verbose: false,
    scope: "version"
  });

  logger.intro("version");

  const versionValue =
    currentVersion === "0.0.0-dev"
      ? `${currentVersion} ${text.badge("local build")}`
      : currentVersion;
  logger.resolved("poe-code", versionValue);

  const result = await checkForUpdate({
    currentVersion,
    httpClient
  });

  if (result?.updateAvailable) {
    logger.warn(
      `Update available: ${result.currentVersion} -> ${result.latestVersion}`
    );
    logger.resolved("Update", `bun install --global poe-code@latest`);
  }
}
