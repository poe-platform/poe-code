#!/usr/bin/env tsx
/**
 * Menu layout: simulating a select/menu prompt
 */
import { color, symbols } from "../src/index.js";

export function render(): void {
  const selected = color.magenta("●");
  const unselected = color.dim("○");
  const bar = color.gray(symbols.bar);

  process.stdout.write(`${color.magenta("◆")}  Pick an agent to configure:\n`);
  process.stdout.write(`${bar}  ${selected} ${color.hex("#ff6b35").bold("Claude Code")}\n`);
  process.stdout.write(`${bar}  ${unselected} ${color.hex("#10a37f").bold("Codex CLI")}\n`);
  process.stdout.write(`${bar}  ${unselected} Aider\n`);
  process.stdout.write(`${color.gray("└")}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  render();
}
