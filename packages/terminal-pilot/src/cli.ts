#!/usr/bin/env node
import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCLI } from "toolcraft/cli";
import { configureTheme } from "toolcraft/design";
import { createTerminalPilotGroup } from "./commands/index.js";
import {
  createDaemonTerminalPilotRuntime,
  isTerminalPilotDaemonArgv,
  runTerminalPilotDaemon
} from "./commands/daemon-runtime.js";
import type { TerminalPilotRuntime } from "./commands/runtime.js";

configureTheme({ brand: "green", label: "Terminal Pilot" });

declare const __TERMINAL_PILOT_VERSION__: string | undefined;

function getBundledPackageVersion(): string | undefined {
  return typeof __TERMINAL_PILOT_VERSION__ === "string"
    ? __TERMINAL_PILOT_VERSION__
    : undefined;
}

const pilotOptionsWithValues = new Set([
  "--session",
  "-s",
  "--cwd",
  "--cols",
  "--rows",
  "--timeout",
  "-t",
  "--last",
  "-n",
  "--output",
  "-o",
  "--scope",
  "--padding",
  "-p",
  "--log-level",
  "--preset",
  "--signal"
]);

/**
 * Rewrite pilot-level `--json` to toolcraft's `--output json`.
 * Stop once create-session (and similar) child argv begins so nested tools keep their own `--json`.
 */
export function normalizeArgv(argv: string[]): string[] {
  if (!argv.includes("--json")) {
    return argv;
  }
  if (argv.some((argument) => argument === "--output" || argument.startsWith("--output="))) {
    return argv;
  }

  const normalized: string[] = [];
  let index = 0;
  let bareTokenCount = 0;
  let expectOptionValue = false;

  while (index < argv.length) {
    const token = argv[index];

    if (index < 2) {
      normalized.push(token);
      index += 1;
      continue;
    }

    if (token === "--") {
      normalized.push(token, ...argv.slice(index + 1));
      break;
    }

    if (expectOptionValue) {
      normalized.push(token);
      expectOptionValue = false;
      index += 1;
      continue;
    }

    if (token === "--json") {
      normalized.push("--output", "json");
      index += 1;
      continue;
    }

    if (token.startsWith("-") && token !== "-") {
      normalized.push(token);
      const optionName = token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
      if (
        !token.includes("=") &&
        (pilotOptionsWithValues.has(optionName) ||
          (optionName === "--debug" && argv[index + 1] !== undefined && !argv[index + 1].startsWith("-")))
      ) {
        expectOptionValue = true;
      }
      index += 1;
      continue;
    }

    bareTokenCount += 1;
    // node/script are skipped above; first bare token is the pilot subcommand.
    // The second bare token starts positionals (e.g. create-session <command> [args...]).
    if (bareTokenCount >= 2) {
      normalized.push(...argv.slice(index));
      break;
    }

    normalized.push(token);
    index += 1;
  }

  return normalized;
}

export async function main(
  argv: string[] = process.argv,
  options: { terminalPilotRuntime?: TerminalPilotRuntime; packageVersion?: string } = {}
): Promise<void> {
  if (isTerminalPilotDaemonArgv(argv)) {
    await runTerminalPilotDaemon();
    return;
  }

  const originalArgv = process.argv;
  process.argv = normalizeArgv(argv);

  try {
    const packageVersion = options.packageVersion ?? getBundledPackageVersion();
    await runCLI(createTerminalPilotGroup(), {
      services: {
        terminalPilotRuntime: options.terminalPilotRuntime ?? createDaemonTerminalPilotRuntime()
      },
      controls: {
        debug: true,
        output: true,
        verbose: true,
        yes: true
      },
      ...(packageVersion === undefined ? {} : { version: packageVersion })
    });
  } finally {
    process.argv = originalArgv;
  }
}

async function isDirectExecution(argv: string[]): Promise<boolean> {
  const entryPoint = argv[1];

  if (typeof entryPoint !== "string" || entryPoint.length === 0) {
    return false;
  }

  try {
    const modulePath = fileURLToPath(import.meta.url);
    const [resolvedEntryPoint, resolvedModulePath] = await Promise.all([
      realpath(path.resolve(entryPoint)),
      realpath(modulePath)
    ]);

    return resolvedEntryPoint === resolvedModulePath;
  } catch {
    return false;
  }
}

if (await isDirectExecution(process.argv)) {
  await main();
}
