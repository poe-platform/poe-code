#!/usr/bin/env node
import { runCLI } from "@poe-code/cmdkit/cli";
import { isDirectExecution } from "./direct-execution.js";
import { superintendentGroup } from "./commands/index.js";

function normalizeArgv(argv: string[]): string[] {
  if (argv.length <= 2) {
    return [...argv, "--help"];
  }

  return argv;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const originalArgv = process.argv;
  process.argv = normalizeArgv(argv);

  try {
    await runCLI(superintendentGroup);
  } finally {
    process.argv = originalArgv;
  }
}

if (await isDirectExecution(import.meta.url, process.argv)) {
  await main();
}
