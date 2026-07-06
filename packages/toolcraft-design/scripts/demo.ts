#!/usr/bin/env tsx
/**
 * Demo script for design-system components.
 * Usage: tsx scripts/demo.ts <type> [value...]
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  color,
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
  renderMarkdown,
  type RenderOptions,
  getTheme,
  resolveOutputFormat,
  resetOutputFormatCache,
  dashboard
} from "../src/index.js";
import { getMarkdownDemo, type MarkdownDemoName } from "../src/terminal-markdown/demo-content.js";

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
  | "table-markdown"
  | "dashboard"
  | "markdown"
  | "markdown-minimal"
  | "markdown-blocks"
  | "markdown-file";

type MarkdownDemoSource =
  | { kind: "preset"; name?: MarkdownDemoName }
  | { kind: "file"; filePath: string };

type DemoContext = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

type ParsedMarkdownDemoArgs = {
  positional: string[];
  renderOptions: RenderOptions;
};

function runTextDemo(style: string, content: string): void {
  const styleFn = text[style as keyof typeof text];
  if (typeof styleFn === "function") {
    const result = styleFn(content);
    const format = resolveOutputFormat();
    if (format === "terminal") {
      log.message(result, { symbol: color.gray("│") });
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
  log.message(lines.join("\n"), { symbol: color.yellow("~") });
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
  note("Run the following command to test:\n  poe-code test claude-code", "Next steps.");
}

function runOutroDemo(): void {
  outro(color.dim("Problems? https://github.com/poe-platform/poe-code/issues"));
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
      { name: "Price", title: "$/MTok In/Out", alignment: "right", maxLen: 15 }
    ],
    rows: [
      { Model: "<model-id>", Context: "<context>", Price: "<input>/<output>" },
      { Model: "<model-id>", Context: "<context>", Price: "<input>/<output>" },
      { Model: "<model-id>", Context: "<context>", Price: "<input>/<output>" }
    ]
  });
  process.stdout.write(output + "\n");
}

function runDashboardDemo(): void {
  process.stdout.write(dashboard.renderDashboardSnapshot() + "\n");
}

function runTableMarkdownDemo(): void {
  resetOutputFormatCache();
  resolveOutputFormat({ OUTPUT_FORMAT: "markdown" });
  const theme = getTheme();
  const md = renderTable({
    theme,
    columns: [
      { name: "Model", title: "Model", alignment: "left", maxLen: 30 },
      { name: "Context", title: "Context", alignment: "right", maxLen: 9 },
      { name: "Price", title: "$/MTok In/Out", alignment: "right", maxLen: 15 }
    ],
    rows: [
      { Model: "<model-id>", Context: "<context>", Price: "<input>/<output>" },
      { Model: "<model-id>", Context: "<context>", Price: "<input>/<output>" },
      { Model: "<model-id>", Context: "<context>", Price: "<input>/<output>" }
    ]
  });
  process.stdout.write(md + "\n");
}

function runLayoutExpandedDemo(): void {
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

export function resolveDemoWorkingDirectory(env: NodeJS.ProcessEnv, cwd: string): string {
  const initCwd = env.INIT_CWD?.trim();
  if (initCwd) {
    return path.resolve(initCwd);
  }
  return cwd;
}

function resolveMarkdownFilePath(filePath: string, context: DemoContext): string {
  const normalizedPath = filePath.trim();
  if (!normalizedPath) {
    throw new Error("markdown-file requires a markdown file path.");
  }

  if (path.isAbsolute(normalizedPath)) {
    return normalizedPath;
  }

  const cwd = context.cwd ?? process.cwd();
  const env = context.env ?? process.env;
  const workingDirectory = resolveDemoWorkingDirectory(env, cwd);

  return path.resolve(workingDirectory, normalizedPath);
}

export function loadMarkdownDemoDocument(source: MarkdownDemoSource, context: DemoContext = {}): string {
  if (source.kind === "preset") {
    return getMarkdownDemo(source.name);
  }

  const resolvedPath = resolveMarkdownFilePath(source.filePath, context);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Markdown file not found: ${resolvedPath}`);
  }

  return readFileSync(resolvedPath, "utf8");
}

export function parseMarkdownDemoArgs(args: string[]): ParsedMarkdownDemoArgs {
  const positional: string[] = [];
  let showFrontmatter = false;

  for (const arg of args) {
    if (arg === "--show-frontmatter") {
      showFrontmatter = true;
      continue;
    }

    positional.push(arg);
  }

  return {
    positional,
    renderOptions: showFrontmatter ? { showFrontmatter: true } : {}
  };
}

function runMarkdownDemo(
  source: MarkdownDemoSource,
  renderOptions: RenderOptions,
  context: DemoContext
): void {
  process.stdout.write(renderMarkdown(loadMarkdownDemoDocument(source, context), renderOptions));
}

export async function main(argv = process.argv.slice(2), context: DemoContext = {}): Promise<void> {
  const [type, ...values] = argv;
  const value = values.join(" ");

  if (!type) {
    process.stderr.write("Usage: demo <type> [value...]\n");
    process.stderr.write("Types: intro, heading, section, command, argument, option, example,\n");
    process.stderr.write(
      "       usageCommand, link, muted, symbol, log, diff, menu, note, outro,\n"
    );
    process.stderr.write("       resolved, errorResolved, spinner, layout, layout-expanded,\n");
    process.stderr.write(
      "       table, table-markdown, dashboard, markdown, markdown-minimal, markdown-blocks, markdown-file\n"
    );
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
    case "dashboard":
      runDashboardDemo();
      break;
    case "markdown": {
      const { renderOptions } = parseMarkdownDemoArgs(values);
      runMarkdownDemo({ kind: "preset" }, renderOptions, context);
      break;
    }
    case "markdown-minimal": {
      const { renderOptions } = parseMarkdownDemoArgs(values);
      runMarkdownDemo({ kind: "preset", name: "minimal" }, renderOptions, context);
      break;
    }
    case "markdown-blocks": {
      const { positional, renderOptions } = parseMarkdownDemoArgs(values);
      runMarkdownDemo(
        {
          kind: "preset",
          name: (positional[0] as MarkdownDemoName | undefined) ?? "code-blocks"
        },
        renderOptions,
        context
      );
      break;
    }
    case "markdown-file": {
      const { positional, renderOptions } = parseMarkdownDemoArgs(values);
      runMarkdownDemo({ kind: "file", filePath: positional.join(" ") }, renderOptions, context);
      break;
    }
    default:
      process.stderr.write(`Unknown demo type: ${type}\n`);
      process.exitCode = 1;
  }
}

const entry = process.argv[1];
const isMain =
  typeof entry === "string" &&
  path.resolve(entry) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
