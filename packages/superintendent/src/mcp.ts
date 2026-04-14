#!/usr/bin/env node
import { runMCP } from "@poe-code/cmdkit/mcp";
import { isDirectExecution } from "./direct-execution.js";
import { superintendentGroup } from "./commands/index.js";

export async function main(argv: string[] = process.argv): Promise<void> {
  const originalArgv = process.argv;
  process.argv = argv;

  try {
    await runMCP(superintendentGroup, {
      name: "superintendent",
      version: "0.0.1"
    });
  } finally {
    process.argv = originalArgv;
  }
}

if (await isDirectExecution(import.meta.url, process.argv)) {
  await main();
}
