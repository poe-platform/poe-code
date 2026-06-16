import path from "node:path";
import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { symbols } from "../components/symbols.js";
import { stripAnsi } from "../internal/strip-ansi.js";
import { resetThemeCache, getTheme } from "../internal/theme-detect.js";
import { typography } from "../tokens/typography.js";
import { getMarkdownDemo } from "./demo-content.js";
import { parse, render, renderMarkdown, type MdNode } from "./index.js";
import { parseBlocks } from "./parser/block.js";
import { extractFrontmatter } from "./parser/frontmatter.js";
import { parseInline } from "./parser/inline.js";

const execFileAsync = promisify(execFile);
const LARGE_DOCUMENT_RENDER_BUDGET_MS = process.env.CI === "true" ? 500 : 200;

describe("terminal markdown demo content", () => {
  it("returns the default markdown demo", () => {
    expect(getMarkdownDemo()).toContain("# Design System Markdown");
  });

  it("returns the minimal markdown demo", () => {
    expect(getMarkdownDemo("minimal")).toBe(
      [
        "# Markdown Minimal",
        "",
        "Quick validation paragraph.",
        "",
        "```ts",
        'console.log("demo");',
        "```"
      ].join("\n")
    );
  });

  it("returns a focused code block demo", () => {
    const markdown = getMarkdownDemo("code-blocks");

    expect(markdown).toContain("```ts");
    expect(markdown).toContain('const sample = "**still literal**";');
    expect(markdown).toContain("  return value + 1;");
  });

  it("returns a focused blockquote demo", () => {
    const markdown = getMarkdownDemo("blockquotes");

    expect(markdown).toContain("> Outer quote");
    expect(markdown).toContain("> > Nested quote");
    expect(markdown).toContain("> > > Deep quote");
  });

  it("returns a focused lists demo", () => {
    const markdown = getMarkdownDemo("lists");

    expect(markdown).toContain("- unordered item");
    expect(markdown).toContain("1. ordered item");
    expect(markdown).toContain("- [x] completed task");
    expect(markdown).toContain("  - nested item");
  });

  it("returns a focused tables demo", () => {
    const markdown = getMarkdownDemo("tables");

    expect(markdown).toContain("| Column | Left | Center | Right |");
    expect(markdown).toContain("| :----- | :--- | :----: | ----: |");
    expect(markdown).toContain("| Alignment | alpha | beta | 42 |");
    expect(markdown).toContain("| Separators | left | mid | 9000 |");
  });

  it("returns a focused alerts demo", () => {
    const markdown = getMarkdownDemo("alerts");

    expect(markdown).toContain("> [!NOTE]");
    expect(markdown).toContain("> [!TIP]");
    expect(markdown).toContain("> [!IMPORTANT]");
    expect(markdown).toContain("> [!WARNING]");
    expect(markdown).toContain("> [!CAUTION]");
    expect(markdown).toContain("> Wrapped content stays aligned beneath the bar.");
  });
});

describe("terminal markdown entrypoint", () => {
  it("renders markdown via the combined helper", () => {
    expect(renderMarkdown("Body")).toBe(render(parse("Body").ast));
  });

  it("returns frontmatter metadata and prepends a frontmatter node to the AST", () => {
    const parsed = parse(["---", "title: Demo", "draft: false", "---", "", "Body"].join("\n"));

    expect(parsed.frontmatter).toEqual({ title: "Demo", draft: false });
    expect(parsed.ast).toMatchObject({
      type: "root",
      children: [
        { type: "frontmatter", data: { title: "Demo", draft: false } },
        { type: "paragraph" }
      ]
    });
  });

  it("passes render options through the helper", () => {
    const markdown = ["---", "title: Demo", "---", "", "alpha beta gamma"].join("\n");
    const options = { width: 10, showFrontmatter: true } as const;

    expect(renderMarkdown(markdown, options)).toBe(render(parse(markdown).ast, options));
  });

  it("rejects a non-finite render width", () => {
    expect(() =>
      render(
        {
          type: "root",
          children: [{ type: "paragraph", children: [{ type: "text", value: "hello" }] }]
        },
        { width: Number.NaN }
      )
    ).toThrow("width must be a positive finite number");
  });

  it("renders cyclic frontmatter without throwing", () => {
    const metadata: { self?: unknown } = {};
    metadata.self = metadata;

    expect(
      stripAnsi(
        render(
          {
            type: "root",
            children: [{ type: "frontmatter", data: { metadata } }]
          },
          { showFrontmatter: true }
        )
      )
    ).toContain('metadata: {"self":"[Circular]"}');
  });

  it("renders malformed markdown inputs as readable literal output without crashing", () => {
    expect(() => renderMarkdown("```js\nconst x = 1;\nno closing fence")).not.toThrow();
    expect(stripAnsi(renderMarkdown("```js\nconst x = 1;\nno closing fence"))).toContain(
      " const x = 1;\n no closing fence\n"
    );

    expect(stripAnsi(renderMarkdown("This has *unclosed emphasis and **unclosed strong"))).toBe(
      "This has *unclosed emphasis and **unclosed strong\n\n"
    );

    expect(stripAnsi(renderMarkdown("[broken link(no close paren"))).toBe(
      "[broken link(no close paren\n\n"
    );
  });

  it("returns empty output for empty or whitespace-only documents", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("   \n\n  \n")).toBe("");
  });

  it("preserves unicode content and nested blockquote prefixes", () => {
    const unicodeOutput = stripAnsi(
      renderMarkdown("# 你好世界 🌍\n\nParagraph with émojis 🎉 and ñ")
    );
    expect(unicodeOutput).toContain("你好世界 🌍\n");
    expect(unicodeOutput).toContain("Paragraph with émojis 🎉 and ñ\n\n");

    expect(stripAnsi(renderMarkdown("> > > > deeply nested\n> > > > blockquote"))).toBe(
      `${symbols.bar} ${symbols.bar} ${symbols.bar} ${symbols.bar} deeply nested\n${symbols.bar} ${symbols.bar} ${symbols.bar} ${symbols.bar} blockquote\n\n`
    );
  });

  it("strips ANSI control sequences from markdown input before rendering", () => {
    const clearOutput = renderMarkdown("before \u001b[2Jafter");
    const redOutput = renderMarkdown("normal \u001b[31mred\u001b[0m text");

    expect(clearOutput).not.toContain("\u001b[2J");
    expect(redOutput).not.toContain("\u001b[31m");
    expect(stripAnsi(clearOutput)).toBe("before after\n\n");
    expect(stripAnsi(redOutput)).toBe("normal red text\n\n");
  });

  it("wraps markdown by terminal cells without splitting grapheme clusters", () => {
    expect(
      stripAnsi(renderMarkdown("abcd efgh", { width: 4 }))
        .trimEnd()
        .split("\n")
    ).toEqual(["abcd", "efgh"]);
    expect(
      stripAnsi(renderMarkdown("你好世界", { width: 4 }))
        .trimEnd()
        .split("\n")
    ).toEqual(["你好", "世界"]);
    expect(
      stripAnsi(renderMarkdown("😀", { width: 1 }))
        .trimEnd()
        .split("\n")
    ).toEqual(["😀"]);
  });

  it("renders long fenced code blocks completely", () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`);
    const markdown = ["```txt", ...lines, "```"].join("\n");
    const output = stripAnsi(renderMarkdown(markdown));

    expect(output).toContain(" line 1\n");
    expect(output).toContain(" line 100\n");
  });
});

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
  const originalThemeAlias = process.env.POE_THEME;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    process.env.POE_CODE_THEME = "dark";
    delete process.env.POE_THEME;
    resetThemeCache();
  });

  afterEach(() => {
    process.env.FORCE_COLOR = originalForceColor;
    if (originalTheme === undefined) {
      delete process.env.POE_CODE_THEME;
    } else {
      process.env.POE_CODE_THEME = originalTheme;
    }
    if (originalThemeAlias === undefined) {
      delete process.env.POE_THEME;
    } else {
      process.env.POE_THEME = originalThemeAlias;
    }
    resetThemeCache();
  });

  it("switches renderer palettes when POE_THEME changes and the theme cache is reset", () => {
    const markdown = ["# Theme", "", "`code`", "", "> [!WARNING]", "> Pay attention"].join("\n");

    process.env.POE_CODE_THEME = "light";
    delete process.env.POE_THEME;
    resetThemeCache();
    const canonicalLightOutput = renderMarkdown(markdown);

    delete process.env.POE_CODE_THEME;
    process.env.POE_THEME = "light";
    resetThemeCache();
    const aliasLightOutput = renderMarkdown(markdown);

    expect(aliasLightOutput).toBe(canonicalLightOutput);
    expect(stripAnsi(aliasLightOutput)).toContain("Pay attention");
    expect(aliasLightOutput.includes("\u001B[")).toBe(true);
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
      "npm run test -- packages/toolcraft-design",
      "```"
    ].join("\n");

    expectRenderedMarkdown(
      markdown,
      [
        "name: Bug report",
        "Checklist",
        "I searched existing issues.",
        "npm run test -- packages/toolcraft-design"
      ],
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

    expectRenderedMarkdown(markdown, [
      "Long Snippet",
      'console.log("line 1");',
      'console.log("line 60");'
    ]);
  });

  it("renders a document with many scattered footnotes (test 165)", () => {
    const markdown = createFootnoteDocument();

    expectRenderedMarkdown(markdown, [
      "Footnote Index",
      "Reference 1 uses note [1].",
      "Footnote 12 explanation."
    ]);
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

    expectRenderedMarkdown(markdown, ["Alerts", "Note", "Tip", "Important", "Warning", "Caution"]);
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

    expectRenderedMarkdown(markdown, [
      "Heading",
      "Paragraph text",
      "const value = 1;",
      "item two",
      "alpha"
    ]);
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
    const markdown = [
      "# Notes",
      "",
      "Visible paragraph.",
      "",
      "[^orphan]: lonely footnote with **strong**"
    ].join("\n");

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

  it("renders a 1000+ line document within the performance budget after warm-up (test 169)", () => {
    const markdown = createLargeDocument();

    expect(markdown.split("\n").length).toBeGreaterThan(1000);

    renderMarkdown(markdown, { width: 120 });
    renderMarkdown(markdown, { width: 120 });

    const measurements: number[] = [];
    let output = "";
    for (let index = 0; index < 3; index += 1) {
      const startedAt = performance.now();
      output = renderMarkdown(markdown, { width: 120 });
      measurements.push(performance.now() - startedAt);
    }
    const elapsed = Math.min(...measurements);

    expect(output.length).toBeGreaterThan(0);
    expect(stripAnsi(output)).toContain("Section 500");
    expect(output.includes("\u001B[")).toBe(true);
    expect(elapsed).toBeLessThan(LARGE_DOCUMENT_RENDER_BUDGET_MS);
  });
});

