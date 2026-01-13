import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import { checkForUpdate } from "../../services/version.js";
import { VersionExit } from "../exit-signals.js";

export function registerVersionOption(
  program: Command,
  container: CliContainer,
  currentVersion: string
): void {
  program.option("-V, --version", "output the version number");

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

  logger.info(`poe-code ${currentVersion}`);

  const result = await checkForUpdate({
    currentVersion,
    httpClient
  });

  if (result?.updateAvailable) {
    logger.info("");
    logger.info(
      `Update available: ${result.currentVersion} -> ${result.latestVersion}`
    );
    logger.info("Run: npm install -g poe-code@latest");
  }
}
