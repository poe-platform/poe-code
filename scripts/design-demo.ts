#!/usr/bin/env tsx
import chalk from "chalk";
import process from "node:process";
import { intro, log, note, outro } from "@clack/prompts";
import { createCliDesignLanguage } from "../src/cli/ui/design-language.js";
import { renderUnifiedDiff } from "../src/utils/dry-run.js";
import type { CliEnvironment } from "../src/cli/environment.js";

const env: CliEnvironment = {
  getVariable: (name: string) => process.env[name]
};

const design = createCliDesignLanguage(env);

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
  | "errorResolved";

function runTextDemo(style: string, text: string): void {
  const styleFn = design.text[style as keyof typeof design.text];
  if (typeof styleFn === "function") {
    log.message(styleFn(text), { symbol: chalk.gray("│") });
  } else {
    process.stderr.write(`Unknown style: ${style}\n`);
    process.exitCode = 1;
  }
}

function runSymbolDemo(symbolName: string): void {
  const symbol = design.symbols[symbolName as keyof typeof design.symbols];
  if (symbol) {
    log.message(symbolName, { symbol });
  } else {
    process.stderr.write(`Unknown symbol: ${symbolName}\n`);
    process.exitCode = 1;
  }
}

function runLogDemo(level: string): void {
  switch (level) {
    case "info":
      log.message("Configuring claude-code...", { symbol: design.symbols.info });
      break;
    case "success":
      log.message("Configuration complete!", { symbol: design.symbols.success });
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
  // Simulate Clack select appearance
  const selected = chalk.magenta("●");
  const unselected = chalk.dim("○");
  const bar = chalk.gray("│");

  process.stdout.write(`${chalk.magenta("◆")}  Pick an agent to configure:\n`);
  process.stdout.write(`${bar}  ${selected} ${chalk.hex("#ff6b35").bold("Claude Code")}\n`);
  process.stdout.write(`${bar}  ${unselected} ${chalk.hex("#10a37f").bold("Codex CLI")}\n`);
  process.stdout.write(`${bar}  ${unselected} Aider\n`);
  process.stdout.write(`${chalk.gray("└")}\n`);
}

function runIntroDemo(text: string): void {
  intro(design.text.intro(text));
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
    symbol: design.symbols.resolved
  });
}

function runErrorResolvedDemo(): void {
  log.message(
    "Configuration Failed\n   Missing API key\n   Check your .env file or run poe-code login",
    {
      symbol: design.symbols.errorResolved
    }
  );
}

function main(): void {
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
    process.stderr.write("       resolved, errorResolved\n");
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
    default:
      process.stderr.write(`Unknown demo type: ${type}\n`);
      process.exitCode = 1;
  }
}

main();