describe("terminal markdown theme validation", () => {
  const fixturePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "testing",
    "theme-render-fixture.ts"
  );

  it("dark and light themes render readable, visually distinct ANSI output", async () => {
    const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", fixturePath], {
      cwd: process.cwd(),
      env: { ...process.env }
    });

    expect(stdout).toContain("THEMES_VALIDATED");
    expect(stdout).toContain("Dark Theme");
    expect(stdout).toContain("Light Theme");
  });
});

type NodeOf<TType extends MdNode["type"]> = Extract<MdNode, { type: TType }>;

function createTableCell(value: string): MdNode {
  return {
    type: "tableCell",
    children: value.length === 0 ? [] : [{ type: "text", value }]
  };
}

function createTableRow(...values: string[]): MdNode {
  return {
    type: "tableRow",
    children: values.map((value) => createTableCell(value))
  };
}

describe("MdNode", () => {
  it("matches the planned discriminated union", () => {
    expectTypeOf<NodeOf<"heading">["depth"]>().toEqualTypeOf<1 | 2 | 3 | 4 | 5 | 6>();
    expectTypeOf<NodeOf<"list">>().toMatchTypeOf<{
      type: "list";
      ordered: boolean;
      start?: number;
      children: MdNode[];
    }>();
    expectTypeOf<NodeOf<"alert">["kind"]>().toEqualTypeOf<
      "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION"
    >();
    expectTypeOf<NodeOf<"frontmatter">["data"]>().toEqualTypeOf<Record<string, unknown>>();

    const textNode: MdNode = { type: "text", value: "text" };
    const paragraphNode: MdNode = { type: "paragraph", children: [textNode] };
    const tableCellNode: MdNode = { type: "tableCell", children: [textNode] };
    const tableRowNode: MdNode = { type: "tableRow", children: [tableCellNode] };
    const listItemNode: NodeOf<"listItem"> = { type: "listItem", children: [paragraphNode] };

    const nodes: MdNode[] = [
      { type: "root", children: [paragraphNode] },
      { type: "heading", depth: 1, children: [textNode] },
      { type: "heading", depth: 6, children: [textNode] },
      paragraphNode,
      { type: "blockquote", children: [paragraphNode] },
      { type: "code", value: "plain block" },
      { type: "code", lang: "ts", meta: "title=example.ts", value: "const x = 1" },
      { type: "list", ordered: false, children: [listItemNode] },
      { type: "list", ordered: true, start: 3, children: [listItemNode] },
      listItemNode,
      { type: "listItem", checked: false, children: [paragraphNode] },
      { type: "listItem", checked: true, children: [paragraphNode] },
      { type: "thematicBreak" },
      { type: "table", align: ["left", "center", "right", null], children: [tableRowNode] },
      tableRowNode,
      tableCellNode,
      { type: "html", value: "<div>html</div>" },
      textNode,
      { type: "emphasis", children: [textNode] },
      { type: "strong", children: [textNode] },
      { type: "strikethrough", children: [textNode] },
      { type: "inlineCode", value: "inline()" },
      { type: "link", url: "/relative", children: [textNode] },
      { type: "link", url: "https://example.com", title: "Example", children: [textNode] },
      { type: "image", url: "https://example.com/image.png", alt: "Example image" },
      { type: "image", url: "https://example.com/image.png", alt: "Example image", title: "Image" },
      { type: "break" },
      { type: "frontmatter", data: {} },
      { type: "frontmatter", data: { title: "Example", tags: ["cli", "markdown"] } },
      { type: "alert", kind: "NOTE", children: [paragraphNode] },
      { type: "alert", kind: "TIP", children: [paragraphNode] },
      { type: "alert", kind: "IMPORTANT", children: [paragraphNode] },
      { type: "alert", kind: "WARNING", children: [paragraphNode] },
      { type: "alert", kind: "CAUTION", children: [paragraphNode] },
      { type: "footnoteDefinition", label: "note-1", children: [paragraphNode] },
      { type: "footnoteReference", label: "note-1" }
    ];

    expect(nodes).toHaveLength(36);
  });
});

describe("parseInline", () => {
  it("returns a single text node for plain inline text", () => {
    expect(parseInline("plain text")).toEqual([{ type: "text", value: "plain text" }]);
  });

  it("parses backslash escapes for markdown punctuation (tests 48-49)", () => {
    expect(parseInline("\\[link\\] and \\`code\\`")).toEqual([
      { type: "text", value: "[link] and `code`" }
    ]);
  });

  it("parses single-backtick inline code without trimming spaces (test 38)", () => {
    expect(parseInline("before `  code  ` after")).toEqual([
      { type: "text", value: "before " },
      { type: "inlineCode", value: "  code  " },
      { type: "text", value: " after" }
    ]);
  });

  it("parses double-backtick inline code and keeps inner markdown literal (tests 39-40)", () => {
    expect(parseInline("``**bold** `code` ``")).toEqual([
      { type: "inlineCode", value: "**bold** `code` " }
    ]);
  });

  it("parses links, images, and autolinks (tests 41-46)", () => {
    expect(
      parseInline(
        '[link](https://example.com "Example") ![alt](https://example.com/image.png "Image") <https://example.com>'
      )
    ).toEqual([
      {
        type: "link",
        url: "https://example.com",
        title: "Example",
        children: [{ type: "text", value: "link" }]
      },
      { type: "text", value: " " },
      {
        type: "image",
        url: "https://example.com/image.png",
        alt: "alt",
        title: "Image"
      },
      { type: "text", value: " " },
      {
        type: "link",
        url: "https://example.com",
        children: [{ type: "text", value: "https://example.com" }]
      }
    ]);
  });

  it("supports empty link text and recursive parsing in link children (tests 43, 47)", () => {
    expect(parseInline("[](https://example.com) [see `code`](/docs)")).toEqual([
      { type: "link", url: "https://example.com", children: [] },
      { type: "text", value: " " },
      {
        type: "link",
        url: "/docs",
        children: [
          { type: "text", value: "see " },
          { type: "inlineCode", value: "code" }
        ]
      }
    ]);
  });

  it("treats malformed links with missing closers as literal text", () => {
    expect(parseInline("[text")).toEqual([{ type: "text", value: "[text" }]);
    expect(parseInline("[text](https://example.com")).toEqual([
      { type: "text", value: "[text](https://example.com" }
    ]);
  });

  it("treats unclosed link syntax as literal text and supports empty destinations (tests 119-122)", () => {
    expect(parseInline("[text]( [text](url [text]() ![]()")).toEqual([
      {
        type: "text",
        value: "[text]( [text](url "
      },
      { type: "link", url: "", children: [{ type: "text", value: "text" }] },
      { type: "text", value: " " },
      { type: "image", url: "", alt: "" }
    ]);
  });

  it("preserves escaped punctuation inside labels, alt text, and destinations", () => {
    expect(parseInline(String.raw`[a\]b](https://example.com/a\)) ![\[alt\]](img\))`)).toEqual([
      {
        type: "link",
        url: "https://example.com/a)",
        children: [{ type: "text", value: "a]b" }]
      },
      { type: "text", value: " " },
      {
        type: "image",
        url: "img)",
        alt: "[alt]"
      }
    ]);
  });

  it("preserves spaces and balanced parentheses in link destinations (tests 149-150)", () => {
    expect(
      parseInline("[spacey](https://example.com/a path) [paren](https://example.com/a_(b))")
    ).toEqual([
      {
        type: "link",
        url: "https://example.com/a path",
        children: [{ type: "text", value: "spacey" }]
      },
      { type: "text", value: " " },
      {
        type: "link",
        url: "https://example.com/a_(b)",
        children: [{ type: "text", value: "paren" }]
      }
    ]);
  });

  it("parses inline HTML tags as html nodes (test 53)", () => {
    expect(parseInline("<kbd>Ctrl</kbd> + <br/>")).toEqual([
      { type: "html", value: "<kbd>" },
      { type: "text", value: "Ctrl" },
      { type: "html", value: "</kbd>" },
      { type: "text", value: " + " },
      { type: "html", value: "<br/>" }
    ]);
  });

  it("parses emphasis and strong with asterisks and underscores (tests 31-34)", () => {
    expect(parseInline("*em* _em_ **strong** __strong__")).toEqual([
      { type: "emphasis", children: [{ type: "text", value: "em" }] },
      { type: "text", value: " " },
      { type: "emphasis", children: [{ type: "text", value: "em" }] },
      { type: "text", value: " " },
      { type: "strong", children: [{ type: "text", value: "strong" }] },
      { type: "text", value: " " },
      { type: "strong", children: [{ type: "text", value: "strong" }] }
    ]);
  });

  it("parses nested delimiter combinations requested by the inline spec cases", () => {
    expect(parseInline("***both***")).toEqual([
      {
        type: "emphasis",
        children: [{ type: "strong", children: [{ type: "text", value: "both" }] }]
      }
    ]);

    expect(parseInline("*foo **bar** baz*")).toEqual([
      {
        type: "emphasis",
        children: [
          { type: "text", value: "foo " },
          { type: "strong", children: [{ type: "text", value: "bar" }] },
          { type: "text", value: " baz" }
        ]
      }
    ]);
  });

  it("applies asterisk emphasis inside words but not underscore emphasis (tests 36-37)", () => {
    expect(parseInline("foo*bar*baz")).toEqual([
      { type: "text", value: "foo" },
      { type: "emphasis", children: [{ type: "text", value: "bar" }] },
      { type: "text", value: "baz" }
    ]);

    expect(parseInline("foo_bar_baz")).toEqual([{ type: "text", value: "foo_bar_baz" }]);
  });

  it("parses emphasis across line boundaries and next to punctuation (tests 54, 151)", () => {
    expect(parseInline("*foo\nbar*")).toEqual([
      { type: "emphasis", children: [{ type: "text", value: "foo\nbar" }] }
    ]);

    expect(parseInline('"*hello*"')).toEqual([
      { type: "text", value: '"' },
      { type: "emphasis", children: [{ type: "text", value: "hello" }] },
      { type: "text", value: '"' }
    ]);
  });

  it("treats invalid or unresolved delimiter runs as literal text (tests 116-118, 123-124, 144)", () => {
    expect(parseInline("*hello")).toEqual([{ type: "text", value: "*hello" }]);
    expect(parseInline("**hello")).toEqual([{ type: "text", value: "**hello" }]);
    expect(parseInline("~~hello")).toEqual([{ type: "text", value: "~~hello" }]);
    expect(parseInline("* spaced *")).toEqual([{ type: "text", value: "* spaced *" }]);
    expect(parseInline("*foo **bar")).toEqual([{ type: "text", value: "*foo **bar" }]);
    expect(parseInline("*hello_")).toEqual([{ type: "text", value: "*hello_" }]);
  });

  it("parses strikethrough with double tildes (test 52)", () => {
    expect(parseInline("~~deleted~~")).toEqual([
      { type: "strikethrough", children: [{ type: "text", value: "deleted" }] }
    ]);
  });

  it("does not cross emphasis delimiters across mismatched runs", () => {
    expect(parseInline("*foo _bar* baz_")).toEqual([
      { type: "emphasis", children: [{ type: "text", value: "foo _bar" }] },
      { type: "text", value: " baz_" }
    ]);

    expect(parseInline("_a *b_ c*")).toEqual([
      { type: "emphasis", children: [{ type: "text", value: "a *b" }] },
      { type: "text", value: " c*" }
    ]);

    expect(parseInline("*foo __bar* baz__")).toEqual([
      { type: "emphasis", children: [{ type: "text", value: "foo __bar" }] },
      { type: "text", value: " baz__" }
    ]);

    expect(parseInline("__foo *bar__ baz*")).toEqual([
      { type: "strong", children: [{ type: "text", value: "foo *bar" }] },
      { type: "text", value: " baz*" }
    ]);
  });

  it("does not cross strikethrough delimiters over emphasis", () => {
    expect(parseInline("*a ~~b* c~~")).toEqual([
      { type: "emphasis", children: [{ type: "text", value: "a ~~b" }] },
      { type: "text", value: " c~~" }
    ]);

    expect(parseInline("~~a *b~~ c*")).toEqual([
      { type: "strikethrough", children: [{ type: "text", value: "a *b" }] },
      { type: "text", value: " c*" }
    ]);
  });

  it("parses footnote references only when the definition label exists (tests 103, 106, 108, 138)", () => {
    expect(
      parseInline("See [^note] and [^missing].", { footnoteLabels: new Set(["note"]) })
    ).toEqual([
      { type: "text", value: "See " },
      { type: "footnoteReference", label: "note" },
      { type: "text", value: " and [^missing]." }
    ]);
  });

  it("parses bare URL and email autolink literals (tests 110-113)", () => {
    expect(
      parseInline("https://example.com http://example.com www.example.com user@example.com")
    ).toEqual([
      {
        type: "link",
        url: "https://example.com",
        children: [{ type: "text", value: "https://example.com" }]
      },
      { type: "text", value: " " },
      {
        type: "link",
        url: "http://example.com",
        children: [{ type: "text", value: "http://example.com" }]
      },
      { type: "text", value: " " },
      {
        type: "link",
        url: "http://www.example.com",
        children: [{ type: "text", value: "www.example.com" }]
      },
      { type: "text", value: " " },
      {
        type: "link",
        url: "mailto:user@example.com",
        children: [{ type: "text", value: "user@example.com" }]
      }
    ]);
  });

  it("trims trailing punctuation from literal autolinks but keeps balanced delimiters", () => {
    expect(
      parseInline("See www.example.com, https://example.com/path(ok). and user@example.com.")
    ).toEqual([
      { type: "text", value: "See " },
      {
        type: "link",
        url: "http://www.example.com",
        children: [{ type: "text", value: "www.example.com" }]
      },
      { type: "text", value: ", " },
      {
        type: "link",
        url: "https://example.com/path(ok)",
        children: [{ type: "text", value: "https://example.com/path(ok)" }]
      },
      { type: "text", value: ". and " },
      {
        type: "link",
        url: "mailto:user@example.com",
        children: [{ type: "text", value: "user@example.com" }]
      },
      { type: "text", value: "." }
    ]);
  });

  it("does not trigger literal autolinks inside code spans or links (test 114)", () => {
    expect(parseInline("`https://example.com` [www.example.com](https://outer.test)")).toEqual([
      { type: "inlineCode", value: "https://example.com" },
      { type: "text", value: " " },
      {
        type: "link",
        url: "https://outer.test",
        children: [{ type: "text", value: "www.example.com" }]
      }
    ]);
  });

  it("parses hard line breaks from trailing spaces and backslashes (tests 50-51)", () => {
    expect(parseInline("alpha  \nbeta\\\ngamma\ndelta")).toEqual([
      { type: "text", value: "alpha" },
      { type: "break" },
      { type: "text", value: "beta" },
      { type: "break" },
      { type: "text", value: "gamma\ndelta" }
    ]);
  });
});

