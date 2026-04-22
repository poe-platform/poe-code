import * as fs from "node:fs/promises";
import * as os from "node:os";
import type { FileSystem } from "../utils/file-system.js";
import type { CliContainer } from "../cli/container.js";
import { createCliEnvironment } from "../cli/environment.js";
import { createServiceRegistry } from "../cli/service-registry.js";
import { createCommandContextFactory } from "../cli/context.js";
import { createPromptLibrary } from "../cli/prompts.js";
import { checkAuth } from "poe-oauth";
import { createOptionResolvers } from "../cli/options.js";
import { createLoggerFactory } from "../cli/logger.js";
import { ErrorLogger } from "../cli/error-logger.js";
import { runCommand } from "@poe-code/agent-spawn";
import { getDefaultProviders } from "../providers/index.js";
import { ProviderRegistry, poeProvider } from "@poe-code/providers";
import { createPoeCodeCommandRunner } from "../cli/poe-code-command-runner.js";
import * as nodeFsSync from "node:fs";
import { createSecretStore } from "auth-store";

export interface SdkContainerOptions {
  /** Working directory (defaults to process.cwd()) */
  cwd?: string;
  /** Home directory (defaults to os.homedir()) */
  homeDir?: string;
  /** Environment variables (defaults to process.env) */
  variables?: Record<string, string | undefined>;
  /** Enable verbose logging (defaults to false) */
  verbose?: boolean;
}

/**
 * Creates a lightweight container for SDK usage.
 * Uses real file system and command runner.
 * No prompts needed (non-interactive).
 * Minimal logger (silent by default).
 */
export function createSdkContainer(options?: SdkContainerOptions): CliContainer {
  const cwd = options?.cwd ?? process.cwd();
  const homeDir = options?.homeDir ?? os.homedir();
  const variables = options?.variables ?? process.env;
  const verbose = options?.verbose ?? false;

  const environment = createCliEnvironment({
    cwd,
    homeDir,
    platform: process.platform,
    variables
  });

  // Silent logger for SDK - only emits if verbose
  const silentEmitter = verbose ? undefined : () => {};
  const loggerFactory = createLoggerFactory(silentEmitter);

  // Create error logger with sync fs
  const errorLogger = new ErrorLogger({
    fs: nodeFsSync as any,
    logDir: environment.logDir,
    logToStderr: false
  });
  loggerFactory.setErrorLogger(errorLogger);

  // Create async file system adapter
  const asyncFs: FileSystem = {
    readFile: ((path: string, encoding?: BufferEncoding) => {
      if (encoding) {
        return fs.readFile(path, encoding);
      }
      return fs.readFile(path);
    }) as FileSystem["readFile"],
    symlink: (target, path) => fs.symlink(target, path),
    readlink: (path) => fs.readlink(path, { encoding: "utf8" }),
    writeFile: (path, data, opts) => fs.writeFile(path, data, opts),
    mkdir: (path, opts) => fs.mkdir(path, opts).then(() => {}),
    stat: (path) => fs.stat(path),
    lstat: (path) => fs.lstat(path),
    rename: (oldPath, newPath) => fs.rename(oldPath, newPath),
    rm: (path, opts) => fs.rm(path, opts),
    unlink: (path) => fs.unlink(path),
    readdir: (path) => fs.readdir(path),
    copyFile: (src, dest) => fs.copyFile(src, dest),
    chmod: (path, mode) => fs.chmod(path, mode)
  };

  const contextFactory = createCommandContextFactory({ fs: asyncFs });

  const authFs = {
    readFile: (filePath: string, encoding: BufferEncoding) => fs.readFile(filePath, encoding),
    writeFile: (
      filePath: string,
      data: string | NodeJS.ArrayBufferView,
      options?: { encoding?: BufferEncoding }
    ) => fs.writeFile(filePath, data, options),
    mkdir: (directoryPath: string, options?: { recursive?: boolean }) =>
      fs.mkdir(directoryPath, options).then(() => undefined),
    unlink: (filePath: string) => fs.unlink(filePath),
    chmod: (filePath: string, mode: number) => fs.chmod(filePath, mode)
  };

  const { store: authStore } = createSecretStore({
    backendEnvVar: "POE_AUTH_BACKEND",
    env: variables,
    platform: process.platform,
    fileStore: {
      fs: authFs,
      salt: "poe-code:encrypted-file-auth-store:v1",
      defaultDirectory: ".poe-code",
      defaultFileName: "credentials.enc",
      getHomeDirectory: () => homeDir
    }
  });

  const readApiKey = authStore.get.bind(authStore);
  const writeApiKey = authStore.set.bind(authStore);
  const deleteApiKey = authStore.delete.bind(authStore);

  // No-op prompts for SDK (non-interactive)
  const noopPrompts = async () => {
    throw new Error("SDK does not support interactive prompts");
  };

  const promptLibrary = createPromptLibrary();

  const optionResolvers = createOptionResolvers({
    prompts: noopPrompts,
    promptLibrary,
    apiKeyStore: {
      read: readApiKey,
      write: writeApiKey
    },
    confirm: async () => true,
    checkAuth: async (apiKey) => (await checkAuth({ apiKey })) !== null
  });

  const registry = createServiceRegistry();

  const providerRegistry = new ProviderRegistry([poeProvider], (_id) => authStore);

  const providers = getDefaultProviders().filter((adapter) => !adapter.disabled);
  for (const adapter of providers) {
    registry.register(adapter);
  }

  const baseRunner = runCommand;

  // Create container with wrapped runner
  let container: CliContainer = null as unknown as CliContainer;
  const wrappedRunner = createPoeCodeCommandRunner({
    getContainer: () => container,
    baseRunner
  });

  // HTTP client using global fetch
  const httpClient = async (url: string, init?: RequestInit) => {
    const response = await globalThis.fetch(url, init);
    return {
      ok: response.ok,
      status: response.status,
      json: () => response.json()
    };
  };

  container = {
    env: environment,
    fs: asyncFs,
    prompts: noopPrompts,
    promptLibrary,
    loggerFactory,
    errorLogger,
    options: optionResolvers,
    contextFactory,
    registry,
    providerRegistry,
    httpClient,
    commandRunner: wrappedRunner,
    providers,
    dependencies: {
      fs: asyncFs,
      prompts: noopPrompts,
      env: {
        cwd,
        homeDir,
        platform: process.platform,
        variables
      }
    },
    readApiKey,
    writeApiKey,
    deleteApiKey
  };

  return container;
}
