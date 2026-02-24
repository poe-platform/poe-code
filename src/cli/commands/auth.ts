import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import { ApiError } from "../errors.js";
import { loadConfiguredServices } from "../../services/config.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import { executeLogin, type LoginCommandOptions } from "./login.js";
import { executeLogout } from "./logout.js";

export function registerAuthCommand(
  program: Command,
  container: CliContainer
): void {
  const auth = program
    .command("auth")
    .description("Authentication and account commands.")
    .action(async () => {
      await executeStatus(program, container);
    });

  auth
    .command("status")
    .description("Show login, balance, and configuration status.")
    .action(async () => {
      await executeStatus(program, container);
    });

  auth
    .command("api_key")
    .description("Display stored API key.")
    .action(async () => {
      await executeApiKey(program, container);
    });

  auth
    .command("login")
    .description("Store a Poe API key.")
    .option("--api-key <key>", "Poe API key")
    .action(async (options: LoginCommandOptions) => {
      await executeLogin(program, container, options);
    });

  auth
    .command("logout")
    .description("Remove all configuration and credentials.")
    .action(async () => {
      await executeLogout(program, container);
    });
}

async function executeStatus(
  program: Command,
  container: CliContainer
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "auth:status");

  resources.logger.intro("auth status");

  try {
    const apiKey = await container.readApiKey();
    const loggedIn = Boolean(apiKey);
    resources.logger.info(loggedIn ? "Logged in" : "Not logged in");

    if (loggedIn) {
      if (flags.dryRun) {
        resources.logger.dryRun(
          "Dry run: would fetch usage balance from Poe API."
        );
      } else {
        const response = await container.httpClient(
          `${container.env.poeBaseUrl}/usage/current_balance`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${apiKey}`
            }
          }
        );

        if (!response.ok) {
          throw new ApiError(
            `Failed to fetch usage balance (HTTP ${response.status})`,
            {
              httpStatus: response.status,
              endpoint: "/usage/current_balance"
            }
          );
        }

        const data = (await response.json()) as { current_point_balance: number };
        const formattedBalance = data.current_point_balance.toLocaleString(
          "en-US"
        );
        resources.logger.info(`Current balance: ${formattedBalance} points`);
      }
    }

    const configuredServices = await loadConfiguredServices({
      fs: container.fs,
      filePath: container.env.configPath
    });

    const configuredAgentNames = Object.keys(configuredServices).sort();

    if (configuredAgentNames.length === 0) {
      resources.logger.info("No agents configured.");
      return;
    }

    resources.logger.info(
      `Configured agents: ${configuredAgentNames.join(", ")}`
    );
  } catch (error) {
    if (error instanceof Error) {
      resources.logger.logException(error, "auth status", {
        operation: "auth-status"
      });
    }
    throw error;
  }
}

async function executeApiKey(
  program: Command,
  container: CliContainer
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "auth:api_key");

  resources.logger.intro("auth api_key");

  const apiKey = await container.readApiKey();
  if (!apiKey) {
    resources.logger.info("No API key stored.");
    return;
  }

  resources.logger.info(`API key: ${apiKey}`);
}
