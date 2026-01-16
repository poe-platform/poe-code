import {
  DryRunRecorder,
  createDryRunFileSystem,
  formatDryRunOperations
} from "../utils/dry-run.js";
import type { FileSystem } from "../utils/file-system.js";
import type {
  CommandRunner,
  CommandRunnerResult
} from "../utils/command-checks.js";
import type { ScopedLogger } from "./logger.js";
import { FEEDBACK_URL } from "./constants.js";

export interface CommandContextOptions {
  dryRun: boolean;
  logger: ScopedLogger;
  runner: CommandRunner;
}

export interface CommandContextComplete {
  success: string;
  dry: string;
}

export interface CommandContext {
  fs: FileSystem;
  runCommand: CommandRunner;
  runCommandWithEnv(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string | undefined> }
  ): Promise<CommandRunnerResult>;
  flushDryRun(options?: { emitIfEmpty?: boolean }): void;
  complete(messages: CommandContextComplete): void;
  finalize(): void;
}

export interface CommandContextFactoryInit {
  fs: FileSystem;
}

export interface CommandContextFactory {
  create(options: CommandContextOptions): CommandContext;
}

export function createCommandContextFactory(
  init: CommandContextFactoryInit
): CommandContextFactory {
  const { fs } = init;

  const create = (options: CommandContextOptions): CommandContext => {
    if (!options.dryRun) {
      return {
        fs,
        runCommand: options.runner,
        runCommandWithEnv(command, args, runOptions) {
          return options.runner(command, args, {
            cwd: runOptions?.cwd,
            env: runOptions?.env
          });
        },
        flushDryRun() {},
        complete(messages) {
          options.logger.success(messages.success);
        },
        finalize() {
          options.logger.feedback("Problems?", FEEDBACK_URL);
        }
      };
    }

    const recorder = new DryRunRecorder();
    const proxyFs = createDryRunFileSystem(fs, recorder);
    const recordedCommands = new Set<string>();
    let hasEmittedOperations = false;

    const flush = (emitIfEmpty = false): void => {
      const operations = recorder.drain();
      if (operations.length === 0) {
        if (emitIfEmpty && !hasEmittedOperations) {
          const lines = formatDryRunOperations(operations);
          for (const line of lines) {
            options.logger.info(line);
          }
        }
        return;
      }
      hasEmittedOperations = true;

      for (const line of formatDryRunOperations(operations)) {
        const base = extractBaseCommand(line);
        if (!recordedCommands.has(base)) {
          options.logger.info(line);
          recordedCommands.add(base);
        }
      }
    };

    return {
      fs: proxyFs,
      runCommand: options.runner,
      runCommandWithEnv(command, args, runOptions) {
        return options.runner(command, args, {
          cwd: runOptions?.cwd,
          env: runOptions?.env
        });
      },
      flushDryRun({ emitIfEmpty }: { emitIfEmpty?: boolean } = {}) {
        flush(Boolean(emitIfEmpty));
      },
      complete(messages) {
        options.logger.dryRun(messages.dry);
        flush(true);
      },
      finalize() {
        options.logger.feedback("Problems?", FEEDBACK_URL);
      }
    };
  };

  return { create };
}

export function createLoggingCommandRunner(
  runner: CommandRunner,
  logger: ScopedLogger
): CommandRunner {
  return async (
    command,
    args,
    options
  ): Promise<CommandRunnerResult> => {
    const rendered = [command, ...args].join(" ").trim();
    const suffix = options?.cwd ? ` (cwd: ${options.cwd})` : "";
    logger.verbose(`> ${rendered}${suffix}`);
    if (options) {
      return runner(command, args, options);
    }
    return runner(command, args);
  };
}

function extractBaseCommand(message: string): string {
  const raw = stripAnsi(message);
  const detailIndex = raw.indexOf(" #");
  return detailIndex >= 0 ? raw.slice(0, detailIndex).trim() : raw.trim();
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}
