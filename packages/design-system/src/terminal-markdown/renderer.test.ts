import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { symbols } from "../components/symbols.js";
import { resetThemeCache, getTheme } from "../internal/theme-detect.js";
import { stripAnsi } from "../internal/strip-ansi.js";
import { typography } from "../tokens/typography.js";
import type { MdNode } from "./ast.js";
import { render } from "./renderer.js";

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
    expect(render({ type: "root", children: [{ type: "frontmatter", data: { title: "Hidden" } }] })).toBe(
      ""
    );
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

  it("renders frontmatter only when enabled", () => {
    const ast: MdNode = {
      type: "root",
      children: [
        { type: "frontmatter", data: { title: "Renderer", draft: false } },
        { type: "paragraph", children: [{ type: "text", value: "Body" }] }
      ]
    };

    expect(stripAnsi(render(ast))).toBe("Body\n\n");
    expect(stripAnsi(render(ast, { showFrontmatter: true }))).toBe(
      "Frontmatter\n title: Renderer\n draft: false\n\nBody\n\n"
    );
  });

  it("renders thematic breaks to the requested width", () => {
    const theme = getTheme();

    expect(render({ type: "thematicBreak" }, { width: 5 })).toBe(`${theme.divider("─".repeat(5))}\n\n`);
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

    expect(stripAnsi(render(ast, { width: 10 }))).toBe(`${symbols.bar} alpha\n${symbols.bar} beta\n${symbols.bar} gamma\n\n`);
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
});
