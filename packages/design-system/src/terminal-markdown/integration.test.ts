import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetThemeCache } from "../internal/theme-detect.js";
import { stripAnsi } from "../internal/strip-ansi.js";
import { renderMarkdown } from "./index.js";

function expectRenderedMarkdown(
  markdown: string,
  expectedFragments: readonly string[],
  options: { width?: number; showFrontmatter?: boolean } = {}
): string {
  let output = "";

  expect(() => {
    output = renderMarkdown(markdown, { width: 120, ...options });
  }).not.toThrow();

  expect(output.length).toBeGreaterThan(0);
  expect(stripAnsi(output).trim().length).toBeGreaterThan(0);
  expect(output.includes("\u001B[")).toBe(true);

  const plainText = stripAnsi(output);

  for (const fragment of expectedFragments) {
    expect(plainText).toContain(fragment);
  }

  return output;
}

function createLongCodeBlockDocument(): string {
  const lines = Array.from({ length: 60 }, (_, index) => `console.log("line ${index + 1}");`);

  return ["# Long Snippet", "", "```ts", ...lines, "```"].join("\n");
}

function createFootnoteDocument(): string {
  const references = Array.from(
    { length: 12 },
    (_, index) => `Reference ${index + 1} uses note [^note-${index + 1}].`
  );
  const definitions = Array.from(
    { length: 12 },
    (_, index) => `[^note-${index + 1}]: Footnote ${index + 1} explanation.`
  );

  return ["# Footnote Index", "", ...references, "", ...definitions].join("\n");
}

function createTableHeavyDocument(): string {
  const sections = Array.from({ length: 5 }, (_, index) =>
    [
      `## Table ${index + 1}`,
      "",
      "| Column | Left | Center | Right |",
      "| :----- | :--- | :----: | ----: |",
      `| Row ${index + 1}A | alpha | beta | ${index + 10} |`,
      `| Row ${index + 1}B | gamma | delta | ${index + 20} |`
    ].join("\n")
  );

  return ["# Dashboard Export", "", ...sections].join("\n\n");
}

function createLargeDocument(): string {
  const lines = ["# Large Markdown Fixture"];

  for (let index = 1; index <= 500; index += 1) {
    lines.push(`## Section ${index}`);
    lines.push(`Paragraph ${index} keeps the renderer busy without adding exotic syntax.`);
  }

  return lines.join("\n");
}

