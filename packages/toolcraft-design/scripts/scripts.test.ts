import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getMarkdownDemo } from "../src/terminal-markdown/demo-content.js";
import { renderMarkdown } from "../src/index.js";
import {
  loadMarkdownDemoDocument,
  parseMarkdownDemoArgs,
  resolveDemoWorkingDirectory
} from "./demo.js";
import { stripAnsi } from "../src/internal/strip-ansi.js";
import {
  captureTextOutput,
  captureTextOutputs,
  renderTerminalDocument,
  renderTextDocument,
  sections
} from "./generate-docs.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const packageRoot = path.resolve(import.meta.dirname, "..");

describe("design-system demo script", () => {
  it("prefers INIT_CWD so workspace runs can load repo-root markdown files", () => {
    expect(resolveDemoWorkingDirectory({ INIT_CWD: repoRoot }, packageRoot)).toBe(repoRoot);
  });

  it("falls back to the current working directory when INIT_CWD is absent", () => {
    expect(resolveDemoWorkingDirectory({}, packageRoot)).toBe(packageRoot);
  });

  it("loads preset markdown showcase content", () => {
    expect(loadMarkdownDemoDocument({ kind: "preset", name: "default" }, { cwd: packageRoot })).toBe(
      getMarkdownDemo("default")
    );
  });

  it("loads markdown files relative to INIT_CWD for workspace demo runs", () => {
    const expected = readFileSync(path.join(repoRoot, "README.md"), "utf8");

    expect(
      loadMarkdownDemoDocument(
        { kind: "file", filePath: "README.md" },
        { cwd: packageRoot, env: { INIT_CWD: repoRoot } }
      )
    ).toBe(expected);
  });

  it("loads markdown files from absolute paths", () => {
    const readmePath = path.join(repoRoot, "README.md");
    const expected = readFileSync(readmePath, "utf8");

    expect(
      loadMarkdownDemoDocument({ kind: "file", filePath: readmePath }, { cwd: packageRoot })
    ).toBe(expected);
  });

  it("throws a clear error when markdown-file is missing its path", () => {
    expect(() =>
      loadMarkdownDemoDocument({ kind: "file", filePath: "   " }, { cwd: packageRoot })
    ).toThrow("markdown-file requires a markdown file path.");
  });

  it("throws a clear error when the markdown file does not exist", () => {
    expect(() =>
      loadMarkdownDemoDocument(
        { kind: "file", filePath: "docs/does-not-exist.md" },
        { cwd: packageRoot, env: { INIT_CWD: repoRoot } }
      )
    ).toThrow(`Markdown file not found: ${path.join(repoRoot, "docs/does-not-exist.md")}`);
  });

  it("parses markdown render flags alongside positional args", () => {
    expect(parseMarkdownDemoArgs(["docs/plans/archive/cli-aliasing.md", "--show-frontmatter"])).toEqual({
      positional: ["docs/plans/archive/cli-aliasing.md"],
      renderOptions: { showFrontmatter: true }
    });
  });

  it("can render frontmatter from repo markdown files when requested", () => {
    const { positional, renderOptions } = parseMarkdownDemoArgs([
      "--show-frontmatter",
      "docs/plans/archive/cli-aliasing.md"
    ]);
    const markdown = loadMarkdownDemoDocument(
      { kind: "file", filePath: positional.join(" ") },
      { cwd: packageRoot, env: { INIT_CWD: repoRoot } }
    );

    expect(renderMarkdown(markdown, renderOptions)).toContain("status:");
  });
});

