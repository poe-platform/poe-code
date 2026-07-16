import type { Command } from "commander";
import { isNotFound } from "@poe-code/config-mutations";
import type { CliContainer } from "../container.js";
import { deleteConfig, loadConfiguredServices } from "../../services/config.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import { confirmDestructive } from "./confirm-destructive.js";
import { executeUnconfigure } from "./unconfigure.js";

export const logoutScopeDescription =
  "Danger: full reset. Removes stored credentials for every logged-in account and removes configuration for ALL configured agents. Requires --yes to run non-interactively; preview with --dry-run.";

export function registerLogoutCommand(program: Command, container: CliContainer): void {
  program
    .command("logout")
    .description(logoutScopeDescription)
    .action(async () => {
      await executeLogout(program, container);
    });
}

export async function executeLogout(program: Command, container: CliContainer): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "logout");

  resources.logger.intro("logout");

  const configuredServices = await loadConfiguredServices({
    fs: container.fs,
    filePath: container.env.configPath,
    projectFilePath: container.env.projectConfigPath,
    readOnly: flags.dryRun
  });

  const authenticatedProviders = await Promise.all(
    container.providerRegistry.list().map(async (provider) => ({
      id: provider.id,
      authenticated: await container.providerRegistry.isLoggedIn(provider.id, {
        readOnly: flags.dryRun
      })
    }))
  );
  const configuredAgents = Object.keys(configuredServices);
  await confirmDestructive({
    logger: resources.logger,
    flags,
    action: "logout",
    summary: [
      configuredAgents.length > 0
        ? `Removes configuration for ALL configured agents: ${configuredAgents.join(", ")}.`
        : "Removes configuration for ALL configured agents (none configured).",
      `Deletes stored credentials at ${container.env.configPath} and ${container.env.servicesConfigPath}.`,
      ...authenticatedProviders
        .filter((provider) => provider.authenticated)
        .map((provider) => `Logs out provider ${provider.id}.`)
    ],
    message: "Remove all configuration and credentials?"
  });

  if (!flags.dryRun) {
    for (const provider of authenticatedProviders) {
      await container.providerRegistry.logout(provider.id);
    }
  }

  for (const serviceName of configuredAgents) {
    const adapter = container.registry.get(serviceName);
    if (!adapter) {
      continue;
    }
    await executeUnconfigure(program, container, serviceName, { alreadyConfirmed: true });
  }

  const environmentCredential = container.env.getVariable("POE_API_KEY");
  const hasEnvironmentCredential =
    typeof environmentCredential === "string" && environmentCredential.trim().length > 0;

  if (flags.dryRun) {
    const hasStoredState =
      Object.keys(configuredServices).length > 0 ||
      authenticatedProviders.some((provider) => provider.authenticated) ||
      hasEnvironmentCredential ||
      (await fileExists(container, container.env.configPath)) ||
      (await fileExists(container, container.env.servicesConfigPath));
    resources.context.complete({
      success: "Logged out.",
      dry: hasStoredState
        ? `Dry run: would delete config at ${container.env.configPath}.`
        : "Already logged out."
    });
    resources.context.finalize();
    return;
  }

  const deleted = await deleteConfig({
    fs: container.fs,
    filePath: container.env.configPath
  });
  const deletedServicesConfig = await deleteConfig({
    fs: container.fs,
    filePath: container.env.servicesConfigPath
  });

  resources.context.complete({
    success: hasEnvironmentCredential
      ? "Stored credentials removed, but POE_API_KEY remains set; unset it to log out fully."
      : deleted || deletedServicesConfig || authenticatedProviders.some((provider) => provider.authenticated)
        ? "Logged out."
        : "Already logged out.",
    dry: `Dry run: would delete config at ${container.env.configPath}.`
  });

  resources.context.finalize();
}

async function fileExists(container: CliContainer, filePath: string): Promise<boolean> {
  try {
    await container.fs.lstat(filePath);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}
