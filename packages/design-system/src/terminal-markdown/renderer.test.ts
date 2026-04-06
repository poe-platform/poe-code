import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
