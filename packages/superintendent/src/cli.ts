#!/usr/bin/env node
import { runCLI } from "toolcraft/cli";
import { isDirectExecution } from "./direct-execution.js";
import { superintendentGroup } from "./commands/index.js";

function normalizeArgv(argv: string[]): string[] {
  const normalized = normalizeMarkdownOutput(argv);

  if (normalized.length <= 2) {
    return [...normalized, "--help"];
  }

  return normalized;
}

function normalizeMarkdownOutput(argv: string[]): string[] {
  const normalized: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";

    if (argument === "--output" && argv[index + 1] === "markdown") {
      normalized.push(argument, "md");
      index += 1;
      continue;
    }

    if (argument === "--output=markdown") {
      normalized.push("--output=md");
      continue;
    }

    normalized.push(argument);
  }

  return normalized;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const originalArgv = process.argv;
  process.argv = normalizeArgv(argv);

  try {
    await runCLI(superintendentGroup, {
      controls: {
        debug: true,
        output: true,
        verbose: true,
        yes: true
      }
    });
  } finally {
    process.argv = originalArgv;
  }
}

if (await isDirectExecution(import.meta.url, process.argv)) {
  await main();
}
