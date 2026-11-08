#!/usr/bin/env tsx
/**
 * Diff layout: showing file changes
 */
import { color, log } from "../src/index.js";

function renderSimpleDiff(): string {
  const lines = [
    color.gray("--- config.json"),
    color.gray("+++ config.json"),
    color.gray("@@ -1,3 +1,5 @@"),
    " {",
    color.red('-  "model": "old-model",'),
    color.green('+  "model": "new-model",'),
    '   "temperature": 0.7',
    color.green('+  "maxTokens": 4096'),
    " }"
  ];
  return lines.join("\n");
}

export function render(): void {
  log.message(renderSimpleDiff(), { symbol: color.yellow("~") });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  render();
}
