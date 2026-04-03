#!/usr/bin/env tsx
/**
 * Demo script for design-system components.
 * Usage: tsx scripts/demo.ts <type> [value...]
 */
import chalk from "chalk";
import process from "node:process";
import {
  intro,
  log,
  note,
  outro,
  text,
  symbols,
  renderSpinnerFrame,
  renderSpinnerStopped,
  renderMenu,
  renderTable,
  getTheme,
  resolveOutputFormat,
  resetOutputFormatCache
} from "../src/index.js";

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
  | "layout-expanded"
  | "table"
  | "table-markdown";

function runTextDemo(style: string, content: string): void {
  const styleFn = text[style as keyof typeof text];
  if (typeof styleFn === "function") {
    const result = styleFn(content);
    const format = resolveOutputFormat();
    if (format === "terminal") {
      log.message(result, { symbol: chalk.gray("│") });
    } else {
      process.stdout.write(result + "\n");
    }
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
      log.info("Configuring claude-code...");
      break;
    case "success":
      log.success("Configuration complete!");
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
  log.message(lines.join("\n"), { symbol: chalk.yellow("~") });
}

function runMenuDemo(): void {
  process.stdout.write(
    renderMenu({
      message: "Pick an agent:",
      options: [
        { value: "claude-code", label: "Claude Code" },
        { value: "codex", label: "Codex CLI" },
        { value: "aider", label: "Aider" }
      ],
      selectedIndex: 0
    }) + "\n"
  );
}

function runIntroDemo(content: string): void {
  intro(content);
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

function setOutputFormat(format: "terminal" | "markdown" | "json"): void {
  resetOutputFormatCache();
  resolveOutputFormat({ OUTPUT_FORMAT: format });
}

function runLayoutDemo(): void {
  intro("Configure");
  log.info("Configuring claude-code...");
  log.message("Provider\n   claude", { symbol: symbols.resolved });
  log.message("API Key\n   poe-abc...xyz", { symbol: symbols.resolved });
  outro("Configuration complete.");
}

function runTableDemo(): void {
  const theme = getTheme();
  const output = renderTable({
    theme,
    columns: [
      { name: "Model", title: "Model", alignment: "left", maxLen: 30 },
      { name: "Context", title: "Context", alignment: "right", maxLen: 9 },
      { name: "Price", title: "$/MTok In/Out", alignment: "right", maxLen: 15 },
    ],
    rows: [
      { Model: "anthropic/claude-sonnet-4", Context: "200K", Price: "$3.00/$15.00" },
      { Model: "openai/gpt-4o", Context: "128K", Price: "$2.50/$10.00" },
      { Model: "google/gemini-2.0-flash", Context: "1M", Price: "$0.10/$0.40" },
    ],
  });
  process.stdout.write(output + "\n");
}

function runTableMarkdownDemo(): void {
  setOutputFormat("markdown");
  const theme = getTheme();
  const md = renderTable({
    theme,
    columns: [
      { name: "Model", title: "Model", alignment: "left", maxLen: 30 },
      { name: "Context", title: "Context", alignment: "right", maxLen: 9 },
      { name: "Price", title: "$/MTok In/Out", alignment: "right", maxLen: 15 },
    ],
    rows: [
      { Model: "anthropic/claude-sonnet-4", Context: "200K", Price: "$3.00/$15.00" },
      { Model: "openai/gpt-4o", Context: "128K", Price: "$2.50/$10.00" },
      { Model: "google/gemini-2.0-flash", Context: "1M", Price: "$0.10/$0.40" },
    ],
  });
  process.stdout.write(md + "\n");
}

function runLayoutExpandedDemo(): void {
  intro("configure claude-code");
  log.message("Claude Code default model\n   Claude-Opus-4.6", {
    symbol: symbols.resolved
  });
  log.success("Configured Claude Code.");
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
    process.stderr.write("Usage: demo <type> [value...]\n");
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
    case "table":
      runTableDemo();
      break;
    case "table-markdown":
      runTableMarkdownDemo();
      break;
    default:
      process.stderr.write(`Unknown demo type: ${type}\n`);
      process.exitCode = 1;
  }
}

main();
