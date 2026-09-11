#!/usr/bin/env node
import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RunCliOptions } from "./cli-runtime.js";
import {
  createBrokenPipeState,
  createSafeOutputStream,
  withBrokenPipeGuard
} from "./output-stream.js";

export type { ReadMarkdownFile, WriteMarkdownFile, RunCliOptions } from "./cli-runtime.js";

export async function runCli(
  argv: readonly string[],
  options: RunCliOptions = {}
): Promise<number> {
  if (!argv.includes("--help") && !argv.includes("-h")) {
    const runtime = await import("./cli-runtime.js");
    return runtime.runCli(argv, options, createUsage());
  }

  const brokenPipe = createBrokenPipeState();
  const stdout = createSafeOutputStream(options.stdout ?? process.stdout, brokenPipe);
  const stderr = createSafeOutputStream(options.stderr ?? process.stderr, brokenPipe);
  return withBrokenPipeGuard(
    [options.stdout ?? process.stdout, options.stderr ?? process.stderr],
    brokenPipe,
    async () => {
      try {
        stdout.write(`${createUsage()}\n`);
        return 0;
      } catch (error) {
        if (brokenPipe.closed) return 0;
        stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        if (brokenPipe.closed) return 0;
        const { exitCodeForError } = await import("./cli-runtime.js");
        return exitCodeForError(error);
      }
    }
  );
}

function createUsage(): string {
  return [
    "Usage: poe-safe-js [options] <script.md|script.safejs|script.ajs>",
    "       poe-safe-js migrate <checkpoint.json> --from <original.ajs> --inspect",
    "       poe-safe-js migrate <checkpoint.json> --from <original.ajs> --to <continuation.ajs>",
    "                         --plan <migration.json> --output <new-checkpoint.json> [--dry-run]",
    "",
    "Compatibility alias: poe-safejs",
    "",
    "Options:",
    "  --fix                 apply lint fixes before running",
    "  --fs                  register the fs module: a real filesystem, unlike the agent",
    "                        and metric stubs this runner bundles",
    "  --fs-root <path>      directory --fs confines the script to (default: the script's",
    "                        directory)",
    "  --fs-config <path>    configure shared filesystem access from JSON (Node only)",
    "  --mcp-config <path>   register named MCP servers from an explicit JSON config",
    "  --env-config <path>   grant environment reads from an explicit JSON config",
    "  --snapshot <path>     write success/failure state; best-effort snapshot on SIGINT",
    "  --restore <path>      restore from a snapshot before running",
    "  --max-steps <n>       cap interpreter step budget",
    "  --data-size <n>       cap retained sandbox data units",
    "  -h, --help            print this help",
    "",
    "Exit codes:",
    "  0 success",
    "  1 runtime, usage, file, or restore error",
    "  2 parse error",
    "  3 budget exceeded",
    "  130 interrupted by SIGINT"
  ].join("\n");
}


async function isDirectExecution(entryPoint: string | undefined): Promise<boolean> {
  if (typeof entryPoint !== "string" || entryPoint.length === 0) {
    return false;
  }

  try {
    const [resolvedEntryPoint, resolvedModule] = await Promise.all([
      realpath(path.resolve(entryPoint)),
      realpath(fileURLToPath(import.meta.url))
    ]);
    return resolvedEntryPoint === resolvedModule;
  } catch {
    return false;
  }
}

if (await isDirectExecution(process.argv[1])) {
  process.exitCode = await runCli(process.argv.slice(2));
}
