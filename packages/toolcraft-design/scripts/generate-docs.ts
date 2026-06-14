#!/usr/bin/env tsx
/**
 * Generates design language documentation for terminal, markdown, and JSON formats.
 * Run from root: npm run generate:design-docs
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { assertSafeOutputDirectory } from "../../../scripts/guard-package-dist.mjs";
import { parse } from "shell-quote";

const ROOT_DIR = path.resolve(import.meta.dirname, "../../..");
const SCREENSHOTS_DIR = path.join(ROOT_DIR, "docs/design-language");
const demoScriptPath = path.join(import.meta.dirname, "demo.ts");
const demoBatchScriptPath = path.join(import.meta.dirname, "capture-demo-batch.ts");
const OUTPUT_DOCS = {
  terminal: path.join(ROOT_DIR, "docs/DESIGN_LANGUAGE.md"),
  markdown: path.join(ROOT_DIR, "docs/DESIGN_LANGUAGE_MARKDOWN.md"),
  json: path.join(ROOT_DIR, "docs/DESIGN_LANGUAGE_JSON.md")
} as const;

type OutputMode = keyof typeof OUTPUT_DOCS;
type GeneratorMode = OutputMode | "all";

type DesignElement = {
  name: string;
  description: string;
  codeSnippet: string;
  demoArgs: string;
};

type Section = {
  title: string;
  description: string;
  elements: DesignElement[];
};

const textDocConfig = {
  markdown: {
    title: "# Design Language Markdown",
    summary: "Text reference for poe-code CLI design elements rendered in markdown mode.",
    command: "generate:design-docs:markdown",
    fenceLanguage: "markdown",
    formatDescription:
      "Each example below shows the plain text markdown output captured with `OUTPUT_FORMAT=markdown`."
  },
  json: {
    title: "# Design Language JSON",
    summary: "Text reference for poe-code CLI design elements rendered in JSON mode.",
    command: "generate:design-docs:json",
    fenceLanguage: "json",
    formatDescription:
      "Each example below shows the NDJSON output captured with `OUTPUT_FORMAT=json`."
  }
} as const;

export const sections: Section[] = [
  {
    title: "Overview",
    description:
      "The `toolcraft-design` package provides a consistent visual language for poe-code CLI output. Import components from the package:",
    elements: []
  },
  {
    title: "Design Tokens",
    description:
      "Foundational design values that ensure consistency across the CLI. Tokens define colors, spacing, typography, and layout widths.",
    elements: []
  },
  {
    title: "Theme Palettes",
    description:
      "Color palettes that adapt to dark and light terminal themes. The system auto-detects the theme from environment variables (POE_CODE_THEME, APPLE_INTERFACE_STYLE, VSCODE_COLOR_THEME_KIND, COLORFGBG).",
    elements: []
  },
  {
    title: "Layout Patterns",
    description:
      "Standard command layout patterns. These show complete UI flows from start to finish.",
    elements: [
      {
        name: "layout-basic",
        description:
          "Core layout: intro banner, info messages, resolved prompts, success message",
        codeSnippet: `import { intro, outro, log, symbols } from "toolcraft-design";

intro("Configure");
log.message("Configuring...", { symbol: symbols.info });
log.message("Provider\\n   claude", { symbol: symbols.resolved });
log.message("API Key\\n   poe-abc...xyz", { symbol: symbols.resolved });
outro("Configuration complete.");`,
        demoArgs: `layout`
      },
      {
        name: "layout-expanded",
        description:
          "Full layout with note and outro: intro, resolved prompts, success, note box, outro",
        codeSnippet: `import { intro, outro, note, log, symbols } from "toolcraft-design";

intro("configure claude-code");
log.message("Claude Code default model\\n   Claude-Opus-4.6", { symbol: symbols.resolved });
log.message("Configured Claude Code.", { symbol: symbols.success });
note("If using VSCode...\\nvscode://settings/...", "Next steps.");
outro("Problems? https://...");`,
        demoArgs: `layout-expanded`
      }
    ]
  },
  {
    title: "Text Styles",
    description:
      "Semantic text styling functions for consistent CLI output. Import from `toolcraft-design`.",
    elements: [
      {
        name: "intro",
        description: "Prominent introductory banners with brand background",
        codeSnippet: `import { text } from "toolcraft-design";
text.intro("Configure")`,
        demoArgs: `intro "Configure"`
      },
      {
        name: "heading",
        description: "Section headings with brand accent color",
        codeSnippet: `import { text } from "toolcraft-design";
text.heading("Available Commands")`,
        demoArgs: `heading "Available Commands"`
      },
      {
        name: "section",
        description: "Bold text for subsection labels",
        codeSnippet: `import { text } from "toolcraft-design";
text.section("Options:")`,
        demoArgs: `section "Options:"`
      },
      {
        name: "command",
        description: "CLI command names in accent color",
        codeSnippet: `import { text } from "toolcraft-design";
text.command("poe-code configure")`,
        demoArgs: `command "poe-code configure"`
      },
      {
        name: "argument",
        description: "Command arguments (dimmed)",
        codeSnippet: `import { text } from "toolcraft-design";
text.argument("<provider>")`,
        demoArgs: `argument "<provider>"`
      },
      {
        name: "option",
        description: "CLI flags and options in yellow",
        codeSnippet: `import { text } from "toolcraft-design";
text.option("--dry-run")`,
        demoArgs: `option "--dry-run"`
      },
      {
        name: "example",
        description: "Example text (dimmed)",
        codeSnippet: `import { text } from "toolcraft-design";
text.example("$ poe-code configure claude")`,
        demoArgs: `example "$ poe-code configure claude"`
      },
      {
        name: "usageCommand",
        description: "Commands in usage examples (green)",
        codeSnippet: `import { text } from "toolcraft-design";
text.usageCommand("npm install -g poe-code")`,
        demoArgs: `usageCommand "npm install -g poe-code"`
      },
      {
        name: "link",
        description: "Hyperlinks and references",
        codeSnippet: `import { text } from "toolcraft-design";
text.link("https://poe.com")`,
        demoArgs: `link "https://poe.com"`
      },
      {
        name: "muted",
        description: "De-emphasized text",
        codeSnippet: `import { text } from "toolcraft-design";
text.muted("(optional)")`,
        demoArgs: `muted "(optional)"`
      }
    ]
  },
  {
    title: "Symbols",
    description:
      "Status indicators and visual markers. Use with `log.message()` for structured output.",
    elements: [
      {
        name: "info",
        description: "Information indicator (magenta dot)",
        codeSnippet: `import { log, symbols } from "toolcraft-design";
log.message("Configuring claude-code...", { symbol: symbols.info });`,
        demoArgs: `symbol info`
      },
      {
        name: "success",
        description: "Success indicator (magenta diamond)",
        codeSnippet: `import { log, symbols } from "toolcraft-design";
log.message("Configuration complete!", { symbol: symbols.success });`,
        demoArgs: `symbol success`
      },
      {
        name: "resolved",
        description: "Resolved/completed indicator (hollow diamond)",
        codeSnippet: `import { log, symbols } from "toolcraft-design";
log.message("API Key\\n   poe-abc...xyz", { symbol: symbols.resolved });`,
        demoArgs: `symbol resolved`
      },
      {
        name: "errorResolved",
        description: "Error with details indicator (red square)",
        codeSnippet: `import { log, symbols } from "toolcraft-design";
log.message("Config Failed\\n   Missing API key", { symbol: symbols.errorResolved });`,
        demoArgs: `symbol errorResolved`
      }
    ]
  },
  {
    title: "Log Messages",
    description:
      "Structured logging with appropriate visual weight. Import `log` from the prompts module.",
    elements: [
      {
        name: "log-info",
        description: "Informational messages during operations",
        codeSnippet: `import { log, symbols } from "toolcraft-design";
log.message("Configuring claude-code...", { symbol: symbols.info });`,
        demoArgs: `log info`
      },
      {
        name: "log-success",
        description: "Success confirmation messages",
        codeSnippet: `import { log, symbols } from "toolcraft-design";
log.message("Configuration complete!", { symbol: symbols.success });`,
        demoArgs: `log success`
      },
      {
        name: "log-warn",
        description: "Warning messages for non-critical issues",
        codeSnippet: `import { log } from "toolcraft-design";
log.warn("API key expires in 7 days");`,
        demoArgs: `log warn`
      },
      {
        name: "log-error",
        description: "Error messages for failures",
        codeSnippet: `import { log } from "toolcraft-design";
log.error("Failed to write config file");`,
        demoArgs: `log error`
      }
    ]
  },
  {
    title: "Prompts",
    description:
      "Interactive prompts for user input. Import from `toolcraft-design`.",
    elements: [
      {
        name: "prompt-intro",
        description: "Command intro banner with animation",
        codeSnippet: `import { intro } from "toolcraft-design";
intro("Configure");`,
        demoArgs: `intro "Configure"`
      },
      {
        name: "prompt-note",
        description: "Boxed note for next steps or important info",
        codeSnippet: `import { note } from "toolcraft-design";
note("Run poe-code test", "Next steps.");`,
        demoArgs: `note`
      },
      {
        name: "prompt-outro",
        description: "Command outro with feedback link",
        codeSnippet: `import { outro } from "toolcraft-design";
outro("Problems? https://...");`,
        demoArgs: `outro`
      },
      {
        name: "prompt-resolved",
        description: "Resolved prompt value display",
        codeSnippet: `import { log, symbols } from "toolcraft-design";
log.message("API Key\\n   poe-abc...xyz", { symbol: symbols.resolved });`,
        demoArgs: `resolved`
      },
      {
        name: "prompt-errorResolved",
        description: "Error with details display",
        codeSnippet: `import { log, symbols } from "toolcraft-design";
log.message("Config Failed\\n   Missing API key", { symbol: symbols.errorResolved });`,
        demoArgs: `errorResolved`
      },
      {
        name: "menu",
        description: "Interactive select prompt for choosing options",
        codeSnippet: `import { select } from "toolcraft-design";
const choice = await select({
  message: "Pick an agent:",
  options: [
    { value: "claude-code", label: "Claude Code" },
    { value: "codex", label: "Codex CLI" }
  ]
});`,
        demoArgs: `menu`
      }
    ]
  },
  {
    title: "Static Rendering",
    description:
      "Utilities for rendering UI elements as static strings (for screenshots, tests, or non-interactive output).",
    elements: [
      {
        name: "spinner-dots",
        description: "Animated dots spinner for async operations",
        codeSnippet: `import { spinner } from "toolcraft-design";
const s = spinner();
s.start("Configuring...");
await doWork();
s.stop("Done!");`,
        demoArgs: `spinner dots`
      },
      {
        name: "spinner-timer",
        description: "Timer spinner showing elapsed time",
        codeSnippet: `import { renderSpinnerFrame, renderSpinnerStopped } from "toolcraft-design";
const frame = renderSpinnerFrame({ message: "Processing...", timer: "1s" });
const stopped = renderSpinnerStopped({ message: "Complete!", timer: "2s" });`,
        demoArgs: `spinner timer`
      },
      {
        name: "table",
        description: "Styled terminal table with themed borders and column alignment",
        codeSnippet: `import { renderTable, getTheme } from "toolcraft-design";

const output = renderTable({
  theme: getTheme(),
  columns: [
    { name: "Model", title: "Model", alignment: "left", maxLen: 30 },
    { name: "Context", title: "Context", alignment: "right", maxLen: 9 },
  ],
  rows: [
    { Model: "anthropic/claude-sonnet-4", Context: "200K" },
  ],
});`,
        demoArgs: `table`
      },
      {
        name: "diff",
        description: "Unified diff display for file changes (used in --dry-run)",
        codeSnippet: `import { color, log } from "toolcraft-design";
const diffLines = [
  color.gray("--- config.json"),
  color.red('-  "model": "gpt-4",'),
  color.green('+  "model": "claude-sonnet-4",')
];
log.message(diffLines.join("\\n"), { symbol: color.yellow("~") });`,
        demoArgs: `diff`
      }
    ]
  },
  {
    title: "Dashboard",
    description:
      "Full-screen interactive terminal dashboard with output pane, stats pane, and keyboard navigation. Used for monitoring long-running agent sessions.",
    elements: [
      {
        name: "dashboard",
        description:
          "Two-pane dashboard layout with scrollable output on the left, live stats on the right, and keyboard hints in the footer",
        codeSnippet: `import { createDashboard } from "toolcraft-design";

const dashboard = createDashboard({
  title: "Agent Output",
  statsTitle: "Stats"
});

dashboard.start();
dashboard.appendOutput({ kind: "info", text: "Analyzing repository state", ts: Date.now() });
dashboard.updateStats({ status: "running", iterations: 5, tokensIn: 685, tokensOut: 445, elapsedMs: 5000 });`,
        demoArgs: `dashboard`
      }
    ]
  },
  {
    title: "Terminal Markdown",
    description:
      "Reference demos for the terminal markdown renderer, covering both the full showcase and a minimal validation sample.",
    elements: [
      {
        name: "terminal-markdown",
        description:
          "Full markdown renderer showcase with headings, lists, tables, blockquotes, alerts, links, and footnotes.",
        codeSnippet: `import { renderMarkdown } from "toolcraft-design";

const markdown = [
  "# Design System Markdown",
  "",
  "Paragraph with **bold** text and a [docs link](https://example.com/docs).",
  "",
  "- unordered item",
  "1. ordered item"
].join("\\n");

process.stdout.write(renderMarkdown(markdown));`,
        demoArgs: `markdown`
      },
      {
        name: "terminal-markdown-minimal",
        description:
          "Compact markdown renderer sample for quick validation of headings, prose, and fenced code blocks.",
        codeSnippet: `import { renderMarkdown } from "toolcraft-design";

const markdown = [
  "# Markdown Minimal",
  "",
  "Quick validation",
  "",
  "\`\`\`js",
  'console.log("demo");',
  "\`\`\`"
].join("\\n");

process.stdout.write(renderMarkdown(markdown));`,
        demoArgs: `markdown-minimal`
      }
    ]
  }
];

function screenshotPath(name: string): string {
  return path.join(SCREENSHOTS_DIR, `${name}.png`);
}

function runScreenshot(name: string, demoArgs: string): void {
  const outputPath = screenshotPath(name);
  const cmd = `npm run screenshot -- --no-header -o ${outputPath} npm run demo -w toolcraft-design -- ${demoArgs}`;
  console.log(`Generating screenshot: ${name}`);
  execSync(cmd, { cwd: ROOT_DIR, stdio: "inherit" });
}

export function captureTextOutput(
  demoArgs: string,
  format: Extract<OutputMode, "markdown" | "json">
): string {
  const result = execSync(
    `"${process.execPath}" --import tsx "${demoScriptPath}" ${demoArgs}`,
    {
      cwd: ROOT_DIR,
      env: { ...process.env, OUTPUT_FORMAT: format }
    }
  );

  return result.toString();
}

export function captureTextOutputs(
  requests: Array<{
    demoArgs: string;
    format: Extract<OutputMode, "markdown" | "json">;
  }>
): string[] {
  const payload = requests.map(({ demoArgs, format }) => ({
    args: parse(demoArgs).filter((arg): arg is string => typeof arg === "string"),
    format
  }));
  const result = execFileSync(process.execPath, ["--import", "tsx", demoBatchScriptPath, JSON.stringify(payload)], {
    cwd: ROOT_DIR,
    env: process.env
  });

  return JSON.parse(result.toString()) as string[];
}

function renderSharedIntro(
  title: string,
  summary: string,
  regenerateCommand: string,
  extraParagraph?: string
): string[] {
  const lines: string[] = [
    title,
    "",
    summary,
    "",
    `This document is auto-generated. Run \`npm run ${regenerateCommand}\` to regenerate.`,
    "",
    "## Package Overview",
    "",
    "The `toolcraft-design` package provides consistent visual styling for the poe-code CLI.",
    "",
    "```typescript",
    "// Import components",
    'import { text, symbols, intro, outro, log } from "toolcraft-design";',
    "",
    "// Import tokens for advanced customization",
    'import { brand, dark, light, spacing, typography, widths } from "toolcraft-design";',
    "```",
    "",
    "## Design Tokens",
    "",
    "Foundational values that ensure consistency:",
    "",
    "| Token | Value | Description |",
    "|-------|-------|-------------|",
    "| `brand` | `#a200ff` | Primary brand color (Poe purple) |",
    "| `spacing.sm` | `1` | Small spacing unit |",
    "| `spacing.md` | `2` | Medium spacing unit |",
    "| `spacing.lg` | `4` | Large spacing unit |",
    "| `widths.header` | `60` | Header line width |",
    "| `widths.helpColumn` | `24` | Help text column width |",
    "| `widths.maxLine` | `80` | Maximum line width |",
    "",
    "## Theme Palettes",
    "",
    "The design system supports dark and light themes, auto-detected from environment:",
    "",
    "```typescript",
    'import { getTheme, resolveThemeName } from "toolcraft-design";',
    "",
    "const themeName = resolveThemeName(); // 'dark' or 'light'",
    "const palette = getTheme();",
    "console.log(palette.header('Title'));",
    "```",
    "",
    "**Environment variables checked (in order):**",
    "- `POE_CODE_THEME` - explicit override ('dark' or 'light')",
    "- `APPLE_INTERFACE_STYLE` - macOS appearance",
    "- `VSCODE_COLOR_THEME_KIND` - VS Code theme",
    "- `COLORFGBG` - terminal color hint"
  ];

  if (extraParagraph) {
    lines.push("");
    lines.push(extraParagraph);
  }

  lines.push("");
  return lines;
}

export function renderTerminalDocument(): string {
  const lines = renderSharedIntro(
    "# Design Language",
    "Visual reference for poe-code CLI design elements.",
    "generate:design-docs"
  );

  for (const section of sections) {
    if (section.elements.length === 0) {
      continue;
    }

    lines.push(`## ${section.title}`);
    lines.push("");
    lines.push(section.description);
    lines.push("");

    for (const element of section.elements) {
      lines.push(`### ${element.name}`);
      lines.push("");
      lines.push(element.description);
      lines.push("");
      lines.push("```typescript");
      lines.push(element.codeSnippet);
      lines.push("```");
      lines.push("");
      lines.push(`![${element.name}](design-language/${element.name}.png)`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function renderTextDocument(
  format: Extract<OutputMode, "markdown" | "json">,
  capture?: (
    demoArgs: string,
    currentFormat: Extract<OutputMode, "markdown" | "json">
  ) => string
): string {
  const config = textDocConfig[format];
  const elements = sections.flatMap((section) => section.elements);
  const capturedOutputs =
    capture === undefined
      ? captureTextOutputs(elements.map((element) => ({ demoArgs: element.demoArgs, format })))
      : undefined;
  let capturedOutputIndex = 0;
  const lines = renderSharedIntro(
    config.title,
    config.summary,
    config.command,
    config.formatDescription
  );

  for (const section of sections) {
    if (section.elements.length === 0) {
      continue;
    }

    lines.push(`## ${section.title}`);
    lines.push("");
    lines.push(section.description);
    lines.push("");

    for (const element of section.elements) {
      lines.push(`### ${element.name}`);
      lines.push("");
      lines.push(element.description);
      lines.push("");
      lines.push("```typescript");
      lines.push(element.codeSnippet);
      lines.push("```");
      lines.push("");
      lines.push(`\`\`\`${config.fenceLanguage}`);
      const output =
        capturedOutputs === undefined
          ? capture!(element.demoArgs, format)
          : capturedOutputs[capturedOutputIndex++] ?? "";
      lines.push(output.trimEnd());
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function generateTerminalArtifacts(): Promise<void> {
  rmSync(SCREENSHOTS_DIR, { recursive: true, force: true });
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  for (const section of sections) {
    for (const element of section.elements) {
      runScreenshot(element.name, element.demoArgs);
    }
  }

  await assertSafeOutputDirectory(ROOT_DIR, OUTPUT_DOCS.terminal);
  writeFileSync(OUTPUT_DOCS.terminal, renderTerminalDocument());
  console.log(`Generated: ${OUTPUT_DOCS.terminal}`);
}

async function generateTextArtifacts(format: Extract<OutputMode, "markdown" | "json">): Promise<void> {
  await assertSafeOutputDirectory(ROOT_DIR, OUTPUT_DOCS[format]);
  writeFileSync(OUTPUT_DOCS[format], renderTextDocument(format));
  console.log(`Generated: ${OUTPUT_DOCS[format]}`);
}

function parseMode(argv: string[]): GeneratorMode {
  const mode = argv[2] as GeneratorMode | undefined;

  if (!mode) {
    return "terminal";
  }

  if (mode === "terminal" || mode === "markdown" || mode === "json" || mode === "all") {
    return mode;
  }

  throw new Error(
    `Unknown mode: ${mode}. Expected one of: terminal, markdown, json, all.`
  );
}

export async function main(argv = process.argv): Promise<void> {
  const mode = parseMode(argv);

  if (mode === "terminal" || mode === "all") {
    await generateTerminalArtifacts();
  }

  if (mode === "markdown" || mode === "all") {
    await generateTextArtifacts("markdown");
  }

  if (mode === "json" || mode === "all") {
    await generateTextArtifacts("json");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