describe("extractFrontmatter", () => {
  it("parses simple key-value pairs and typed scalar values (tests 66, 69)", () => {
    expect(
      extractFrontmatter(
        [
          "---",
          "title: Hello",
          "views: 42",
          "published: true",
          "draft: false",
          "summary: null",
          "---",
          "# Heading"
        ].join("\n")
      )
    ).toEqual({
      frontmatter: {
        title: "Hello",
        views: 42,
        published: true,
        draft: false,
        summary: null
      },
      body: "# Heading"
    });
  });

  it("parses nested objects and arrays by indentation (tests 67-68)", () => {
    expect(
      extractFrontmatter(
        [
          "---",
          "meta:",
          "  title: Example",
          "  tags:",
          "    - cli",
          "    - markdown",
          "  stats:",
          "    views: 7",
          "    featured: false",
          "---",
          "Body"
        ].join("\n")
      )
    ).toEqual({
      frontmatter: {
        meta: {
          title: "Example",
          tags: ["cli", "markdown"],
          stats: {
            views: 7,
            featured: false
          }
        }
      },
      body: "Body"
    });
  });

  it("parses a literal block scalar with clip chomping (|)", () => {
    expect(
      extractFrontmatter(
        ["---", "prompt: |", "  line one", "", "  line two", "---", "Body"].join("\n")
      )
    ).toEqual({
      frontmatter: { prompt: "line one\n\nline two\n" },
      body: "Body"
    });
  });

  it("parses a literal block scalar with strip chomping (|-)", () => {
    expect(
      extractFrontmatter(["---", "prompt: |-", "  alpha", "  beta", "---", "Body"].join("\n"))
    ).toEqual({
      frontmatter: { prompt: "alpha\nbeta" },
      body: "Body"
    });
  });

  it("parses a literal block scalar with keep chomping (|+)", () => {
    expect(
      extractFrontmatter(["---", "prompt: |+", "  alpha", "", "", "---", "Body"].join("\n"))
    ).toEqual({
      frontmatter: { prompt: "alpha\n\n\n" },
      body: "Body"
    });
  });

  it("parses a block scalar nested in a mapping and preserves relative indentation", () => {
    expect(
      extractFrontmatter(
        [
          "---",
          "states:",
          "  queued:",
          "    prompt: |",
          "      do x",
          "        nested",
          "      then y",
          "  done:",
          "    terminal: true",
          "---",
          "Body"
        ].join("\n")
      )
    ).toEqual({
      frontmatter: {
        states: {
          queued: { prompt: "do x\n  nested\nthen y\n" },
          done: { terminal: true }
        }
      },
      body: "Body"
    });
  });

  it("preserves __proto__ frontmatter as own metadata without prototype mutation", () => {
    const { frontmatter } = extractFrontmatter(
      ["---", "__proto__:", "  owner: attacker", "---", "Body"].join("\n")
    );

    expect(Object.hasOwn(frontmatter!, "__proto__")).toBe(true);
    expect((frontmatter as { owner?: string }).owner).toBeUndefined();
    expect((frontmatter as Record<string, unknown>)["__proto__"]).toEqual({ owner: "attacker" });
  });

  it("supports quoted values and special characters in scalars (test 73)", () => {
    expect(
      extractFrontmatter(
        [
          "---",
          'title: "Hello: world"',
          "path: /docs/[slug]?q=1&mode=test",
          "literal: '#hash & [brackets] {braces}'",
          "---",
          "Body"
        ].join("\n")
      )
    ).toEqual({
      frontmatter: {
        title: "Hello: world",
        path: "/docs/[slug]?q=1&mode=test",
        literal: "#hash & [brackets] {braces}"
      },
      body: "Body"
    });
  });

  it("preserves backslashes in double-quoted scalars while decoding supported escapes", () => {
    expect(
      extractFrontmatter(
        [
          "---",
          'windowsPath: "C:\\\\tools\\\\bin"',
          'message: "line 1\\nline 2"',
          'quoted: "say \\"hello\\""',
          "---",
          "Body"
        ].join("\n")
      )
    ).toEqual({
      frontmatter: {
        windowsPath: "C:\\tools\\bin",
        message: "line 1\nline 2",
        quoted: 'say "hello"'
      },
      body: "Body"
    });
  });

  it("decodes common escaped characters in double-quoted scalars", () => {
    expect(
      extractFrontmatter(
        ["---", 'unicode: "\\u263A"', 'control: "a\\bb\\fc"', "---", "Body"].join("\n")
      )
    ).toEqual({
      frontmatter: {
        unicode: "☺",
        control: "a\bb\fc"
      },
      body: "Body"
    });
  });

  it("returns the original body when no frontmatter exists and parses empty frontmatter (tests 70-71)", () => {
    expect(extractFrontmatter("# Heading\n\nBody")).toEqual({
      body: "# Heading\n\nBody"
    });

    expect(extractFrontmatter(["---", "---"].join("\n"))).toEqual({
      frontmatter: {},
      body: ""
    });
  });

  it("parses frontmatter with carriage-return-only line endings", () => {
    expect(extractFrontmatter(["---", "title: Example", "---", "Body"].join("\r"))).toEqual({
      frontmatter: { title: "Example" },
      body: "Body"
    });
  });

  it("does not treat non-leading fences as frontmatter (test 72)", () => {
    expect(extractFrontmatter(["# Heading", "---", "title: Example", "---"].join("\n"))).toEqual({
      body: "# Heading\n---\ntitle: Example\n---"
    });
  });

  it("throws typed parser errors for invalid frontmatter", () => {
    expect(() =>
      extractFrontmatter(["---", "title: hello: world", "---", "Body"].join("\n"))
    ).toThrow("Invalid YAML frontmatter:");
  });
});

