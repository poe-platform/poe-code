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

function normalizeArgv(argv: string[]): string[] {
  if (
    argv.includes("--json") &&
    !argv.some((argument) => argument === "--output" || argument.startsWith("--output="))
  ) {
    return argv.flatMap((argument) => (argument === "--json" ? ["--output", "json"] : [argument]));
  }

  return argv;
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