describe("generate-docs", () => {
  it("lists the current demo types in the no-argument usage output", () => {
    let output = "";

    try {
      captureTextOutput("", "markdown");
    } catch (error) {
      output = String(error);
    }

    expect(output).toContain("Usage: demo <type> [value...]");
    expect(output).toContain("layout");
    expect(output).toContain("layout-expanded");
    expect(output).toContain("table");
    expect(output).toContain("table-markdown");
    expect(output).toContain("markdown");
    expect(output).toContain("markdown-minimal");
  }, 15_000);

  it("renders markdown docs with fenced markdown output blocks", () => {
    const output = renderTextDocument("markdown", (demoArgs, format) => {
      expect(format).toBe("markdown");
      return `captured ${format}: ${demoArgs}\n`;
    });

    expect(output).toContain("# Design Language Markdown");
    expect(output).toContain(
      "This document is auto-generated. Run `npm run generate:design-docs:markdown` to regenerate."
    );
    expect(output).toContain("```markdown");
    expect(output).toContain("captured markdown: layout");
    expect(output).not.toContain("![layout-basic](design-language/layout-basic.png)");
  });

  it("renders json docs with fenced json output blocks", () => {
    const output = renderTextDocument("json", (demoArgs, format) => {
      expect(format).toBe("json");
      return `{"demo":"${demoArgs}","format":"${format}"}\n`;
    });

    expect(output).toContain("# Design Language JSON");
    expect(output).toContain(
      "This document is auto-generated. Run `npm run generate:design-docs:json` to regenerate."
    );
    expect(output).toContain("```json");
    expect(output).toContain('{"demo":"layout","format":"json"}');
  });

  it("keeps generated text docs aligned with the design elements list", () => {
    const output = renderTextDocument("markdown", () => "demo output\n");
    const elementCount = sections.flatMap((section) => section.elements).length;

    expect(output.match(/^### /gm)).toHaveLength(elementCount);
    expect(output.match(/^```typescript$/gm)).toHaveLength(elementCount + 2);
    expect(output.match(/^```markdown$/gm)).toHaveLength(elementCount);
  });

  it("includes markdown demo entries in generated markdown docs", () => {
    const output = renderTextDocument("markdown", (demoArgs, format) => {
      expect(format).toBe("markdown");
      return `captured ${format}: ${demoArgs}\n`;
    });

    expect(output).toContain("### terminal-markdown");
    expect(output).toContain("captured markdown: markdown");
    expect(output).toContain("### terminal-markdown-minimal");
    expect(output).toContain("captured markdown: markdown-minimal");
  });

  it("includes terminal-markdown screenshot references in the terminal doc", () => {
    const output = renderTerminalDocument();

    expect(output).toContain("### terminal-markdown");
    expect(output).toContain("![terminal-markdown](design-language/terminal-markdown.png)");
    expect(output).toContain("### terminal-markdown-minimal");
    expect(output).toContain(
      "![terminal-markdown-minimal](design-language/terminal-markdown-minimal.png)"
    );
  });

  it("captures format-aware demo output through one executable run", () => {
    const [heading, table, markdown, minimalMarkdown, menu] = captureTextOutputs([
      { demoArgs: 'heading "Available Commands"', format: "markdown" },
      { demoArgs: "table", format: "markdown" },
      { demoArgs: "markdown", format: "markdown" },
      { demoArgs: "markdown-minimal", format: "markdown" },
      { demoArgs: "menu", format: "json" }
    ]);

    expect(heading).toContain("Available Commands");
    expect(heading).not.toContain("> toolcraft-design");
    expect(heading).not.toContain("tsx scripts/demo.ts");
    expect(table).toContain("| Model | Context | $/MTok In/Out |");
    expect(table).not.toContain("┌");
    expect(table).not.toContain("\u001b[");

    const strippedMarkdown = stripAnsi(markdown);
    expect(strippedMarkdown).toContain("Design System Markdown");
    expect(strippedMarkdown).toContain("Overview");
    expect(strippedMarkdown).toContain("Renderer Features");
    expect(strippedMarkdown).toContain("Paragraph with bold, italic, strikethrough, code");
    expect(strippedMarkdown).toContain("span, a docs link");
    expect(strippedMarkdown).toContain('const agent = "poe-code";');
    expect(strippedMarkdown).toContain("| Outer quote");
    expect(strippedMarkdown).toContain("| | Nested quote");
    expect(strippedMarkdown).toContain("• unordered item");
    expect(strippedMarkdown).toContain("1. ordered item");
    expect(strippedMarkdown).toContain("completed task");
    expect(strippedMarkdown).toContain("pending task");
    expect(strippedMarkdown).toContain("| Feature  | Alignment | Status |");
    expect(strippedMarkdown).toContain("docs link");
    expect(strippedMarkdown).toContain("(https://example.com/docs)");
    expect(strippedMarkdown).toContain("[image: System diagram]");
    expect(strippedMarkdown).toContain("| Note");
    expect(strippedMarkdown).toContain("reference[1].");
    expect(strippedMarkdown).toContain("Footnote definition for the markdown demo.");

    const strippedMinimalMarkdown = stripAnsi(minimalMarkdown);
    expect(strippedMinimalMarkdown).toContain("Markdown Minimal");
    expect(strippedMinimalMarkdown).toContain("Quick validation");
    expect(strippedMinimalMarkdown).toContain('console.log("demo");');
    expect(strippedMinimalMarkdown).not.toContain("| Feature |");
    expect(strippedMinimalMarkdown).not.toContain("> Note");
    expect(menu).toContain('"type":"menu"');
    expect(menu).toContain('"message":"Pick an agent:"');
    expect(menu).not.toContain("◆");
  });
});