describe("parseBlocks", () => {
  it("returns no nodes for empty or whitespace-only input", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("   \n\t\n")).toEqual([]);
    expect(parseBlocks("\n")).toEqual([]);
  });

  it("groups consecutive non-blank lines into paragraph text nodes", () => {
    expect(parseBlocks("alpha\nbeta\n\ngamma")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "alpha\nbeta" }] },
      { type: "paragraph", children: [{ type: "text", value: "gamma" }] }
    ]);
  });

  it("parses backtick fenced code blocks", () => {
    expect(parseBlocks("```ts\nconst value = 1;\n```")).toEqual([
      { type: "code", lang: "ts", value: "const value = 1;" }
    ]);
  });

  it("parses tilde fenced code blocks", () => {
    expect(parseBlocks("~~~bash\nnpm test\n~~~")).toEqual([
      { type: "code", lang: "bash", value: "npm test" }
    ]);
  });

  it("only closes fenced code blocks with the matching fence marker", () => {
    expect(parseBlocks("```\n~~~\n```\n\n~~~\n```\n~~~")).toEqual([
      { type: "code", value: "~~~" },
      { type: "code", value: "```" }
    ]);
  });

  it("parses code fences with language and meta string", () => {
    expect(parseBlocks("```ts title=example.ts linenos\nconst value = 1;\n```")).toEqual([
      {
        type: "code",
        lang: "ts",
        meta: "title=example.ts linenos",
        value: "const value = 1;"
      }
    ]);
  });

  it("keeps markdown-like content inside fenced code blocks as raw text", () => {
    expect(parseBlocks("```\n# heading\n- list item\n\n> quote\n```")).toEqual([
      { type: "code", value: "# heading\n- list item\n\n> quote" }
    ]);
  });

  it("treats indented code-style lines as paragraph content for now", () => {
    expect(parseBlocks("    const value = 1;\n    console.log(value);")).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", value: "    const value = 1;\n    console.log(value);" }]
      }
    ]);
  });

  it("supports empty fenced code blocks", () => {
    expect(parseBlocks("```\n```")).toEqual([{ type: "code", value: "" }]);
  });

  it("treats an unclosed fence as code through the end of the document", () => {
    expect(parseBlocks('```json\n{\n  "key": true\n}\n\ntrailing text')).toEqual([
      {
        type: "code",
        lang: "json",
        value: '{\n  "key": true\n}\n\ntrailing text'
      }
    ]);
  });

  it("allows closing fences with trailing spaces", () => {
    expect(parseBlocks("```\nvalue\n```   ")).toEqual([{ type: "code", value: "value" }]);
  });

  it("normalizes BOM and CRLF input while parsing blocks", () => {
    expect(
      parseBlocks("\uFEFF```ts title=demo\r\nconst value = 1;\r\n```\r\n\r\nnext\r\n")
    ).toEqual([
      { type: "code", lang: "ts", meta: "title=demo", value: "const value = 1;" },
      { type: "paragraph", children: [{ type: "text", value: "next" }] }
    ]);
  });

  it("parses ATX headings from level 1 through 6", () => {
    expect(parseBlocks("# one\n## two\n### three\n#### four\n##### five\n###### six")).toEqual([
      { type: "heading", depth: 1, children: [{ type: "text", value: "one" }] },
      { type: "heading", depth: 2, children: [{ type: "text", value: "two" }] },
      { type: "heading", depth: 3, children: [{ type: "text", value: "three" }] },
      { type: "heading", depth: 4, children: [{ type: "text", value: "four" }] },
      { type: "heading", depth: 5, children: [{ type: "text", value: "five" }] },
      { type: "heading", depth: 6, children: [{ type: "text", value: "six" }] }
    ]);
  });

  it("parses ATX headings with closing hashes", () => {
    expect(parseBlocks("## Heading ##")).toEqual([
      { type: "heading", depth: 2, children: [{ type: "text", value: "Heading" }] }
    ]);
  });

  it("applies inline parsing inside ATX headings", () => {
    expect(parseBlocks("## Hello *world*")).toEqual([
      {
        type: "heading",
        depth: 2,
        children: [
          { type: "text", value: "Hello " },
          { type: "emphasis", children: [{ type: "text", value: "world" }] }
        ]
      }
    ]);
  });

  it("parses an ATX heading with no text as an empty heading node", () => {
    expect(parseBlocks("#")).toEqual([{ type: "heading", depth: 1, children: [] }]);
    expect(parseBlocks("###   ")).toEqual([{ type: "heading", depth: 3, children: [] }]);
  });

  it("treats ATX headings made only of closing hashes as empty headings", () => {
    expect(parseBlocks("## ##")).toEqual([{ type: "heading", depth: 2, children: [] }]);
    expect(parseBlocks("### ###")).toEqual([{ type: "heading", depth: 3, children: [] }]);
  });

  it("treats 7 or more leading hashes as paragraph content", () => {
    expect(parseBlocks("####### not a heading")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "####### not a heading" }] }
    ]);
  });

  it("parses ATX headings indented by up to three spaces", () => {
    expect(parseBlocks("   ### spaced")).toEqual([
      { type: "heading", depth: 3, children: [{ type: "text", value: "spaced" }] }
    ]);
  });

  it("lets ATX headings interrupt a paragraph without a blank line", () => {
    expect(parseBlocks("before\n## after")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "before" }] },
      { type: "heading", depth: 2, children: [{ type: "text", value: "after" }] }
    ]);
  });

  it("parses thematic breaks with dashes, asterisks, and underscores", () => {
    expect(parseBlocks("---\n***\n___")).toEqual([
      { type: "thematicBreak" },
      { type: "thematicBreak" },
      { type: "thematicBreak" }
    ]);
  });

  it("parses thematic breaks with spaces between markers", () => {
    expect(parseBlocks("- - -")).toEqual([{ type: "thematicBreak" }]);
  });

  it("parses block-level HTML content as an html node", () => {
    expect(parseBlocks("<div>\nalpha\n</div>\n\nbeta")).toEqual([
      { type: "html", value: "<div>\nalpha\n</div>" },
      { type: "paragraph", children: [{ type: "text", value: "beta" }] }
    ]);
  });

  it("renders HTML-like content with an invalid tag name as text (test 136)", () => {
    expect(parseBlocks("<not a tag>")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "<not a tag>" }] }
    ]);
  });

  it("parses a simple 2-column GFM pipe table (test 56)", () => {
    expect(parseBlocks("| Name | Value |\n| --- | --- |\n| alpha | beta |")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("Name", "Value"), createTableRow("alpha", "beta")]
      }
    ]);
  });

  it("parses table alignment from the separator row (test 57)", () => {
    expect(
      parseBlocks("| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |")
    ).toEqual([
      {
        type: "table",
        align: ["left", "center", "right"],
        children: [createTableRow("Left", "Center", "Right"), createTableRow("a", "b", "c")]
      }
    ]);
  });

  it("applies inline parsing inside table cells (test 58)", () => {
    expect(
      parseBlocks("| Name | Notes |\n| --- | --- |\n| *alpha* | `beta` and **gamma** |")
    ).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [
          createTableRow("Name", "Notes"),
          {
            type: "tableRow",
            children: [
              {
                type: "tableCell",
                children: [{ type: "emphasis", children: [{ type: "text", value: "alpha" }] }]
              },
              {
                type: "tableCell",
                children: [
                  { type: "inlineCode", value: "beta" },
                  { type: "text", value: " and " },
                  { type: "strong", children: [{ type: "text", value: "gamma" }] }
                ]
              }
            ]
          }
        ]
      }
    ]);
  });

  it("parses empty cells in GFM pipe tables (test 59)", () => {
    expect(parseBlocks("| A | B | C |\n| --- | --- | --- |\n| | mid | |")).toEqual([
      {
        type: "table",
        align: [null, null, null],
        children: [createTableRow("A", "B", "C"), createTableRow("", "mid", "")]
      }
    ]);
  });

  it("pads short rows to the header column count (test 60)", () => {
    expect(parseBlocks("| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |")).toEqual([
      {
        type: "table",
        align: [null, null, null],
        children: [createTableRow("A", "B", "C"), createTableRow("1", "2", "")]
      }
    ]);
  });

  it("unescapes escaped pipes inside cells (test 61)", () => {
    expect(parseBlocks("| A | B |\n| --- | --- |\n| left \\| right | keep |")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("A", "B"), createTableRow("left | right", "keep")]
      }
    ]);
  });

  it("does not parse a pipe table without an alignment row (test 62)", () => {
    expect(parseBlocks("| A | B |\n| C | D |")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "| A | B |\n| C | D |" }] }
    ]);
  });

  it("parses a minimal table with a header, separator, and one row (test 63)", () => {
    expect(parseBlocks("A | B\n--- | ---\nC | D")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("A", "B"), createTableRow("C", "D")]
      }
    ]);
  });

  it("parses tables with leading and trailing pipes (test 64)", () => {
    expect(parseBlocks("| A | B |\n| --- | --- |\n| C | D |")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("A", "B"), createTableRow("C", "D")]
      }
    ]);
  });

  it("parses tables without leading or trailing pipes (test 65)", () => {
    expect(parseBlocks("A | B\n--- | ---\nC | D")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("A", "B"), createTableRow("C", "D")]
      }
    ]);
  });

  it("pads and truncates inconsistent row widths to match the header (test 127)", () => {
    expect(parseBlocks("| A | B |\n| --- | --- |\n| one | two | three |\n| solo |")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [
          createTableRow("A", "B"),
          createTableRow("one", "two"),
          createTableRow("solo", "")
        ]
      }
    ]);
  });

  it("parses header-only tables without requiring data rows (test 128)", () => {
    expect(parseBlocks("| A | B |\n| --- | --- |")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("A", "B")]
      }
    ]);
  });

  it("does not parse tables with invalid separator rows (test 129)", () => {
    expect(parseBlocks("| A | B |\n| --- | nope |\n| C | D |")).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", value: "| A | B |\n| --- | nope |\n| C | D |" }]
      }
    ]);
  });

  it("stops a table before a following blockquote that contains pipes", () => {
    expect(parseBlocks("| A | B |\n| --- | --- |\n> quoted | row")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("A", "B")]
      },
      {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "quoted | row" }]
          }
        ]
      }
    ]);
  });

  it("stops a table before a following heading that contains pipes", () => {
    expect(parseBlocks("| A | B |\n| --- | --- |\n# heading | pipe")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("A", "B")]
      },
      {
        type: "heading",
        depth: 1,
        children: [{ type: "text", value: "heading | pipe" }]
      }
    ]);
  });

  it("stops a table before a following list item that contains pipes", () => {
    expect(parseBlocks("| A | B |\n| --- | --- |\n- item | value")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("A", "B")]
      },
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", value: "item | value" }]
              }
            ]
          }
        ]
      }
    ]);
  });

  it("parses a single-line blockquote (spec example 20)", () => {
    expect(parseBlocks("> alpha")).toEqual([
      {
        type: "blockquote",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      }
    ]);
  });

  it("parses a multi-line blockquote as a nested paragraph (spec example 21)", () => {
    expect(parseBlocks("> alpha\n> beta")).toEqual([
      {
        type: "blockquote",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha\nbeta" }] }]
      }
    ]);
  });

  it("parses blockquotes without a space after the marker", () => {
    expect(parseBlocks(">alpha")).toEqual([
      {
        type: "blockquote",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      }
    ]);
  });

  it("parses blockquotes indented by up to three spaces", () => {
    expect(parseBlocks("   > alpha")).toEqual([
      {
        type: "blockquote",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      }
    ]);
  });

  it("parses nested blockquotes (spec example 22)", () => {
    expect(parseBlocks("> > nested")).toEqual([
      {
        type: "blockquote",
        children: [
          {
            type: "blockquote",
            children: [{ type: "paragraph", children: [{ type: "text", value: "nested" }] }]
          }
        ]
      }
    ]);
  });

  it("parses blockquotes containing headings, lists, and code blocks (spec example 23)", () => {
    expect(
      parseBlocks("> ## heading\n>\n> - first\n> - second\n>\n> ```ts\n> const value = 1;\n> ```")
    ).toEqual([
      {
        type: "blockquote",
        children: [
          { type: "heading", depth: 2, children: [{ type: "text", value: "heading" }] },
          {
            type: "list",
            ordered: false,
            children: [
              {
                type: "listItem",
                children: [{ type: "paragraph", children: [{ type: "text", value: "first" }] }]
              },
              {
                type: "listItem",
                children: [{ type: "paragraph", children: [{ type: "text", value: "second" }] }]
              }
            ]
          },
          { type: "code", lang: "ts", value: "const value = 1;" }
        ]
      }
    ]);
  });

  it("parses fenced code blocks inside blockquotes (spec example 87)", () => {
    expect(parseBlocks("> ```\n> const value = 1;\n> ```")).toEqual([
      {
        type: "blockquote",
        children: [{ type: "code", value: "const value = 1;" }]
      }
    ]);
  });

  it("parses deeply nested blockquotes beyond four levels (spec example 89)", () => {
    expect(parseBlocks("> > > > > deep")).toEqual([
      {
        type: "blockquote",
        children: [
          {
            type: "blockquote",
            children: [
              {
                type: "blockquote",
                children: [
                  {
                    type: "blockquote",
                    children: [
                      {
                        type: "blockquote",
                        children: [
                          {
                            type: "paragraph",
                            children: [{ type: "text", value: "deep" }]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
  });

  it("parses trailing empty quote markers as an empty blockquote (spec example 132)", () => {
    expect(parseBlocks(">\n>")).toEqual([{ type: "blockquote", children: [] }]);
  });

  it("splits blockquote paragraphs on quoted blank lines", () => {
    expect(parseBlocks("> alpha\n>\n> beta")).toEqual([
      {
        type: "blockquote",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "alpha" }] },
          { type: "paragraph", children: [{ type: "text", value: "beta" }] }
        ]
      }
    ]);
  });

  it("parses ordered lists inside blockquotes", () => {
    expect(parseBlocks("> 1. first\n> 2. second")).toEqual([
      {
        type: "blockquote",
        children: [
          {
            type: "list",
            ordered: true,
            start: 1,
            children: [
              {
                type: "listItem",
                children: [{ type: "paragraph", children: [{ type: "text", value: "first" }] }]
              },
              {
                type: "listItem",
                children: [{ type: "paragraph", children: [{ type: "text", value: "second" }] }]
              }
            ]
          }
        ]
      }
    ]);
  });

  it("parses NOTE alerts before regular blockquotes (test 95)", () => {
    expect(parseBlocks("> [!NOTE]\n> alpha")).toEqual([
      {
        type: "alert",
        kind: "NOTE",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      }
    ]);
  });

  it("parses TIP alerts before regular blockquotes (test 96)", () => {
    expect(parseBlocks("> [!TIP]\n> alpha")).toEqual([
      {
        type: "alert",
        kind: "TIP",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      }
    ]);
  });

  it("parses IMPORTANT alerts before regular blockquotes (test 97)", () => {
    expect(parseBlocks("> [!IMPORTANT]\n> alpha")).toEqual([
      {
        type: "alert",
        kind: "IMPORTANT",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      }
    ]);
  });

  it("parses WARNING alerts before regular blockquotes (test 98)", () => {
    expect(parseBlocks("> [!WARNING]\n> alpha")).toEqual([
      {
        type: "alert",
        kind: "WARNING",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      }
    ]);
  });

  it("parses CAUTION alerts before regular blockquotes (test 99)", () => {
    expect(parseBlocks("> [!CAUTION]\n> alpha")).toEqual([
      {
        type: "alert",
        kind: "CAUTION",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      }
    ]);
  });

  it("parses multi-line alert content as nested blocks (test 100)", () => {
    expect(parseBlocks("> [!NOTE]\n> alpha\n>\n> beta")).toEqual([
      {
        type: "alert",
        kind: "NOTE",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "alpha" }] },
          { type: "paragraph", children: [{ type: "text", value: "beta" }] }
        ]
      }
    ]);
  });

  it("applies inline parsing inside alerts (test 101)", () => {
    expect(parseBlocks("> [!TIP]\n> use *care* and `focus`")).toEqual([
      {
        type: "alert",
        kind: "TIP",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "use " },
              { type: "emphasis", children: [{ type: "text", value: "care" }] },
              { type: "text", value: " and " },
              { type: "inlineCode", value: "focus" }
            ]
          }
        ]
      }
    ]);
  });

  it("parses nested block elements inside alerts (test 102)", () => {
    expect(parseBlocks("> [!WARNING]\n> - first\n> - second")).toEqual([
      {
        type: "alert",
        kind: "WARNING",
        children: [
          {
            type: "list",
            ordered: false,
            children: [
              {
                type: "listItem",
                children: [{ type: "paragraph", children: [{ type: "text", value: "first" }] }]
              },
              {
                type: "listItem",
                children: [{ type: "paragraph", children: [{ type: "text", value: "second" }] }]
              }
            ]
          }
        ]
      }
    ]);
  });

  it("parses a simple footnote definition (test 103)", () => {
    expect(parseBlocks("[^1]: alpha")).toEqual([
      {
        type: "footnoteDefinition",
        label: "1",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      }
    ]);
  });

  it("parses footnote definitions with multi-line content (test 104)", () => {
    expect(parseBlocks("[^1]: alpha\n    beta\n\n    gamma")).toEqual([
      {
        type: "footnoteDefinition",
        label: "1",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "alpha\nbeta" }] },
          { type: "paragraph", children: [{ type: "text", value: "gamma" }] }
        ]
      }
    ]);
  });

  it("parses multiple footnote definitions in a document (test 105)", () => {
    expect(parseBlocks("[^1]: alpha\n[^2]: beta")).toEqual([
      {
        type: "footnoteDefinition",
        label: "1",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      },
      {
        type: "footnoteDefinition",
        label: "2",
        children: [{ type: "paragraph", children: [{ type: "text", value: "beta" }] }]
      }
    ]);
  });

  it("parses footnote definitions with alphanumeric labels (test 109)", () => {
    expect(parseBlocks("[^note1]: alpha")).toEqual([
      {
        type: "footnoteDefinition",
        label: "note1",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      }
    ]);
  });

  it("lets blockquotes interrupt a paragraph without a blank line", () => {
    expect(parseBlocks("before\n> after")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "before" }] },
      {
        type: "blockquote",
        children: [{ type: "paragraph", children: [{ type: "text", value: "after" }] }]
      }
    ]);
  });

  it("parses simple unordered lists", () => {
    expect(parseBlocks("- first\n- second")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [{ type: "paragraph", children: [{ type: "text", value: "first" }] }]
          },
          {
            type: "listItem",
            children: [{ type: "paragraph", children: [{ type: "text", value: "second" }] }]
          }
        ]
      }
    ]);
  });

  it("parses unordered lists with asterisk markers (spec test 25)", () => {
    expect(parseBlocks("* first\n* second")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [{ type: "paragraph", children: [{ type: "text", value: "first" }] }]
          },
          {
            type: "listItem",
            children: [{ type: "paragraph", children: [{ type: "text", value: "second" }] }]
          }
        ]
      }
    ]);
  });

  it("parses unordered lists with plus markers (spec test 26)", () => {
    expect(parseBlocks("+ first\n+ second")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [{ type: "paragraph", children: [{ type: "text", value: "first" }] }]
          },
          {
            type: "listItem",
            children: [{ type: "paragraph", children: [{ type: "text", value: "second" }] }]
          }
        ]
      }
    ]);
  });

  it("parses ordered lists starting at 1 (spec test 27)", () => {
    expect(parseBlocks("1. first\n2. second")).toEqual([
      {
        type: "list",
        ordered: true,
        start: 1,
        children: [
          {
            type: "listItem",
            children: [{ type: "paragraph", children: [{ type: "text", value: "first" }] }]
          },
          {
            type: "listItem",
            children: [{ type: "paragraph", children: [{ type: "text", value: "second" }] }]
          }
        ]
      }
    ]);
  });

  it("parses ordered lists starting at an arbitrary number (spec test 28)", () => {
    expect(parseBlocks("7. first\n8. second")).toEqual([
      {
        type: "list",
        ordered: true,
        start: 7,
        children: [
          {
            type: "listItem",
            children: [{ type: "paragraph", children: [{ type: "text", value: "first" }] }]
          },
          {
            type: "listItem",
            children: [{ type: "paragraph", children: [{ type: "text", value: "second" }] }]
          }
        ]
      }
    ]);
  });

  it("parses nested unordered lists inside unordered lists (spec test 29)", () => {
    expect(parseBlocks("- parent\n  - child")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [
              { type: "paragraph", children: [{ type: "text", value: "parent" }] },
              {
                type: "list",
                ordered: false,
                children: [
                  {
                    type: "listItem",
                    children: [{ type: "paragraph", children: [{ type: "text", value: "child" }] }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
  });

  it("parses ordered lists nested inside unordered lists (spec test 30)", () => {
    expect(parseBlocks("- parent\n  1. child\n  2. second")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [
              { type: "paragraph", children: [{ type: "text", value: "parent" }] },
              {
                type: "list",
                ordered: true,
                start: 1,
                children: [
                  {
                    type: "listItem",
                    children: [{ type: "paragraph", children: [{ type: "text", value: "child" }] }]
                  },
                  {
                    type: "listItem",
                    children: [{ type: "paragraph", children: [{ type: "text", value: "second" }] }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
  });

  it("treats unknown alert kinds as regular blockquotes (test 137)", () => {
    expect(parseBlocks("> [!UNKNOWN]\n> alpha")).toEqual([
      {
        type: "blockquote",
        children: [{ type: "paragraph", children: [{ type: "text", value: "[!UNKNOWN]\nalpha" }] }]
      }
    ]);
  });

  it("parses checked task list items (spec test 74)", () => {
    expect(parseBlocks("- [x] done")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            checked: true,
            children: [{ type: "paragraph", children: [{ type: "text", value: "done" }] }]
          }
        ]
      }
    ]);
  });

  it("parses unchecked task list items (spec test 75)", () => {
    expect(parseBlocks("- [ ] todo")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            checked: false,
            children: [{ type: "paragraph", children: [{ type: "text", value: "todo" }] }]
          }
        ]
      }
    ]);
  });

  it("parses mixed task lists (spec test 76)", () => {
    expect(parseBlocks("- [x] done\n- [ ] todo\n- plain")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            checked: true,
            children: [{ type: "paragraph", children: [{ type: "text", value: "done" }] }]
          },
          {
            type: "listItem",
            checked: false,
            children: [{ type: "paragraph", children: [{ type: "text", value: "todo" }] }]
          },
          {
            type: "listItem",
            children: [{ type: "paragraph", children: [{ type: "text", value: "plain" }] }]
          }
        ]
      }
    ]);
  });

  it("applies inline parsing inside task list items (spec test 77)", () => {
    expect(parseBlocks("- [x] *done*")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            checked: true,
            children: [
              {
                type: "paragraph",
                children: [{ type: "emphasis", children: [{ type: "text", value: "done" }] }]
              }
            ]
          }
        ]
      }
    ]);
  });

  it("applies inline parsing across supported block children and keeps code/html raw", () => {
    expect(
      parseBlocks(
        [
          "Alpha [^note] and https://example.com  ",
          "next",
          "",
          "> quote *em*",
          "",
          "- item with user@example.com",
          "",
          "| Head | Value |",
          "| --- | --- |",
          "| `code` | www.example.com |",
          "",
          "> [!NOTE]",
          "> alert with [link](https://example.com)",
          "",
          "[^note]: footnote with **strong**",
          "",
          "```",
          "literal https://example.com [^note]",
          "```",
          "",
          "<div>*literal*</div>"
        ].join("\n")
      )
    ).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "Alpha " },
          { type: "footnoteReference", label: "note" },
          { type: "text", value: " and " },
          {
            type: "link",
            url: "https://example.com",
            children: [{ type: "text", value: "https://example.com" }]
          },
          { type: "break" },
          { type: "text", value: "next" }
        ]
      },
      {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "quote " },
              { type: "emphasis", children: [{ type: "text", value: "em" }] }
            ]
          }
        ]
      },
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [
              {
                type: "paragraph",
                children: [
                  { type: "text", value: "item with " },
                  {
                    type: "link",
                    url: "mailto:user@example.com",
                    children: [{ type: "text", value: "user@example.com" }]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        type: "table",
        align: [null, null],
        children: [
          createTableRow("Head", "Value"),
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "inlineCode", value: "code" }] },
              {
                type: "tableCell",
                children: [
                  {
                    type: "link",
                    url: "http://www.example.com",
                    children: [{ type: "text", value: "www.example.com" }]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        type: "alert",
        kind: "NOTE",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "alert with " },
              {
                type: "link",
                url: "https://example.com",
                children: [{ type: "text", value: "link" }]
              }
            ]
          }
        ]
      },
      {
        type: "footnoteDefinition",
        label: "note",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "footnote with " },
              { type: "strong", children: [{ type: "text", value: "strong" }] }
            ]
          }
        ]
      },
      {
        type: "code",
        value: "literal https://example.com [^note]"
      },
      {
        type: "html",
        value: "<div>*literal*</div>"
      }
    ]);
  });

  it("keeps unresolved footnotes literal and applies hard breaks inside alerts and footnotes", () => {
    expect(
      parseBlocks(
        [
          "See [^missing].",
          "",
          "> [!NOTE]",
          "> line  ",
          "> next",
          "",
          "[^note]: footnote line  ",
          "    next"
        ].join("\n")
      )
    ).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", value: "See [^missing]." }]
      },
      {
        type: "alert",
        kind: "NOTE",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "line" },
              { type: "break" },
              { type: "text", value: "next" }
            ]
          }
        ]
      },
      {
        type: "footnoteDefinition",
        label: "note",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "footnote line" },
              { type: "break" },
              { type: "text", value: "next" }
            ]
          }
        ]
      }
    ]);
  });

  it("parses nested task lists (spec test 78)", () => {
    expect(parseBlocks("- parent\n  - [x] child")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [
              { type: "paragraph", children: [{ type: "text", value: "parent" }] },
              {
                type: "list",
                ordered: false,
                children: [
                  {
                    type: "listItem",
                    checked: true,
                    children: [{ type: "paragraph", children: [{ type: "text", value: "child" }] }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
  });

  it("parses list items with multiple paragraphs separated by a blank line (spec test 85)", () => {
    expect(parseBlocks("- first paragraph\n\n  second paragraph")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [
              { type: "paragraph", children: [{ type: "text", value: "first paragraph" }] },
              { type: "paragraph", children: [{ type: "text", value: "second paragraph" }] }
            ]
          }
        ]
      }
    ]);
  });

  it("parses list item continuation from indented text (spec test 86)", () => {
    expect(parseBlocks("- first line\n  second line")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", value: "first line\nsecond line" }]
              }
            ]
          }
        ]
      }
    ]);
  });

  it("preserves non-sequential numbers inside ordered lists (spec test 134)", () => {
    expect(parseBlocks("3. first\n1. second\n8. third")).toEqual([
      {
        type: "list",
        ordered: true,
        start: 3,
        children: [
          {
            type: "listItem",
            children: [{ type: "paragraph", children: [{ type: "text", value: "first" }] }]
          },
          {
            type: "listItem",
            children: [{ type: "paragraph", children: [{ type: "text", value: "second" }] }]
          },
          {
            type: "listItem",
            children: [{ type: "paragraph", children: [{ type: "text", value: "third" }] }]
          }
        ]
      }
    ]);
  });

  it("lets lists interrupt a paragraph without a blank line (spec test 143)", () => {
    expect(parseBlocks("alpha\n- beta")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "alpha" }] },
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [{ type: "paragraph", children: [{ type: "text", value: "beta" }] }]
          }
        ]
      }
    ]);
  });

  it("normalizes tabs to four spaces while parsing list indentation (spec test 145)", () => {
    expect(parseBlocks("- parent\n \t- child")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [
              { type: "paragraph", children: [{ type: "text", value: "parent" }] },
              {
                type: "list",
                ordered: false,
                children: [
                  {
                    type: "listItem",
                    children: [{ type: "paragraph", children: [{ type: "text", value: "child" }] }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
  });

  it("parses empty list items (spec test 133)", () => {
    expect(parseBlocks("- \n- \n")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          { type: "listItem", children: [] },
          { type: "listItem", children: [] }
        ]
      }
    ]);
  });

  it("parses sub-items that would otherwise look like thematic breaks (spec test 153)", () => {
    expect(parseBlocks("- parent\n  - - -")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [
              { type: "paragraph", children: [{ type: "text", value: "parent" }] },
              {
                type: "list",
                ordered: false,
                children: [
                  {
                    type: "listItem",
                    children: [{ type: "paragraph", children: [{ type: "text", value: "- -" }] }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
  });

  it("parses setext level-1 headings", () => {
    expect(parseBlocks("Heading\n===")).toEqual([
      { type: "heading", depth: 1, children: [{ type: "text", value: "Heading" }] }
    ]);
  });

  it("parses setext level-2 headings", () => {
    expect(parseBlocks("Heading\n---")).toEqual([
      { type: "heading", depth: 2, children: [{ type: "text", value: "Heading" }] }
    ]);
  });

  it("does not treat spaced marker lines as setext underlines", () => {
    expect(parseBlocks("text\n- - -")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "text" }] },
      { type: "thematicBreak" }
    ]);
    expect(parseBlocks("text\n= = =")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "text\n= = =" }] }
    ]);
  });

  it("collapses multiple blank lines between blocks", () => {
    expect(parseBlocks("alpha\n\n\nbeta")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "alpha" }] },
      { type: "paragraph", children: [{ type: "text", value: "beta" }] }
    ]);
  });

  it("continues a paragraph across adjacent non-blank lines", () => {
    expect(parseBlocks("alpha\nbeta\ngamma")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "alpha\nbeta\ngamma" }] }
    ]);
  });

  it("lets block-level content interrupt a paragraph", () => {
    expect(parseBlocks("alpha\n```ts\nconst value = 1;\n```\nbeta")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "alpha" }] },
      { type: "code", lang: "ts", value: "const value = 1;" },
      { type: "paragraph", children: [{ type: "text", value: "beta" }] }
    ]);
  });

  it("strips leading frontmatter before block parsing", () => {
    expect(parseBlocks(["---", "title: Example", "---", "# Heading"].join("\n"))).toEqual([
      { type: "heading", depth: 1, children: [{ type: "text", value: "Heading" }] }
    ]);
  });
});

