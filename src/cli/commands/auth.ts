import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import { spinner } from "toolcraft-design";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import { executeLogin, type LoginCommandOptions } from "./login.js";
import { executeLogout } from "./logout.js";
import { fetchPoeAuthIdentity } from "../../sdk/credentials.js";

interface ApiKeyCommandOptions {
  reveal?: boolean;
}

export function registerAuthCommand(program: Command, container: CliContainer): void {
  const auth = program
    .command("auth")
    .description("Authentication and account commands.")
    .action(async () => {
      await executeStatus(program, container);
    });

  auth
    .command("status")
    .description("Show login status.")
    .action(async () => {
      await executeStatus(program, container);
    });

  auth
    .command("api-key")
    .description(
      "Display stored API key, masked to the last 4 characters. Danger: --reveal writes the full secret to stdout, where scrollback, screenshots, and CI logs can capture it."
    )
    .option("--reveal", "Print the full API key to stdout (for use in command substitution).")
    .action(async (options: ApiKeyCommandOptions) => {
      await executeApiKey(program, container, options);
    });

  auth
    .command("api_key", { hidden: true })
    .option("--reveal", "Print the full API key to stdout (for use in command substitution).")
    .action(async (options: ApiKeyCommandOptions) => {
      await executeApiKey(program, container, options);
    });

  auth
    .command("whoami")
    .description("Print Poe account identity as JSON (uses POE_API_KEY if set).")
    .action(async () => {
      await executeWhoami(program, container);
    });

  auth
    .command("login")
    .description("Store a Poe API key for reuse across commands.")
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
    const apiKey = await resolveAuthCredential(container, { readOnly: flags.dryRun });

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

    let identity: Awaited<ReturnType<typeof fetchPoeAuthIdentity>>;
    try {
      identity = await fetchPoeAuthIdentity({
        apiKey,
        baseUrl: container.env.poeApiBaseUrl,
        httpClient: container.httpClient
      });
    } catch (error) {
      s.stop("Authentication failed");
      throw error;
    }

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

async function executeApiKey(
  program: Command,
  container: CliContainer,
  options: ApiKeyCommandOptions
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const apiKey = await container.readApiKey({ readOnly: flags.dryRun });
  if (!apiKey) {
    process.exitCode = 1;
    return;
  }

  const resources = createExecutionResources(container, flags, "auth:api-key");

  if (flags.dryRun) {
    resources.logger.dryRun(
      options.reveal
        ? "Dry run: would write the full API key to stdout."
        : "Dry run: would display the masked API key."
    );
    resources.context.finalize();
    return;
  }

  if (options.reveal) {
    process.stdout.write(apiKey);
    return;
  }

  process.stdout.write(`${maskApiKey(apiKey)}\n`);
  resources.logger.warn("Masked to the last 4 characters. Re-run with --reveal to print the full secret.");
  resources.context.finalize();
}

function maskApiKey(apiKey: string): string {
  const suffix = apiKey.length > 4 ? apiKey.slice(-4) : "";
  return `${"*".repeat(8)}${suffix}`;
}

async function resolveAuthCredential(
  container: CliContainer,
  options: { readOnly?: boolean } = {}
): Promise<string | null> {
  const envKey = container.env.getVariable("POE_API_KEY");
  if (typeof envKey === "string" && envKey.trim().length > 0) {
    return envKey.trim();
  }
  return container.readApiKey(options);
}

async function executeWhoami(program: Command, container: CliContainer): Promise<void> {
  const flags = resolveCommandFlags(program);
  const apiKey = await resolveAuthCredential(container, { readOnly: flags.dryRun });
  if (!apiKey) {
    process.exitCode = 1;
    return;
  }

  if (flags.dryRun) {
    const resources = createExecutionResources(container, flags, "auth:whoami");
    resources.logger.dryRun("Dry run: would fetch identity from Poe API.");
    resources.context.finalize();
    return;
  }

  const identity = await fetchPoeAuthIdentity({
    apiKey,
    baseUrl: container.env.poeApiBaseUrl,
    httpClient: container.httpClient
  });
  process.stdout.write(`${JSON.stringify(identity)}\n`);
}
