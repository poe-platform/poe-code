import * as fs from "node:fs/promises";
import * as os from "node:os";
import type { FileSystem } from "../utils/file-system.js";
import type { CliContainer } from "../cli/container.js";
import { createCliEnvironment } from "../cli/environment.js";
import { createServiceRegistry } from "../cli/service-registry.js";
import { createCommandContextFactory } from "../cli/context.js";
import { createPromptLibrary } from "../cli/prompts.js";
import { createOptionResolvers } from "../cli/options.js";
import { createLoggerFactory } from "../cli/logger.js";
import { ErrorLogger } from "../cli/error-logger.js";
import { createDefaultCommandRunner } from "../cli/command-runner.js";
import { getDefaultProviders } from "../providers/index.js";
import { createPoeCodeCommandRunner } from "../cli/poe-code-command-runner.js";
import {
  loadCredentials,
  saveCredentials
} from "../services/credentials.js";
import * as nodeFsSync from "node:fs";

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
    writeFile: (path, data, opts) =>
      fs.writeFile(path, data, opts),
    mkdir: (path, opts) => fs.mkdir(path, opts).then(() => {}),
    stat: (path) => fs.stat(path),
    rm: (path, opts) => fs.rm(path, opts),
    unlink: (path) => fs.unlink(path),
    readdir: (path) => fs.readdir(path),
    copyFile: (src, dest) => fs.copyFile(src, dest),
    chmod: (path, mode) => fs.chmod(path, mode)
  };

  const contextFactory = createCommandContextFactory({ fs: asyncFs });

  // No-op prompts for SDK (non-interactive)
  const noopPrompts = async () => {
    throw new Error("SDK does not support interactive prompts");
  };

  const promptLibrary = createPromptLibrary();

  const optionResolvers = createOptionResolvers({
    prompts: noopPrompts,
    promptLibrary,
    apiKeyStore: {
      read: () =>
        loadCredentials({
          fs: asyncFs,
          filePath: environment.credentialsPath
        }),
      write: (value) =>
        saveCredentials({
          fs: asyncFs,
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

  const baseRunner = createDefaultCommandRunner();

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
    }
  };

  return container;
}
