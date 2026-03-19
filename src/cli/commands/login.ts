import type { Command } from "commander";
import { exec } from "node:child_process";
import readline from "node:readline";
import type { CliContainer } from "../container.js";
import {
  buildProviderContext,
  createExecutionResources,
  resolveCommandFlags,
  applyIsolatedConfiguration
} from "./shared.js";
import {
  loadConfiguredServices
} from "../../services/config.js";
import { ValidationError } from "../errors.js";
import {
  combineMutationObservers,
  createMutationReporter
} from "../../services/mutation-events.js";
import { createOAuthClient } from "@poe-code/auth";
import {
  text,
  log
} from "@poe-code/design-system";

export interface LoginCommandOptions {
  apiKey?: string;
}

export function registerLoginCommand(
  program: Command,
  container: CliContainer
): void {
  program
    .command("login")
    .description("Store a Poe API key for reuse across commands.")
    .option("--api-key <key>", "Poe API key")
    .action(async (options: LoginCommandOptions) => {
      await executeLogin(program, container, options);
    });
}

export async function executeLogin(
  program: Command,
  container: CliContainer,
  options: LoginCommandOptions
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(
    container,
    flags,
    "login"
  );

  resources.logger.intro("login");

  try {
    const input = await resolveApiKeyInput(container, options);
    const normalized = container.options.normalizeApiKey(input);

    const configuredServices = await loadConfiguredServices({
      fs: container.fs,
      filePath: container.env.configPath
    });

    if (!flags.dryRun) {
      await container.writeApiKey(normalized);
    }

    await reconfigureServices({
      program,
      container,
      apiKey: normalized,
      configuredServices
    });

    resources.context.complete({
      success: "Logged in.",
      dry: "Dry run: would save API key."
    });

    resources.context.finalize();
  } catch (error) {
    if (error instanceof Error) {
      resources.logger.logException(error, "login command", {
        operation: "login",
        configPath: container.env.configPath
      });
    }
    throw error;
  }
}

async function resolveApiKeyInput(
  container: CliContainer,
  options: LoginCommandOptions
): Promise<string> {
  if (options.apiKey) {
    return options.apiKey;
  }

  const envKey = container.env.getVariable("POE_API_KEY");
  if (envKey && envKey.trim().length > 0) {
    return envKey;
  }

  if (container.env.getVariable("POE_CODE_OAUTH_LOGIN") === "1") {
    return resolveApiKeyViaOAuth();
  }

  const descriptor = container.promptLibrary.loginApiKey();
  const response = await container.prompts(descriptor);
  const value = response[descriptor.name];

  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError("POE API key is required.", {
      operation: "login",
      field: "apiKey"
    });
  }

  return value;
}

async function resolveApiKeyViaOAuth(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin
  });

  try {
    const client = createOAuthClient({
      clientId: "client_f520ee4d8ca84a13ba876a8731d264d0",
      authorizationEndpoint: "https://poe.com/authorize",
      tokenEndpoint: "https://api.poe.com/token",
      openBrowser: (url) =>
        openInBrowser(url).catch(() => {
          log.warn("Could not open browser automatically.");
        }),
      readLine: () =>
        new Promise<string>((resolve) => {
          rl.once("line", (line) => resolve(line));
        })
    });

    const authorization = await client.authorize();

    log.message(`${text.muted("Authorize at")} ${text.link(authorization.authorizationUrl)}`);
    log.message(text.muted("Waiting for authorization. You can also paste the redirect URL here:"))

    const result = await authorization.waitForResult();

    return result.apiKey;
  } finally {
    rl.close();
  }
}

function openInBrowser(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const platform = process.platform;
    const command =
      platform === "darwin"
        ? `open "${url}"`
        : platform === "win32"
          ? `start "" "${url}"`
          : `xdg-open "${url}"`;

    exec(command, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

interface ReconfigureServicesInput {
  program: Command;
  container: CliContainer;
  apiKey: string;
  configuredServices: Record<string, { files: string[] }>;
}

async function reconfigureServices(
  input: ReconfigureServicesInput
): Promise<void> {
  const { program, container, apiKey, configuredServices } = input;
  const serviceNames = Object.keys(configuredServices);

  for (const serviceName of serviceNames) {
    const adapter = container.registry.get(serviceName);
    if (!adapter) {
      continue;
    }

    const flags = resolveCommandFlags(program);
    const resources = createExecutionResources(
      container,
      flags,
      `login:reconfigure:${serviceName}`
    );
    const providerContext = buildProviderContext(container, adapter, resources);

    const payload = {
      env: container.env,
      apiKey
    };

    const mutationLogger = createMutationReporter(resources.logger);
    const observers = combineMutationObservers(mutationLogger);

    await container.registry.invoke(serviceName, "configure", async (entry) => {
      if (!entry.configure) {
        return;
      }

      await entry.configure(
        {
          fs: providerContext.command.fs,
          env: providerContext.env,
          command: providerContext.command,
          options: payload
        },
        observers ? { observers } : undefined
      );

      const isolated = adapter.isolatedEnv;
      if (isolated && isolated.requiresConfig !== false) {
        await applyIsolatedConfiguration({
          adapter: entry,
          providerContext,
          payload,
          isolated,
          providerName: adapter.name,
          observers
        });
      }
    });
  }
}
