import * as nodeFsSync from "node:fs";
import type { FileSystem } from "../utils/file-system.js";
import { createSecretStore } from "auth-store";
import { createCliEnvironment } from "./environment.js";
import { createServiceRegistry, type ProviderService } from "./service-registry.js";
import { createCommandContextFactory, type CommandContextFactory } from "./context.js";
import { createPromptLibrary } from "./prompts.js";
import { createOptionResolvers, type OptionResolvers } from "./options.js";
import { createLoggerFactory, type LoggerFactory } from "./logger.js";
import { ErrorLogger } from "./error-logger.js";
import { runCommand } from "@poe-code/agent-spawn";
import type { PromptFn, LoggerFn } from "./types.js";
import {
  text,
  symbols,
  confirm as dsConfirm,
  isCancel,
  cancel as dsCancel
} from "@poe-code/design-system";
import type { HttpClient } from "./http.js";
import type { CommandRunner } from "../utils/command-checks.js";
import { getDefaultProviders } from "../providers/index.js";
import { createPoeCodeCommandRunner } from "./poe-code-command-runner.js";
import { OperationCancelledError } from "./errors.js";
import { resolveApiKeyViaOAuth } from "./oauth-login.js";

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
  readonly readApiKey: () => Promise<string | null>;
  readonly writeApiKey: (apiKey: string) => Promise<void>;
  readonly deleteApiKey: () => Promise<void>;
}

export function createCliContainer(dependencies: CliDependencies): CliContainer {
  const environment = createCliEnvironment({
    cwd: dependencies.env.cwd,
    homeDir: dependencies.env.homeDir,
    platform: dependencies.env.platform,
    variables: dependencies.env.variables
  });

  const loggerFactory = createLoggerFactory(dependencies.logger, {
    intro: text.intro,
    resolvedSymbol: symbols.resolved
  });

  // Create error logger - use node:fs for sync operations
  const errorLogger = new ErrorLogger({
    fs: nodeFsSync as any,
    logDir: environment.logDir,
    logToStderr: true
  });

  // Attach error logger to logger factory.
  // When a custom logger emitter is provided (e.g. tests), skip wiring the
  // ErrorLogger — the emitter already captures error messages via emit().
  if (!dependencies.logger) {
    loggerFactory.setErrorLogger(errorLogger);
  }

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

  const commandRunner = dependencies.commandRunner ?? runCommand;

  const promptLibrary = createPromptLibrary();

  const authFs = {
    readFile: (filePath: string, encoding: BufferEncoding) =>
      dependencies.fs.readFile(filePath, encoding),
    writeFile: (
      filePath: string,
      data: string | NodeJS.ArrayBufferView,
      opts?: { encoding?: BufferEncoding }
    ) => dependencies.fs.writeFile(filePath, data, opts),
    mkdir: (directoryPath: string, opts?: { recursive?: boolean }) =>
      dependencies.fs.mkdir(directoryPath, opts).then(() => undefined),
    unlink: (filePath: string) => dependencies.fs.unlink(filePath),
    chmod: (filePath: string, mode: number) =>
      dependencies.fs.chmod ? dependencies.fs.chmod(filePath, mode) : Promise.resolve()
  };

  const { store: authStore } = createSecretStore({
    backendEnvVar: "POE_AUTH_BACKEND",
    env: dependencies.env.variables,
    platform: dependencies.env.platform,
    fileStore: {
      fs: authFs,
      salt: "poe-code:encrypted-file-auth-store:v1",
      defaultDirectory: ".poe-code",
      defaultFileName: "credentials.enc",
      getHomeDirectory: () => dependencies.env.homeDir
    }
  });

  const readApiKey = authStore.get.bind(authStore);
  const writeApiKey = authStore.set.bind(authStore);
  const deleteApiKey = authStore.delete.bind(authStore);

  const oauthEnabled = (dependencies.env.variables ?? process.env).POE_CODE_OAUTH_LOGIN !== "0";

  const options = createOptionResolvers({
    prompts: dependencies.prompts,
    promptLibrary,
    apiKeyStore: {
      read: readApiKey,
      write: writeApiKey
    },
    confirm: async (message) => {
      const result = await dsConfirm({ message });
      if (isCancel(result)) {
        dsCancel("Operation cancelled.");
        throw new OperationCancelledError();
      }
      return result === true;
    },
    loginViaOAuth: oauthEnabled ? resolveApiKeyViaOAuth : undefined
  });

  const registry = createServiceRegistry();

  const providers = getDefaultProviders().filter((adapter) => !adapter.disabled);
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
    dependencies,
    readApiKey,
    writeApiKey,
    deleteApiKey
  };

  return container;
}
