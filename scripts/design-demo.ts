#!/usr/bin/env tsx
import chalk from "chalk";
import process from "node:process";
import { intro, log, note, outro } from "@clack/prompts";
import { text, symbols, renderSpinnerFrame, renderSpinnerStopped } from "@poe-code/design-system";
import { renderUnifiedDiff } from "../src/utils/dry-run.js";

type DemoType =
  | "intro"
  | "heading"
  | "section"
  | "command"
  | "argument"
  | "option"
  | "example"
  | "usageCommand"
  | "link"
  | "muted"
  | "symbol"
  | "log"
  | "diff"
  | "menu"
  | "note"
  | "outro"
  | "resolved"
  | "errorResolved"
  | "spinner"
  | "layout"
  | "layout-expanded";

function runTextDemo(style: string, content: string): void {
  const styleFn = text[style as keyof typeof text];
  if (typeof styleFn === "function") {
    log.message(styleFn(content), { symbol: chalk.gray("│") });
  } else {
    process.stderr.write(`Unknown style: ${style}\n`);
    process.exitCode = 1;
  }
}

function runSymbolDemo(symbolName: string): void {
  const symbol = symbols[symbolName as keyof typeof symbols];
  if (symbol) {
    log.message(symbolName, { symbol: String(symbol) });
  } else {
    process.stderr.write(`Unknown symbol: ${symbolName}\n`);
    process.exitCode = 1;
  }
}

function runLogDemo(level: string): void {
  switch (level) {
    case "info":
      log.message("Configuring claude-code...", { symbol: symbols.info });
      break;
    case "success":
      log.message("Configuration complete!", { symbol: symbols.success });
      break;
    case "warn":
      log.warn("API key expires in 7 days");
      break;
    case "error":
      log.error("Failed to write config file");
      break;
    default:
      process.stderr.write(`Unknown log level: ${level}\n`);
      process.exitCode = 1;
  }
}

function runDiffDemo(): void {
  const before = `{
  "model": "gpt-4",
  "temperature": 0.7
}`;
  const after = `{
  "model": "claude-sonnet-4",
  "temperature": 0.7,
  "maxTokens": 4096
}`;
  const diffLines = renderUnifiedDiff("config.json", before, after);
  log.message(diffLines.join("\n"), { symbol: chalk.yellow("~") });
}

function runMenuDemo(): void {
  const selected = chalk.magenta("●");
  const unselected = chalk.dim("○");
  const bar = chalk.gray("│");

  process.stdout.write(`${chalk.magenta("◆")}  Pick an agent to configure:\n`);
  process.stdout.write(`${bar}  ${selected} ${chalk.hex("#ff6b35").bold("Claude Code")}\n`);
  process.stdout.write(`${bar}  ${unselected} ${chalk.hex("#10a37f").bold("Codex CLI")}\n`);
  process.stdout.write(`${bar}  ${unselected} Aider\n`);
  process.stdout.write(`${chalk.gray("└")}\n`);
}

function runIntroDemo(content: string): void {
  intro(text.intro(content));
}

function runNoteDemo(): void {
  note(
    "Run the following command to test:\n  poe-code test claude-code",
    "Next steps."
  );
}

function runOutroDemo(): void {
  outro(chalk.dim("Problems? https://github.com/poe-platform/poe-code/issues"));
}

function runResolvedDemo(): void {
  log.message("API Key\n   poe-abc...xyz\n   Expires: 2026-12-31", {
    symbol: symbols.resolved
  });
}

function runErrorResolvedDemo(): void {
  log.message(
    "Configuration Failed\n   Missing API key\n   Check your .env file or run poe-code login",
    {
      symbol: symbols.errorResolved
    }
  );
}

function runSpinnerDemo(indicator: "dots" | "timer"): void {
  const timer = indicator === "timer" ? "2s" : undefined;
  const running = renderSpinnerFrame({
    message: "Configuring claude-code...",
    timer: indicator === "timer" ? "1s" : undefined
  });
  process.stdout.write(running + "\n");
  const stopped = renderSpinnerStopped({
    message: "Configuration complete!",
    timer,
    subtext: "claude-code is ready to use"
  });
  process.stdout.write(stopped + "\n");
}

function runLayoutDemo(): void {
  intro(text.intro("Configure"));
  log.message("Configuring claude-code...", { symbol: symbols.info });
  log.message("Provider\n   claude", { symbol: symbols.resolved });
  log.message("API Key\n   poe-abc...xyz", { symbol: symbols.resolved });
  outro("Configuration complete.");
}

function runLayoutExpandedDemo(): void {
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

async function main(): Promise<void> {
  const [type, ...values] = process.argv.slice(2);
  const value = values.join(" ");

  if (!type) {
    process.stderr.write("Usage: design-demo <type> [value...]\n");
    process.stderr.write(
      "Types: intro, heading, section, command, argument, option, example,\n"
    );
    process.stderr.write(
      "       usageCommand, link, muted, symbol, log, diff, menu, note, outro,\n"
    );
    process.stderr.write("       resolved, errorResolved, spinner\n");
    process.exitCode = 1;
    return;
  }

  switch (type as DemoType) {
    case "intro":
      runIntroDemo(value);
      break;
    case "heading":
    case "section":
    case "command":
    case "argument":
    case "option":
    case "example":
    case "usageCommand":
    case "link":
    case "muted":
      runTextDemo(type, value);
      break;
    case "symbol":
      runSymbolDemo(value);
      break;
    case "log":
      runLogDemo(value);
      break;
    case "diff":
      runDiffDemo();
      break;
    case "menu":
      runMenuDemo();
      break;
    case "note":
      runNoteDemo();
      break;
    case "outro":
      runOutroDemo();
      break;
    case "resolved":
      runResolvedDemo();
      break;
    case "errorResolved":
      runErrorResolvedDemo();
      break;
    case "spinner":
      runSpinnerDemo(value as "dots" | "timer");
      break;
    case "layout":
      runLayoutDemo();
      break;
    case "layout-expanded":
      runLayoutExpandedDemo();
      break;
    default:
      process.stderr.write(`Unknown demo type: ${type}\n`);
      process.exitCode = 1;
  }
}

main();
