#!/usr/bin/env tsx
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const SCREENSHOTS_DIR = "docs/design-language";
const OUTPUT_MD = "docs/DESIGN_LANGUAGE.md";

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
  {
    title: "Text Styles",
    description: "Core text styling functions for consistent CLI output.",
    elements: [
      {
        name: "intro",
        description: "Prominent introductory banners with brand background",
        codeSnippet: `design.text.intro("Configure")`,
        demoArgs: `intro "Configure"`
      },
      {
        name: "heading",
        description: "Section headings with brand accent color",
        codeSnippet: `design.text.heading("Available Commands")`,
        demoArgs: `heading "Available Commands"`
      },
      {
        name: "section",
        description: "Bold text for subsection labels",
        codeSnippet: `design.text.section("Options:")`,
        demoArgs: `section "Options:"`
      },
      {
        name: "command",
        description: "CLI command names in accent color",
        codeSnippet: `design.text.command("poe-code configure")`,
        demoArgs: `command "poe-code configure"`
      },
      {
        name: "argument",
        description: "Command arguments (dimmed)",
        codeSnippet: `design.text.argument("<provider>")`,
        demoArgs: `argument "<provider>"`
      },
      {
        name: "option",
        description: "CLI flags and options in yellow",
        codeSnippet: `design.text.option("--dry-run")`,
        demoArgs: `option "--dry-run"`
      },
      {
        name: "example",
        description: "Example text (dimmed)",
        codeSnippet: `design.text.example("$ poe-code configure claude")`,
        demoArgs: `example "$ poe-code configure claude"`
      },
      {
        name: "usageCommand",
        description: "Commands in usage examples (green)",
        codeSnippet: `design.text.usageCommand("npm install -g poe-code")`,
        demoArgs: `usageCommand "npm install -g poe-code"`
      },
      {
        name: "link",
        description: "Hyperlinks and references",
        codeSnippet: `design.text.link("https://poe.com")`,
        demoArgs: `link "https://poe.com"`
      },
      {
        name: "muted",
        description: "De-emphasized text",
        codeSnippet: `design.text.muted("(optional)")`,
        demoArgs: `muted "(optional)"`
      }
    ]
  },
  {
    title: "Symbols",
    description: "Status indicators and visual markers.",
    elements: [
      {
        name: "info",
        description: "Information indicator (magenta dot)",
        codeSnippet: `logger.info("Configuring claude-code...")`,
        demoArgs: `symbol info`
      },
      {
        name: "success",
        description: "Success indicator (magenta diamond)",
        codeSnippet: `logger.success("Configuration complete!")`,
        demoArgs: `symbol success`
      },
      {
        name: "resolved",
        description: "Resolved/completed indicator (hollow diamond)",
        codeSnippet: `logger.resolved("API Key", "poe-abc...xyz")`,
        demoArgs: `symbol resolved`
      },
      {
        name: "errorResolved",
        description: "Error with details indicator (red square)",
        codeSnippet: `logger.errorResolved("Config Failed", "Missing API key")`,
        demoArgs: `symbol errorResolved`
      }
    ]
  },
  {
    title: "Log Messages",
    description: "Structured logging with appropriate visual weight.",
    elements: [
      {
        name: "log-info",
        description: "Informational messages during operations",
        codeSnippet: `logger.info("Configuring claude-code...")`,
        demoArgs: `log info`
      },
      {
        name: "log-success",
        description: "Success confirmation messages",
        codeSnippet: `logger.success("Configuration complete!")`,
        demoArgs: `log success`
      },
      {
        name: "log-warn",
        description: "Warning messages for non-critical issues",
        codeSnippet: `logger.warn("API key expires in 7 days")`,
        demoArgs: `log warn`
      },
      {
        name: "log-error",
        description: "Error messages for failures",
        codeSnippet: `logger.error("Failed to write config file")`,
        demoArgs: `log error`
      }
    ]
  },
  {
    title: "Clack Containers",
    description: "Structural UI elements from @clack/prompts.",
    elements: [
      {
        name: "clack-intro",
        description: "Command intro banner with animation",
        codeSnippet: `intro(design.text.intro("Configure"))`,
        demoArgs: `intro "Configure"`
      },
      {
        name: "clack-note",
        description: "Boxed note for next steps or important info",
        codeSnippet: `note("Run poe-code test", "Next steps.")`,
        demoArgs: `note`
      },
      {
        name: "clack-outro",
        description: "Command outro with feedback link",
        codeSnippet: `outro(chalk.dim("Problems? https://..."))`,
        demoArgs: `outro`
      },
      {
        name: "clack-resolved",
        description: "Resolved prompt value display",
        codeSnippet: `logger.resolved("API Key", "poe-abc...xyz")`,
        demoArgs: `resolved`
      },
      {
        name: "clack-errorResolved",
        description: "Error with details display",
        codeSnippet: `logger.errorResolved("Config Failed", "Missing API key")`,
        demoArgs: `errorResolved`
      }
    ]
  },
  {
    title: "Complex Patterns",
    description: "Multi-line UI patterns for rich interactions.",
    elements: [
      {
        name: "diff",
        description: "Unified diff display for file changes (used in --dry-run)",
        codeSnippet: `log.message(diffLines.join("\\n"), { symbol: "~" })`,
        demoArgs: `diff`
      },
      {
        name: "menu",
        description: "Interactive select prompt for choosing options",
        codeSnippet: `select({ message: "Pick an agent:", options: [...] })`,
        demoArgs: `menu`
      }
    ]
  }
];

function screenshotPath(name: string): string {
  return path.posix.join(SCREENSHOTS_DIR, `${name}.png`);
}

function runScreenshot(name: string, demoArgs: string): void {
  const outputPath = screenshotPath(name);
  const cmd = `npm run screenshot -- --no-header -o ${outputPath} tsx scripts/design-demo.ts ${demoArgs}`;
  console.log(`Generating: ${name}`);
  execSync(cmd, { stdio: "inherit" });
}

function generateMarkdown(): string {
  const lines: string[] = [
    "# Design Language",
    "",
    "Visual reference for poe-code CLI design elements.",
    "",
    "This document is auto-generated. Run `npm run generate:design-docs` to regenerate.",
    ""
  ];

  for (const section of sections) {
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
