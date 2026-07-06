#!/usr/bin/env tsx
/**
 * Expanded layout: intro → resolved prompts → success → note → outro
 */
import { color, intro, note, outro, log, symbols } from "../src/index.js";

export function render(): void {
  intro("configure claude-code");
  log.message("Claude Code default model\n   <model-id>", {
    symbol: symbols.resolved
  });
  log.success("Configured Claude Code.");
  note(
    "If using VSCode - Open the Disable Login Prompt setting and check the box.\nvscode://settings/claudeCode.disableLoginPrompt",
    "Next steps."
  );
  outro(color.dim("Problems? https://github.com/poe-platform/poe-code/issues"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  render();
}