describe("parse", () => {
  it("returns a root node and prepends frontmatter when present", () => {
    expect(parse(["---", "title: Example", "---", "# Heading"].join("\n"))).toEqual({
      frontmatter: {
        title: "Example"
      },
      ast: {
        type: "root",
        children: [
          {
            type: "frontmatter",
            data: {
              title: "Example"
            }
          },
          {
            type: "heading",
            depth: 1,
            children: [{ type: "text", value: "Heading" }]
          }
        ]
      }
    });
  });

  it("returns a root node without frontmatter for plain markdown", () => {
    expect(parse("Body")).toEqual({
      ast: {
        type: "root",
        children: [{ type: "paragraph", children: [{ type: "text", value: "Body" }] }]
      }
    });
  });

  it("tracks source ranges for frontmatter and representative block nodes", () => {
    const markdown = [
      "---",
      "title: Demo",
      "---",
      "",
      "# Heading",
      "",
      "Paragraph text",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "- item"
    ].join("\n");
    const { ast } = parse(markdown);
    const [frontmatterNode, headingNode, paragraphNode, codeNode, listNode] = ast.children;

    expect(frontmatterNode?.range).toEqual({ start: 0, end: 20 });
    expect(headingNode?.range).toEqual({ start: 21, end: 31 });
    expect(paragraphNode?.range).toEqual({ start: 32, end: 47 });
    expect(codeNode?.range).toEqual({ start: 48, end: 71 });
    expect(listNode?.range).toEqual({ start: 72, end: 78 });

    expect(markdown.slice(frontmatterNode!.range!.start, frontmatterNode!.range!.end)).toBe(
      ["---", "title: Demo", "---", ""].join("\n")
    );
    expect(markdown.slice(headingNode!.range!.start, headingNode!.range!.end)).toBe("# Heading\n");
    expect(markdown.slice(paragraphNode!.range!.start, paragraphNode!.range!.end)).toBe(
      "Paragraph text\n"
    );
    expect(markdown.slice(codeNode!.range!.start, codeNode!.range!.end)).toBe(
      ["```ts", "const x = 1;", "```", ""].join("\n")
    );
    expect(markdown.slice(listNode!.range!.start, listNode!.range!.end)).toBe("- item");
  });

  it("uses UTF-8 byte offsets and preserves BOM alignment", () => {
    const markdown = ["\uFEFF---", "title: Hé", "---", "", "Paragraph 🌍"].join("\n");
    const expectedFrontmatter = ["\uFEFF---", "title: Hé", "---", ""].join("\n");
    const { ast } = parse(markdown);
    const [frontmatterNode, paragraphNode] = ast.children;
    const markdownBuffer = Buffer.from(markdown, "utf8");

    expect(frontmatterNode?.range).toEqual({
      start: 0,
      end: Buffer.byteLength(expectedFrontmatter, "utf8")
    });
    expect(paragraphNode?.range).toEqual({
      start: Buffer.byteLength(`${expectedFrontmatter}\n`, "utf8"),
      end: Buffer.byteLength(markdown, "utf8")
    });
    expect(ast.range).toEqual({ start: 0, end: Buffer.byteLength(markdown, "utf8") });

    expect(
      markdownBuffer
        .subarray(frontmatterNode!.range!.start, frontmatterNode!.range!.end)
        .toString("utf8")
    ).toBe(expectedFrontmatter);
    expect(
      markdownBuffer
        .subarray(paragraphNode!.range!.start, paragraphNode!.range!.end)
        .toString("utf8")
    ).toBe("Paragraph 🌍");
  });
});

