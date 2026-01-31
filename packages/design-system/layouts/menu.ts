#!/usr/bin/env tsx
/**
 * Menu layout: simulating a select/menu prompt
 */
import chalk from "chalk";
import { symbols } from "../src/index.js";

export function render(): void {
  const selected = chalk.magenta("●");
  const unselected = chalk.dim("○");
  const bar = chalk.gray(symbols.bar);

  process.stdout.write(`${chalk.magenta("◆")}  Pick an agent to configure:\n`);
  process.stdout.write(`${bar}  ${selected} ${chalk.hex("#ff6b35").bold("Claude Code")}\n`);
  process.stdout.write(`${bar}  ${unselected} ${chalk.hex("#10a37f").bold("Codex CLI")}\n`);
  process.stdout.write(`${bar}  ${unselected} Aider\n`);
  process.stdout.write(`${chalk.gray("└")}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  render();
}
