import * as nodeFsSync from "node:fs";
import type { FileSystem } from "../utils/file-system.js";
import {
  loadCredentials,
  saveCredentials
} from "../services/credentials.js";
import { createCliEnvironment } from "./environment.js";
import {
  createServiceRegistry,
  type ProviderService
} from "./service-registry.js";
import {
  createCommandContextFactory,
  type CommandContextFactory
} from "./context.js";
import { createPromptLibrary } from "./prompts.js";
import {
  createOptionResolvers,
  type OptionResolvers
} from "./options.js";
import {
  createLoggerFactory,
  type LoggerFactory
} from "./logger.js";
import { ErrorLogger } from "./error-logger.js";
import { createDefaultCommandRunner } from "./command-runner.js";
import type { PromptFn, LoggerFn } from "./types.js";
import { createMenuTheme } from "./ui/theme.js";
import type { HttpClient } from "./http.js";
import type { CommandRunner } from "../utils/command-checks.js";
import { getDefaultProviders } from "../providers/index.js";
import { createPoeCodeCommandRunner } from "./poe-code-command-runner.js";

export interface CliDependencies {
  fs: FileSystem;
  prompts: PromptFn;
  env: {
    cwd: string;
    homeDir: string;
    platform?: NodeJS.Platform;
    variables?: Record<string, string | undefined>;
  };
  logger?: LoggerFn;
  exitOverride?: boolean;
  suppressCommanderOutput?: boolean;
  httpClient?: HttpClient;
  commandRunner?: CommandRunner;
}

export interface CliContainer {
  readonly env: ReturnType<typeof createCliEnvironment>;
  readonly fs: FileSystem;
  readonly prompts: PromptFn;
  readonly promptLibrary: ReturnType<typeof createPromptLibrary>;
  readonly loggerFactory: LoggerFactory;
  readonly errorLogger: ErrorLogger;
  readonly options: OptionResolvers;
  readonly contextFactory: CommandContextFactory;
  readonly registry: ReturnType<typeof createServiceRegistry>;
  readonly httpClient: HttpClient;
  readonly commandRunner: CommandRunner;
  readonly providers: ProviderService[];
  readonly dependencies: CliDependencies;
}

export function createCliContainer(
  dependencies: CliDependencies
): CliContainer {
  const environment = createCliEnvironment({
    cwd: dependencies.env.cwd,
    homeDir: dependencies.env.homeDir,
    platform: dependencies.env.platform,
    variables: dependencies.env.variables
  });

  const menuTheme = createMenuTheme(environment);
  const loggerFactory = createLoggerFactory(dependencies.logger, {
    intro: menuTheme.palette.intro,
    resolvedSymbol: menuTheme.palette.resolvedSymbol
  });

  // Create error logger - use node:fs for sync operations
  const errorLogger = new ErrorLogger({
    fs: nodeFsSync as any,
    logDir: environment.logDir,
    logToStderr: true
  });

  // Attach error logger to logger factory
  loggerFactory.setErrorLogger(errorLogger);

  const contextFactory = createCommandContextFactory({
    fs: dependencies.fs
  });

  const httpClient: HttpClient =
    dependencies.httpClient ??
    (async (url, init) => {
      const response = await globalThis.fetch(url, init);
      return {
        ok: response.ok,
        status: response.status,
        json: () => response.json(),
        text: () => response.text()
      };
    });

  const commandRunner =
    dependencies.commandRunner ?? createDefaultCommandRunner();

  const promptLibrary = createPromptLibrary();

  const options = createOptionResolvers({
    prompts: dependencies.prompts,
    promptLibrary,
    apiKeyStore: {
      read: () =>
        loadCredentials({
          fs: dependencies.fs,
          filePath: environment.credentialsPath
        }),
      write: (value) =>
        saveCredentials({
          fs: dependencies.fs,
          filePath: environment.credentialsPath,
          apiKey: value
        })
    }
  });

  const registry = createServiceRegistry();

  const providers = getDefaultProviders().filter(
    (adapter) => !adapter.disabled
  );
  for (const adapter of providers) {
    registry.register(adapter);
  }

  let container: CliContainer = null as unknown as CliContainer;
  const wrappedRunner = createPoeCodeCommandRunner({
    getContainer: () => container,
    baseRunner: commandRunner
  });

  container = {
    env: environment,
    fs: dependencies.fs,
    prompts: dependencies.prompts,
    promptLibrary,
    loggerFactory,
    errorLogger,
    options,
    contextFactory,
    registry,
    httpClient,
    commandRunner: wrappedRunner,
    providers,
    dependencies
  };

  return container;
}
