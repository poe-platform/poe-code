#!/usr/bin/env tsx
/**
 * Expanded layout: intro → resolved prompts → success → note → outro
 */
import chalk from "chalk";
import { intro, note, outro, log } from "@clack/prompts";
import { text, symbols } from "../src/index.js";

export function render(): void {
  intro(text.intro("configure claude-code"));
  log.message("Claude Code default model\n   Claude-Opus-4.5", {
    symbol: symbols.resolved
  });
  log.message("Configured Claude Code.", { symbol: symbols.success });
  note(
    "If using VSCode - Open the Disable Login Prompt setting and check the box.\nvscode://settings/claudeCode.disableLoginPrompt",
    "Next steps."
  );
  outro(chalk.dim("Problems? https://github.com/poe-platform/poe-code/issues"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  render();
}
