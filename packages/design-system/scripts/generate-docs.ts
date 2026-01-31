#!/usr/bin/env tsx
/**
 * Generates DESIGN_LANGUAGE.md documentation with screenshots.
 * Run from root: npm run generate:design-docs
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT_DIR = path.resolve(import.meta.dirname, "../../..");
const SCREENSHOTS_DIR = path.join(ROOT_DIR, "docs/design-language");
const OUTPUT_MD = path.join(ROOT_DIR, "docs/DESIGN_LANGUAGE.md");

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

const sections: Section[] = [
  // High-level: Package overview
  {
    title: "Overview",
    description:
      "The `@poe-code/design-system` package provides a consistent visual language for poe-code CLI output. Import components from the package:",
    elements: []
  },
  // Design Tokens
  {
    title: "Design Tokens",
    description:
      "Foundational design values that ensure consistency across the CLI. Tokens define colors, spacing, typography, and layout widths.",
    elements: []
  },
  // Theme Palettes
  {
    title: "Theme Palettes",
    description:
      "Color palettes that adapt to dark and light terminal themes. The system auto-detects the theme from environment variables (POE_CODE_THEME, APPLE_INTERFACE_STYLE, VSCODE_COLOR_THEME_KIND, COLORFGBG).",
    elements: []
  },
  // Layout Patterns
  {
    title: "Layout Patterns",
    description:
      "Standard command layout patterns. These show complete UI flows from start to finish.",
    elements: [
      {
        name: "layout-basic",
        description:
          "Core layout: intro banner, info messages, resolved prompts, success message",
        codeSnippet: `import { intro, outro, log, symbols } from "@poe-code/design-system";

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
        codeSnippet: `import { intro, outro, note, log, symbols } from "@poe-code/design-system";

intro("configure claude-code");
log.message("Claude Code default model\\n   Claude-Opus-4.5", { symbol: symbols.resolved });
log.message("Configured Claude Code.", { symbol: symbols.success });
note("If using VSCode...\\nvscode://settings/...", "Next steps.");
outro("Problems? https://...");`,
        demoArgs: `layout-expanded`
      }
    ]
  },
  // Text Styles
  {
    title: "Text Styles",
    description:
      "Semantic text styling functions for consistent CLI output. Import from `@poe-code/design-system`.",
    elements: [
      {
        name: "intro",
        description: "Prominent introductory banners with brand background",
        codeSnippet: `import { text } from "@poe-code/design-system";
text.intro("Configure")`,
        demoArgs: `intro "Configure"`
      },
      {
        name: "heading",
        description: "Section headings with brand accent color",
        codeSnippet: `import { text } from "@poe-code/design-system";
text.heading("Available Commands")`,
        demoArgs: `heading "Available Commands"`
      },
      {
        name: "section",
        description: "Bold text for subsection labels",
        codeSnippet: `import { text } from "@poe-code/design-system";
text.section("Options:")`,
        demoArgs: `section "Options:"`
      },
      {
        name: "command",
        description: "CLI command names in accent color",
        codeSnippet: `import { text } from "@poe-code/design-system";
text.command("poe-code configure")`,
        demoArgs: `command "poe-code configure"`
      },
      {
        name: "argument",
        description: "Command arguments (dimmed)",
        codeSnippet: `import { text } from "@poe-code/design-system";
text.argument("<provider>")`,
        demoArgs: `argument "<provider>"`
      },
      {
        name: "option",
        description: "CLI flags and options in yellow",
        codeSnippet: `import { text } from "@poe-code/design-system";
text.option("--dry-run")`,
        demoArgs: `option "--dry-run"`
      },
      {
        name: "example",
        description: "Example text (dimmed)",
        codeSnippet: `import { text } from "@poe-code/design-system";
text.example("$ poe-code configure claude")`,
        demoArgs: `example "$ poe-code configure claude"`
      },
      {
        name: "usageCommand",
        description: "Commands in usage examples (green)",
        codeSnippet: `import { text } from "@poe-code/design-system";
text.usageCommand("npm install -g poe-code")`,
        demoArgs: `usageCommand "npm install -g poe-code"`
      },
      {
        name: "link",
        description: "Hyperlinks and references",
        codeSnippet: `import { text } from "@poe-code/design-system";
text.link("https://poe.com")`,
        demoArgs: `link "https://poe.com"`
      },
      {
        name: "muted",
        description: "De-emphasized text",
        codeSnippet: `import { text } from "@poe-code/design-system";
text.muted("(optional)")`,
        demoArgs: `muted "(optional)"`
      }
    ]
  },
  // Symbols
  {
    title: "Symbols",
    description:
      "Status indicators and visual markers. Use with `log.message()` for structured output.",
    elements: [
      {
        name: "info",
        description: "Information indicator (magenta dot)",
        codeSnippet: `import { log, symbols } from "@poe-code/design-system";
log.message("Configuring claude-code...", { symbol: symbols.info });`,
        demoArgs: `symbol info`
      },
      {
        name: "success",
        description: "Success indicator (magenta diamond)",
        codeSnippet: `import { log, symbols } from "@poe-code/design-system";
log.message("Configuration complete!", { symbol: symbols.success });`,
        demoArgs: `symbol success`
      },
      {
        name: "resolved",
        description: "Resolved/completed indicator (hollow diamond)",
        codeSnippet: `import { log, symbols } from "@poe-code/design-system";
log.message("API Key\\n   poe-abc...xyz", { symbol: symbols.resolved });`,
        demoArgs: `symbol resolved`
      },
      {
        name: "errorResolved",
        description: "Error with details indicator (red square)",
        codeSnippet: `import { log, symbols } from "@poe-code/design-system";
log.message("Config Failed\\n   Missing API key", { symbol: symbols.errorResolved });`,
        demoArgs: `symbol errorResolved`
      }
    ]
  },
  // Log Messages
  {
    title: "Log Messages",
    description:
      "Structured logging with appropriate visual weight. Import `log` from the prompts module.",
    elements: [
      {
        name: "log-info",
        description: "Informational messages during operations",
        codeSnippet: `import { log, symbols } from "@poe-code/design-system";
log.message("Configuring claude-code...", { symbol: symbols.info });`,
        demoArgs: `log info`
      },
      {
        name: "log-success",
        description: "Success confirmation messages",
        codeSnippet: `import { log, symbols } from "@poe-code/design-system";
log.message("Configuration complete!", { symbol: symbols.success });`,
        demoArgs: `log success`
      },
      {
        name: "log-warn",
        description: "Warning messages for non-critical issues",
        codeSnippet: `import { log } from "@poe-code/design-system";
log.warn("API key expires in 7 days");`,
        demoArgs: `log warn`
      },
      {
        name: "log-error",
        description: "Error messages for failures",
        codeSnippet: `import { log } from "@poe-code/design-system";
log.error("Failed to write config file");`,
        demoArgs: `log error`
      }
    ]
  },
  // Prompts
  {
    title: "Prompts",
    description:
      "Interactive prompts for user input. Import from `@poe-code/design-system`.",
    elements: [
      {
        name: "prompt-intro",
        description: "Command intro banner with animation",
        codeSnippet: `import { intro } from "@poe-code/design-system";
intro("Configure");`,
        demoArgs: `intro "Configure"`
      },
      {
        name: "prompt-note",
        description: "Boxed note for next steps or important info",
        codeSnippet: `import { note } from "@poe-code/design-system";
note("Run poe-code test", "Next steps.");`,
        demoArgs: `note`
      },
      {
        name: "prompt-outro",
        description: "Command outro with feedback link",
        codeSnippet: `import { outro } from "@poe-code/design-system";
outro("Problems? https://...");`,
        demoArgs: `outro`
      },
      {
        name: "prompt-resolved",
        description: "Resolved prompt value display",
        codeSnippet: `import { log, symbols } from "@poe-code/design-system";
log.message("API Key\\n   poe-abc...xyz", { symbol: symbols.resolved });`,
        demoArgs: `resolved`
      },
      {
        name: "prompt-errorResolved",
        description: "Error with details display",
        codeSnippet: `import { log, symbols } from "@poe-code/design-system";
log.message("Config Failed\\n   Missing API key", { symbol: symbols.errorResolved });`,
        demoArgs: `errorResolved`
      },
      {
        name: "menu",
        description: "Interactive select prompt for choosing options",
        codeSnippet: `import { select } from "@poe-code/design-system";
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
  // Static Rendering
  {
    title: "Static Rendering",
    description:
      "Utilities for rendering UI elements as static strings (for screenshots, tests, or non-interactive output).",
    elements: [
      {
        name: "spinner-dots",
        description: "Animated dots spinner for async operations",
        codeSnippet: `import { spinner } from "@poe-code/design-system";
const s = spinner();
s.start("Configuring...");
await doWork();
s.stop("Done!");`,
        demoArgs: `spinner dots`
      },
      {
        name: "spinner-timer",
        description: "Timer spinner showing elapsed time",
        codeSnippet: `import { renderSpinnerFrame, renderSpinnerStopped } from "@poe-code/design-system";
const frame = renderSpinnerFrame({ message: "Processing...", timer: "1s" });
const stopped = renderSpinnerStopped({ message: "Complete!", timer: "2s" });`,
        demoArgs: `spinner timer`
      },
      {
        name: "diff",
        description: "Unified diff display for file changes (used in --dry-run)",
        codeSnippet: `import { log } from "@poe-code/design-system";
import chalk from "chalk";
const diffLines = [
  chalk.gray("--- config.json"),
  chalk.red('-  "model": "gpt-4",'),
  chalk.green('+  "model": "claude-sonnet-4",')
];
log.message(diffLines.join("\\n"), { symbol: chalk.yellow("~") });`,
        demoArgs: `diff`
      }
    ]
  }
];

function screenshotPath(name: string): string {
  return path.join(SCREENSHOTS_DIR, `${name}.png`);
}

function runScreenshot(name: string, demoArgs: string): void {
  const outputPath = screenshotPath(name);
  const cmd = `npm run screenshot -- --no-header -o ${outputPath} npm run demo -w @poe-code/design-system -- ${demoArgs}`;
  console.log(`Generating: ${name}`);
  execSync(cmd, { cwd: ROOT_DIR, stdio: "inherit" });
}

function generateMarkdown(): string {
  const lines: string[] = [
    "# Design Language",
    "",
    "Visual reference for poe-code CLI design elements.",
    "",
    "This document is auto-generated. Run `npm run generate:design-docs` to regenerate.",
    "",
    "## Package Overview",
    "",
    "The `@poe-code/design-system` package provides consistent visual styling for the poe-code CLI.",
    "",
    "```typescript",
    "// Import components",
    'import { text, symbols, intro, outro, log } from "@poe-code/design-system";',
    "",
    "// Import tokens for advanced customization",
    'import { brand, dark, light, spacing, typography, widths } from "@poe-code/design-system";',
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
    'import { getTheme, resolveThemeName } from "@poe-code/design-system";',
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
    "- `COLORFGBG` - terminal color hint",
    ""
  ];

  for (const section of sections) {
    // Skip sections that are handled above (Overview, Tokens, Themes)
    if (section.elements.length === 0) {
      continue;
    }

    lines.push(`## ${section.title}`);
    lines.push("");
    lines.push(section.description);
    lines.push("");

    for (const el of section.elements) {
      const relativePath = `design-language/${el.name}.png`;
      lines.push(`### ${el.name}`);
      lines.push("");
      lines.push(el.description);
      lines.push("");
      lines.push("```typescript");
      lines.push(el.codeSnippet);
      lines.push("```");
      lines.push("");
      lines.push(`![${el.name}](${relativePath})`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  rmSync(SCREENSHOTS_DIR, { recursive: true, force: true });
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  for (const section of sections) {
    for (const el of section.elements) {
      runScreenshot(el.name, el.demoArgs);
    }
  }

  const markdown = generateMarkdown();
  writeFileSync(OUTPUT_MD, markdown);
  console.log(`\nGenerated: ${OUTPUT_MD}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