describe("terminal markdown renderer", () => {
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

  it("respects width option for line wrapping (test 170)", () => {
    const ast: MdNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "alpha beta gamma delta" }]
        }
      ]
    };

    expect(stripAnsi(render(ast, { width: 10 }))).toBe("alpha beta\ngamma\ndelta\n\n");
  });

  it("heading renders with appropriate visual weight per level (test 178)", () => {
    const theme = getTheme();

    expect(
      render({
        type: "heading",
        depth: 1,
        children: [{ type: "text", value: "Heading" }]
      })
    ).toBe(`${theme.header(typography.bold("Heading"))}\n${theme.header("─".repeat(7))}\n\n`);

    expect(
      render({
        type: "heading",
        depth: 2,
        children: [{ type: "text", value: "Heading" }]
      })
    ).toBe(`${theme.header(typography.bold("Heading"))}\n\n`);

    expect(
      render({
        type: "heading",
        depth: 3,
        children: [{ type: "text", value: "Heading" }]
      })
    ).toBe(`${typography.bold("Heading")}\n\n`);

    expect(
      render({
        type: "heading",
        depth: 4,
        children: [{ type: "text", value: "Heading" }]
      })
    ).toBe(`${typography.bold("Heading")}\n\n`);

    expect(
      render({
        type: "heading",
        depth: 5,
        children: [{ type: "text", value: "Heading" }]
      })
    ).toBe(`${theme.muted(typography.bold("Heading"))}\n\n`);

    expect(
      render({
        type: "heading",
        depth: 6,
        children: [{ type: "text", value: "Heading" }]
      })
    ).toBe(`${theme.muted(typography.bold("Heading"))}\n\n`);
  });

  it("empty nodes produce no output (test 179)", () => {
    expect(render({ type: "root", children: [] })).toBe("");
    expect(render({ type: "paragraph", children: [] })).toBe("");
    expect(render({ type: "heading", depth: 2, children: [] })).toBe("");
    expect(
      render({ type: "root", children: [{ type: "frontmatter", data: { title: "Hidden" } }] })
    ).toBe("");
  });

  it("renders inline styles, code spans, and breaks", () => {
    const theme = getTheme();

    expect(
      render({
        type: "paragraph",
        children: [
          { type: "text", value: "before " },
          { type: "strong", children: [{ type: "text", value: "bold" }] },
          { type: "text", value: " " },
          { type: "emphasis", children: [{ type: "text", value: "italic" }] },
          { type: "text", value: " " },
          { type: "strikethrough", children: [{ type: "text", value: "gone" }] },
          { type: "text", value: " " },
          { type: "inlineCode", value: "code" },
          { type: "break" },
          { type: "text", value: "after" }
        ]
      })
    ).toBe(
      `before ${typography.bold("bold")} ${typography.italic("italic")} ${typography.strikethrough("gone")} ${theme.accent("code")}\nafter\n\n`
    );
  });

  it("hides frontmatter by default (test 171)", () => {
    const ast: MdNode = {
      type: "root",
      children: [
        { type: "frontmatter", data: { title: "Renderer", draft: false } },
        { type: "paragraph", children: [{ type: "text", value: "Body" }] }
      ]
    };

    expect(stripAnsi(render(ast))).toBe("Body\n\n");
  });

  it("shows frontmatter when showFrontmatter is enabled (test 172)", () => {
    const ast: MdNode = {
      type: "root",
      children: [
        { type: "frontmatter", data: { title: "Renderer", draft: false } },
        { type: "paragraph", children: [{ type: "text", value: "Body" }] }
      ]
    };

    expect(render(ast, { showFrontmatter: true })).toBe(
      `${typography.dim("title: Renderer")}\n${typography.dim("draft: false")}\n\nBody\n\n`
    );
  });

  it("renders thematic breaks to the requested width", () => {
    const theme = getTheme();

    expect(render({ type: "thematicBreak" }, { width: 5 })).toBe(
      `${theme.divider("─".repeat(5))}\n\n`
    );
  });

  it("sizes h1 underlines by visible content width", () => {
    const ast: MdNode = {
      type: "heading",
      depth: 1,
      children: [
        { type: "text", value: "Hello " },
        { type: "strong", children: [{ type: "text", value: "world" }] }
      ]
    };

    expect(stripAnsi(render(ast))).toBe("Hello world\n───────────\n\n");
  });

  it("indents nested blockquotes correctly (test 173)", () => {
    const ast: MdNode = {
      type: "blockquote",
      children: [
        {
          type: "blockquote",
          children: [{ type: "paragraph", children: [{ type: "text", value: "nested" }] }]
        }
      ]
    };

    expect(stripAnsi(render(ast))).toBe(`${symbols.bar} ${symbols.bar} nested\n\n`);
  });

  it("aligns table columns (test 174)", () => {
    const ast: MdNode = {
      type: "table",
      align: ["left", "right", "center"],
      children: [
        {
          type: "tableRow",
          children: [
            { type: "tableCell", children: [{ type: "text", value: "Name" }] },
            { type: "tableCell", children: [{ type: "text", value: "Count" }] },
            { type: "tableCell", children: [{ type: "text", value: "Status" }] }
          ]
        },
        {
          type: "tableRow",
          children: [
            { type: "tableCell", children: [{ type: "text", value: "alpha" }] },
            { type: "tableCell", children: [{ type: "text", value: "2" }] },
            { type: "tableCell", children: [{ type: "text", value: "ok" }] }
          ]
        },
        {
          type: "tableRow",
          children: [
            { type: "tableCell", children: [{ type: "text", value: "beta" }] },
            { type: "tableCell", children: [{ type: "text", value: "12" }] },
            { type: "tableCell", children: [{ type: "text", value: "busy" }] }
          ]
        }
      ]
    };

    expect(stripAnsi(render(ast))).toBe(
      `${symbols.bar} Name  ${symbols.bar} Count ${symbols.bar} Status ${symbols.bar}\n` +
        `├───────┼───────┼────────┤\n` +
        `${symbols.bar} alpha ${symbols.bar}     2 ${symbols.bar}   ok   ${symbols.bar}\n` +
        `${symbols.bar} beta  ${symbols.bar}    12 ${symbols.bar}  busy  ${symbols.bar}\n\n`
    );
  });

  it("aligns styled table cells by visible width and preserves empty trailing cells", () => {
    const ast: MdNode = {
      type: "table",
      align: ["left", "right"],
      children: [
        {
          type: "tableRow",
          children: [
            { type: "tableCell", children: [{ type: "text", value: "Label" }] },
            { type: "tableCell", children: [{ type: "text", value: "Value" }] }
          ]
        },
        {
          type: "tableRow",
          children: [
            {
              type: "tableCell",
              children: [{ type: "strong", children: [{ type: "text", value: "alpha" }] }]
            },
            { type: "tableCell", children: [{ type: "inlineCode", value: "7" }] }
          ]
        },
        {
          type: "tableRow",
          children: [{ type: "tableCell", children: [{ type: "text", value: "beta" }] }]
        }
      ]
    };

    expect(stripAnsi(render(ast))).toBe(
      `${symbols.bar} Label ${symbols.bar} Value ${symbols.bar}\n` +
        `├───────┼───────┤\n` +
        `${symbols.bar} alpha ${symbols.bar}     7 ${symbols.bar}\n` +
        `${symbols.bar} beta  ${symbols.bar}       ${symbols.bar}\n\n`
    );
  });

  it("falls back to stacked rows when a table exceeds the available width", () => {
    const ast = parse(
      [
        "| Column One | Column Two | Column Three |",
        "|---|---|---|",
        "| value 1 | value 2 | value 3 |"
      ].join("\n")
    ).ast;

    expect(stripAnsi(render(ast, { width: 40 }))).toBe(
      "Column One: value 1\nColumn Two: value 2\nColumn Three: value 3\n\n"
    );
  });

  it("styles the table header row separately from data rows", () => {
    const theme = getTheme();
    const ast: MdNode = {
      type: "table",
      align: ["left", "center", "right"],
      children: [
        {
          type: "tableRow",
          children: [
            { type: "tableCell", children: [{ type: "text", value: "Column" }] },
            { type: "tableCell", children: [{ type: "text", value: "Center" }] },
            { type: "tableCell", children: [{ type: "text", value: "Right" }] }
          ]
        },
        {
          type: "tableRow",
          children: [
            { type: "tableCell", children: [{ type: "text", value: "alpha" }] },
            { type: "tableCell", children: [{ type: "text", value: "beta" }] },
            { type: "tableCell", children: [{ type: "text", value: "42" }] }
          ]
        }
      ]
    };

    expect(render(ast)).toBe(
      `${symbols.bar} ${theme.header(typography.bold("Column"))} ${symbols.bar} ${theme.header(typography.bold("Center"))} ${symbols.bar} ${theme.header(typography.bold("Right"))} ${symbols.bar}\n` +
        `${theme.muted("├────────┼────────┼───────┤")}\n` +
        `${symbols.bar} alpha  ${symbols.bar}  beta  ${symbols.bar}    42 ${symbols.bar}\n\n`
    );
  });

  it("numbers ordered lists correctly (test 175)", () => {
    const ast: MdNode = {
      type: "list",
      ordered: true,
      start: 7,
      children: [
        {
          type: "listItem",
          children: [{ type: "paragraph", children: [{ type: "text", value: "first" }] }]
        },
        {
          type: "listItem",
          children: [{ type: "paragraph", children: [{ type: "text", value: "second" }] }]
        }
      ]
    };

    expect(stripAnsi(render(ast))).toBe(" 7. first\n 8. second\n\n");
  });

  it("code blocks render with visible boundaries (test 176)", () => {
    const theme = getTheme();

    expect(
      render({
        type: "code",
        value: "alpha\nbeta"
      })
    ).toBe(`${theme.muted(" ─────")}\n alpha\n beta\n${theme.muted(" ─────")}\n\n`);
  });

  it("renders links as text followed by a colored url (test 177)", () => {
    const theme = getTheme();

    expect(
      render({
        type: "paragraph",
        children: [
          {
            type: "link",
            url: "https://example.com",
            children: [{ type: "text", value: "docs" }]
          }
        ]
      })
    ).toBe(`docs ${theme.accent("(https://example.com)")}\n\n`);
  });

  it("normalizes trailing link label whitespace before appending the url (test 180)", () => {
    const theme = getTheme();
    const { ast } = parse("[docs ](https://example.com)");

    expect(render(ast)).toBe(`docs ${theme.accent("(https://example.com)")}\n\n`);
  });

  it("renders task lists with active and inactive symbols", () => {
    const ast: MdNode = {
      type: "list",
      ordered: false,
      children: [
        {
          type: "listItem",
          checked: true,
          children: [{ type: "paragraph", children: [{ type: "text", value: "done" }] }]
        },
        {
          type: "listItem",
          checked: false,
          children: [{ type: "paragraph", children: [{ type: "text", value: "todo" }] }]
        }
      ]
    };

    expect(stripAnsi(render(ast))).toBe(` ${symbols.active} done\n ${symbols.inactive} todo\n\n`);
  });

  it("wraps blockquotes within the available width", () => {
    const ast: MdNode = {
      type: "blockquote",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "alpha beta gamma" }]
        }
      ]
    };

    expect(stripAnsi(render(ast, { width: 10 }))).toBe(
      `${symbols.bar} alpha\n${symbols.bar} beta\n${symbols.bar} gamma\n\n`
    );
  });

  it("wraps list items within the available width", () => {
    const ast: MdNode = {
      type: "list",
      ordered: true,
      children: [
        {
          type: "listItem",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", value: "alpha beta gamma" }]
            }
          ]
        }
      ]
    };

    expect(stripAnsi(render(ast, { width: 10 }))).toBe(" 1. alpha\n    beta\n    gamma\n\n");
  });

  it("keeps nested lists attached to the parent list item", () => {
    const ast: MdNode = {
      type: "list",
      ordered: false,
      children: [
        {
          type: "listItem",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", value: "parent" }]
            },
            {
              type: "list",
              ordered: false,
              children: [
                {
                  type: "listItem",
                  children: [{ type: "paragraph", children: [{ type: "text", value: "nested" }] }]
                }
              ]
            }
          ]
        },
        {
          type: "listItem",
          children: [{ type: "paragraph", children: [{ type: "text", value: "sibling" }] }]
        }
      ]
    };

    expect(stripAnsi(render(ast))).toBe(" • parent\n    • nested\n • sibling\n\n");
  });

  it("renders autolinks as their colored destination", () => {
    const theme = getTheme();

    expect(
      render({
        type: "paragraph",
        children: [
          {
            type: "link",
            url: "https://example.com",
            children: [{ type: "text", value: "https://example.com" }]
          }
        ]
      })
    ).toBe(`${theme.accent("https://example.com")}\n\n`);
  });

  it("renders images as muted placeholders", () => {
    const theme = getTheme();

    expect(
      render({
        type: "paragraph",
        children: [{ type: "image", url: "https://example.com/image.png", alt: "Example image" }]
      })
    ).toBe(`${theme.muted("[image: Example image]")}\n\n`);
  });

  it("renders html nodes as plain text", () => {
    expect(
      stripAnsi(
        render({
          type: "root",
          children: [{ type: "html", value: "<div>Hello <strong>world</strong></div>" }]
        })
      )
    ).toBe("Hello world\n\n");
  });

  it("renders alerts with the correct label styling", () => {
    const theme = getTheme();
    const ast: MdNode = {
      type: "root",
      children: [
        {
          type: "alert",
          kind: "NOTE",
          children: [{ type: "paragraph", children: [{ type: "text", value: "Read this" }] }]
        },
        {
          type: "alert",
          kind: "TIP",
          children: [{ type: "paragraph", children: [{ type: "text", value: "Try this" }] }]
        },
        {
          type: "alert",
          kind: "IMPORTANT",
          children: [{ type: "paragraph", children: [{ type: "text", value: "Remember this" }] }]
        },
        {
          type: "alert",
          kind: "WARNING",
          children: [{ type: "paragraph", children: [{ type: "text", value: "Watch out" }] }]
        },
        {
          type: "alert",
          kind: "CAUTION",
          children: [{ type: "paragraph", children: [{ type: "text", value: "Stop here" }] }]
        }
      ]
    };

    expect(render(ast)).toBe(
      `${symbols.bar} ${theme.info("Note")}\n${symbols.bar} Read this\n\n` +
        `${symbols.bar} ${theme.success("Tip")}\n${symbols.bar} Try this\n\n` +
        `${symbols.bar} ${theme.info("Important")}\n${symbols.bar} Remember this\n\n` +
        `${symbols.bar} ${theme.warning("Warning")}\n${symbols.bar} Watch out\n\n` +
        `${symbols.bar} ${theme.error("Caution")}\n${symbols.bar} Stop here\n\n`
    );
  });

  it("renders numbered footnote references inline and definitions at the bottom", () => {
    const { ast } = parse(
      [
        "Intro[^beta] then[^alpha] and again[^beta].",
        "",
        "[^alpha]: First footnote",
        "[^beta]: Second footnote"
      ].join("\n")
    );

    expect(render(ast)).toBe(
      `Intro${typography.dim("[1]")} then${typography.dim("[2]")} and again${typography.dim("[1]")}.\n\n` +
        ` ${typography.dim("[1]")} Second footnote\n` +
        ` ${typography.dim("[2]")} First footnote\n\n`
    );
  });

  it("renders footnotes discovered while rendering earlier footnote definitions", () => {
    const { ast } = parse(
      ["Intro[^alpha].", "", "[^alpha]: First[^beta]", "[^beta]: Second footnote"].join("\n")
    );

    expect(render(ast)).toBe(
      `Intro${typography.dim("[1]")}.\n\n` +
        ` ${typography.dim("[1]")} First${typography.dim("[2]")}\n` +
        ` ${typography.dim("[2]")} Second footnote\n\n`
    );
  });
});