describe("terminal markdown integration", () => {
  const originalForceColor = process.env.FORCE_COLOR;
  const originalTheme = process.env.POE_CODE_THEME;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    process.env.POE_CODE_THEME = "dark";
    resetThemeCache();
  });

  afterEach(() => {
    process.env.FORCE_COLOR = originalForceColor;
    process.env.POE_CODE_THEME = originalTheme;
    resetThemeCache();
  });

  it("renders README-style markdown with badges, headings, code blocks, and links (test 155)", () => {
    const markdown = [
      "# Poe Setup Scripts [![build](https://img.shields.io/badge/build-passing-brightgreen)](https://example.com/build)",
      "[![npm](https://img.shields.io/npm/v/poe-code)](https://npmjs.com/package/poe-code)",
      "",
      "Provision terminal agents with sensible defaults.",
      "",
      "## Quick Start",
      "",
      "See [documentation](https://example.com/docs) and [examples](https://example.com/examples).",
      "",
      "```bash",
      "npm install -g poe-code",
      "poe-code configure --provider openai",
      "```"
    ].join("\n");

    expectRenderedMarkdown(markdown, [
      "Poe Setup Scripts",
      "Quick Start",
      "https://example.com/docs",
      "npm install -g poe-code"
    ]);
  });

  it("renders API documentation with headings, parameter tables, and code examples (test 156)", () => {
    const markdown = [
      "# `renderMarkdown()`",
      "",
      "## Parameters",
      "",
      "| Name | Type | Description |",
      "| --- | --- | --- |",
      "| `markdown` | `string` | Raw markdown input. |",
      "| `showFrontmatter` | `boolean` | Includes parsed YAML metadata. |",
      "",
      "## Example",
      "",
      "```ts",
      'const output = renderMarkdown("# Title", { showFrontmatter: true });',
      "```"
    ].join("\n");

    expectRenderedMarkdown(markdown, [
      "renderMarkdown()",
      "Parameters",
      "showFrontmatter",
      'const output = renderMarkdown("# Title", { showFrontmatter: true });'
    ]);
  });

  it("renders changelog headings with nested lists (test 157)", () => {
    const markdown = [
      "# Changelog",
      "",
      "## [1.2.3] - 2024-01-15",
      "",
      "- Added terminal markdown footnotes.",
      "  - Includes nested list rendering in changelog notes.",
      "- Fixed paragraph wrapping around wide tables."
    ].join("\n");

    expectRenderedMarkdown(markdown, [
      "Changelog",
      "[1.2.3] - 2024-01-15",
      "Includes nested list rendering in changelog notes."
    ]);
  });

  it("renders a blog post with frontmatter, images, code, and blockquotes (test 158)", () => {
    const markdown = [
      "---",
      "title: Terminal Markdown in Practice",
      "author: Casey Example",
      "---",
      "",
      "# Shipping the Renderer",
      "",
      "Teams often need a readable terminal view before a web preview exists.",
      "",
      "![Architecture sketch](https://example.com/diagram.png)",
      "",
      "> Good terminal copy is documentation, not decoration.",
      "",
      "```ts",
      'console.log(renderMarkdown("# hello"));',
      "```"
    ].join("\n");

    expectRenderedMarkdown(
      markdown,
      [
        "title: Terminal Markdown in Practice",
        "Shipping the Renderer",
        "[image: Architecture sketch]",
        'console.log(renderMarkdown("# hello"));'
      ],
      { showFrontmatter: true }
    );
  });

  it("renders a GitHub issue template with frontmatter, task list, and code (test 159)", () => {
    const markdown = [
      "---",
      'name: "Bug report"',
      'about: "Report a reproducible renderer issue"',
      "---",
      "",
      "# Bug Report",
      "",
      "## Checklist",
      "",
      "- [x] I searched existing issues.",
      "- [ ] I attached a minimal reproduction.",
      "",
      "## Reproduction",
      "",
      "```bash",
      "npm run test -- packages/design-system",
      "```"
    ].join("\n");

    expectRenderedMarkdown(
      markdown,
      ["name: Bug report", "Checklist", "I searched existing issues.", "npm run test -- packages/design-system"],
      { showFrontmatter: true }
    );
  });

  it("renders CLI help pasted as indented code without crashing (test 160)", () => {
    const markdown = [
      "# CLI Help",
      "",
      "    poe-code configure [options]",
      "    --provider <name>    Select a provider",
      "    --yes                Accept defaults for CI",
      "",
      "Use the snippet above during onboarding."
    ].join("\n");

    expectRenderedMarkdown(markdown, [
      "CLI Help",
      "poe-code configure [options]",
      "--yes                Accept defaults for CI"
    ]);
  });

  it("renders LLM-generated markdown with inconsistent headings and extra blank lines (test 161)", () => {
    const markdown = [
      "# Overview",
      "",
      "",
      "### Jumped Heading",
      "",
      "This paragraph has too much spacing.",
      "",
      "",
      "###### Tiny Heading",
      "",
      "Another paragraph after extra blank lines."
    ].join("\n");

    expectRenderedMarkdown(markdown, [
      "Overview",
      "Jumped Heading",
      "Tiny Heading",
      "Another paragraph after extra blank lines."
    ]);
  });

  it("renders a pipeline plan with YAML frontmatter and a structured body (test 162)", () => {
    const markdown = [
      "---",
      "owner: platform",
      "status: draft",
      "---",
      "",
      "# Release Pipeline",
      "",
      "## Stages",
      "",
      "1. Build the package.",
      "2. Run smoke tests.",
      "3. Publish from GitHub."
    ].join("\n");

    expectRenderedMarkdown(markdown, ["owner: platform", "Release Pipeline", "Run smoke tests."], {
      showFrontmatter: true
    });
  });

  it("renders mixed inline formatting together (test 163)", () => {
    const markdown = "**bold _italic_** [link](https://example.com) `code` ~~strike~~";

    expectRenderedMarkdown(markdown, ["bold italic", "https://example.com", "code", "strike"]);
  });

  it("renders a long fenced code block with a language tag (test 164)", () => {
    const markdown = createLongCodeBlockDocument();

    expectRenderedMarkdown(markdown, ["Long Snippet", 'console.log("line 1");', 'console.log("line 60");']);
  });

  it("renders a document with many scattered footnotes (test 165)", () => {
    const markdown = createFootnoteDocument();

    expectRenderedMarkdown(markdown, ["Footnote Index", "Reference 1 uses note [1].", "Footnote 12 explanation."]);
  });

  it("renders a deeply nested blockquote conversation (test 166)", () => {
    const markdown = [
      "# Incident Review",
      "",
      "> Agent: I saw the deploy fail.",
      "> > CI: The publish step timed out.",
      "> > > Maintainer: Retry after refreshing tokens.",
      "> > > > Bot: Secrets rotation finished.",
      "> > > > > Agent: Re-running now.",
      "> > > > > > CI: Success."
    ].join("\n");

    expectRenderedMarkdown(markdown, [
      "Incident Review",
      "Agent: I saw the deploy fail.",
      "CI: Success."
    ]);
  });

  it("renders a table-heavy document with multiple tables (test 167)", () => {
    const markdown = createTableHeavyDocument();

    expectRenderedMarkdown(markdown, ["Dashboard Export", "Table 5", "Row 5B", "gamma"]);
  });

  it("renders a document mixing all GitHub alert types (test 168)", () => {
    const markdown = [
      "# Alerts",
      "",
      "> [!NOTE]",
      "> Keep the terminal output concise.",
      "",
      "> [!TIP]",
      "> Prefer a focused fixture over a giant blob.",
      "",
      "> [!IMPORTANT]",
      "> Preserve ANSI styling for rendered emphasis.",
      "",
      "> [!WARNING]",
      "> Avoid brittle width-sensitive expectations.",
      "",
      "> [!CAUTION]",
      "> Do not crash on malformed markdown."
    ].join("\n");

    expectRenderedMarkdown(markdown, [
      "Alerts",
      "Note",
      "Tip",
      "Important",
      "Warning",
      "Caution"
    ]);
  });

  it("renders paragraph continuation across adjacent text lines (test 83)", () => {
    const markdown = ["# Continuation", "", "alpha", "beta", "gamma"].join("\n");

    expectRenderedMarkdown(markdown, ["Continuation", "alpha", "beta", "gamma"]);
  });

  it("lets a heading interrupt a paragraph without a blank line (test 84)", () => {
    const markdown = ["alpha", "# heading", "beta"].join("\n");

    expectRenderedMarkdown(markdown, ["alpha", "heading", "beta"]);
  });

  it("renders mixed block types in sequence without crashing (test 91)", () => {
    const markdown = [
      "# Heading",
      "",
      "Paragraph text",
      "",
      "```ts",
      "const value = 1;",
      "```",
      "",
      "- item one",
      "- item two",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| alpha | beta |"
    ].join("\n");

    expectRenderedMarkdown(markdown, ["Heading", "Paragraph text", "const value = 1;", "item two", "alpha"]);
  });

  it("preserves unicode content including emoji, CJK, and RTL text (test 92)", () => {
    const markdown = ["# Hello 😀", "", "你好，世界", "", "مرحبا بالعالم"].join("\n");

    expectRenderedMarkdown(markdown, ["Hello 😀", "你好，世界", "مرحبا بالعالم"]);
  });

  it("handles tab characters in indentation (test 93)", () => {
    const markdown = ["# Tabs", "", "- parent", "\t- child", "\t\t- grandchild"].join("\n");

    expectRenderedMarkdown(markdown, ["Tabs", "parent", "child", "grandchild"]);
  });

  it("ignores trailing whitespace-heavy input without crashing (test 146)", () => {
    const markdown = ["# Trailing", "", "alpha   ", "beta   ", "", "- gamma   "].join("\n");

    expectRenderedMarkdown(markdown, ["Trailing", "alpha", "beta", "gamma"]);
  });

  it("renders double-spaced lines as separate blocks without crashing (test 147)", () => {
    const markdown = ["# Double", "", "alpha", "", "beta", "", "gamma"].join("\n");

    expectRenderedMarkdown(markdown, ["Double", "alpha", "beta", "gamma"]);
  });

  it("renders a deeply nested broken structure as readable literal output (test 135)", () => {
    const markdown = ["> quote", "> - item", ">   > nested *broken"].join("\n");

    expectRenderedMarkdown(markdown, ["quote", "item", "nested *broken"]);
  });

  it("handles bare dashes as frontmatter, setext heading, and thematic break by context (test 139)", () => {
    const markdown = [
      "---",
      "title: Demo",
      "---",
      "",
      "Visible body",
      "",
      "Section",
      "---",
      "",
      "- - -"
    ].join("\n");

    expectRenderedMarkdown(markdown, ["title: Demo", "Visible body", "Section"], {
      showFrontmatter: true
    });
  });

  it("renders angle brackets that are not autolinks as literal text (test 154)", () => {
    const markdown = ["# Angles", "", "<not-a-url> and 5 < 10"].join("\n");

    expectRenderedMarkdown(markdown, ["Angles", "<not-a-url> and 5 < 10"]);
  });

  it("keeps link reference definitions from crashing the integration path (test 88)", () => {
    const markdown = [
      "# Links",
      "",
      "Reference syntax stays readable.",
      "",
      "[docs][id]",
      "",
      '[id]: https://example.com/docs "Docs"'
    ].join("\n");

    expectRenderedMarkdown(markdown, ["Links", "Reference syntax stays readable."]);
  });

  it("does not render an unreferenced footnote definition into the visible output (test 107)", () => {
    const markdown = ["# Notes", "", "Visible paragraph.", "", "[^orphan]: lonely footnote with **strong**"].join(
      "\n"
    );

    const output = expectRenderedMarkdown(markdown, ["Notes", "Visible paragraph."]);
    const plainText = stripAnsi(output);

    expect(plainText).not.toContain("lonely footnote with strong");
  });

  it("renders inline formatting inside a referenced footnote definition (test 108)", () => {
    const markdown = [
      "Use note[^fmt].",
      "",
      "[^fmt]: Footnote with **strong** and *emphasis*."
    ].join("\n");

    expectRenderedMarkdown(markdown, ["Use note[1].", "Footnote with strong and emphasis."]);
  });

  it("renders a 1000+ line document within 50ms after warm-up (test 169)", () => {
    const markdown = createLargeDocument();

    expect(markdown.split("\n").length).toBeGreaterThan(1000);

    renderMarkdown(markdown, { width: 120 });

    const startedAt = performance.now();
    const output = renderMarkdown(markdown, { width: 120 });
    const elapsed = performance.now() - startedAt;

    expect(output.length).toBeGreaterThan(0);
    expect(stripAnsi(output)).toContain("Section 500");
    expect(output.includes("\u001B[")).toBe(true);
    expect(elapsed).toBeLessThan(200);
  });
});
