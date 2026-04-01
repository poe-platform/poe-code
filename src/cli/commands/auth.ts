import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import { ApiError } from "../errors.js";
import { spinner } from "@poe-code/design-system";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import { executeLogin, type LoginCommandOptions } from "./login.js";
import { executeLogout } from "./logout.js";

export function registerAuthCommand(program: Command, container: CliContainer): void {
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

async function executeStatus(program: Command, container: CliContainer): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "auth:status");

  resources.logger.intro("auth status");

  try {
    const apiKey = await container.readApiKey();

    if (!apiKey) {
      resources.logger.info("Not logged in");
      resources.context.finalize();
      return;
    }

    if (flags.dryRun) {
      resources.logger.dryRun("Dry run: would fetch identity from Poe API.");
      resources.context.finalize();
      return;
    }

    const s = spinner();
    s.start("Checking authentication...");

    const response = await container.httpClient(
      `${container.env.poeApiBaseUrl}/whoami`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }
    );

    if (!response.ok) {
      s.stop("Authentication failed");
      throw new ApiError(`Failed to fetch identity (HTTP ${response.status})`, {
        httpStatus: response.status,
        endpoint: "/v1/whoami"
      });
    }

    const identity = (await response.json()) as {
      user_id: number;
      handle: string;
      name: string;
      profile_picture: string;
    };

    s.stop(`Logged in as ${identity.name} (@${identity.handle})`);
    resources.context.finalize();
  } catch (error) {
    if (error instanceof Error) {
      resources.logger.logException(error, "auth status", {
        operation: "auth-status"
      });
    }
    throw error;
  }
}

async function executeApiKey(program: Command, container: CliContainer): Promise<void> {
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
