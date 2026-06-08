import * as nodeFs from "node:fs/promises";
import * as nodeFsSync from "node:fs";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { log } from "@poe-code/design-system";
import chalk from "chalk";
import type { Command } from "commander";
import type { FileSystem } from "../utils/file-system.js";
import { ErrorLogger } from "./error-logger.js";
import { CliError, isSilentError } from "./errors.js";
import type { CliDependencies } from "./program.js";
import { createPromptRunner } from "./prompt-runner.js";

const fsAdapter = nodeFs as unknown as FileSystem;
const REDACTED_ARG_VALUE = "[redacted]";

export function createCliMain(
  programFactory: (dependencies: CliDependencies) => Command
): () => Promise<void> {
  return async function runCli(): Promise<void> {
    const homeDir = homedir();
    const logDir = join(homeDir, ".poe-code", "logs");
    const promptRunner = createPromptRunner();

    // Create global error logger for bootstrapping errors
    const shouldLogToStderr =
      process.env.POE_CODE_STDERR_LOGS === "1" ||
      process.env.POE_CODE_STDERR_LOGS === "true";

    const errorLogger = new ErrorLogger({
      fs: nodeFsSync as any,
      logDir,
      logToStderr: shouldLogToStderr
    });

    const program = programFactory({
      fs: fsAdapter,
      prompts: promptRunner,
      env: {
        cwd: process.cwd(),
        homeDir,
        platform: process.platform,
        variables: process.env
      },
      exitOverride: false
    });

    try {
      await program.parseAsync(process.argv);
    } catch (error) {
      if (isSilentError(error)) {
        return;
      }
      if (error instanceof Error) {
        const isDryRun = Boolean(program.optsWithGlobals().dryRun);
        if (!isDryRun) {
          errorLogger.logErrorWithStackTrace(error, "CLI execution", {
            component: "main",
            argv: redactSensitiveArgv(process.argv)
          });
        }

        // Display user-friendly message
        if (error instanceof CliError && error.isUserError) {
          log.error(error.message);
        } else {
          log.error(`Error: ${error.message}`);
          if (!isDryRun) {
            log.message(
              `See logs at ${join(logDir, "errors.log")} for more details.`,
              { symbol: chalk.magenta("●") }
            );
          }
        }

        process.exit(1);
      }
      throw error;
    }
  };
}

export function redactSensitiveArgv(argv: readonly string[]): string[] {
  const redacted: string[] = [];
  let shouldRedactNext = false;

  for (const argument of argv) {
    if (shouldRedactNext) {
      redacted.push(REDACTED_ARG_VALUE);
      shouldRedactNext = false;
      continue;
    }

    const equalsIndex = argument.indexOf("=");
    if (equalsIndex > 0) {
      const name = argument.slice(0, equalsIndex);
      if (isSensitiveArgumentName(name)) {
        redacted.push(`${name}=${REDACTED_ARG_VALUE}`);
        continue;
      }
    }

    redacted.push(argument);
    shouldRedactNext = isSensitiveArgumentName(argument);
  }

  return redacted;
}

function isSensitiveArgumentName(argument: string): boolean {
  if (!argument.startsWith("-")) {
    return false;
  }

  const normalized = argument.replace(/^-+/, "").toLowerCase();
  return /(?:api[-_]?key|token|secret|password|passwd|pwd)/u.test(normalized);
}

export function isCliInvocation(
  argv: string[],
  moduleUrl: string,
  realpath: (path: string) => string = realpathSync
): boolean {
  const entry = argv.at(1);
  if (typeof entry !== "string") {
    return false;
  }

  const candidates = [pathToFileURL(entry).href];

  try {
    candidates.push(pathToFileURL(realpath(entry)).href);
  } catch {
    // Ignore resolution errors; fall back to direct comparison.
  }

  return candidates.includes(moduleUrl);
}
