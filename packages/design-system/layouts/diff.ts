#!/usr/bin/env tsx
/**
 * Diff layout: showing file changes
 */
import chalk from "chalk";
import { log } from "@clack/prompts";

function renderSimpleDiff(): string {
  const lines = [
    chalk.gray("--- config.json"),
    chalk.gray("+++ config.json"),
    chalk.gray("@@ -1,3 +1,5 @@"),
    " {",
    chalk.red('-  "model": "gpt-4",'),
    chalk.green('+  "model": "claude-sonnet-4",'),
    '   "temperature": 0.7',
    chalk.green('+  "maxTokens": 4096'),
    " }"
  ];
  return lines.join("\n");
}

export function render(): void {
  log.message(renderSimpleDiff(), { symbol: chalk.yellow("~") });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  render();
}
