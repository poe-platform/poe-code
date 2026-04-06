import { describe, expect, it } from "vitest";
import { symbols } from "../components/symbols.js";
import { stripAnsi } from "../internal/strip-ansi.js";
import { parse, render, renderMarkdown } from "./index.js";

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

  it("renders malformed markdown inputs as readable literal output without crashing", () => {
    expect(() => renderMarkdown("```js\nconst x = 1;\nno closing fence")).not.toThrow();
    expect(stripAnsi(renderMarkdown("```js\nconst x = 1;\nno closing fence"))).toContain(
      " const x = 1;\n no closing fence\n"
    );

    expect(
      stripAnsi(renderMarkdown("This has *unclosed emphasis and **unclosed strong"))
    ).toBe("This has *unclosed emphasis and **unclosed strong\n\n");

    expect(stripAnsi(renderMarkdown("[broken link(no close paren"))).toBe(
      "[broken link(no close paren\n\n"
    );
  });

  it("returns empty output for empty or whitespace-only documents", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("   \n\n  \n")).toBe("");
  });

  it("preserves unicode content and nested blockquote prefixes", () => {
    const unicodeOutput = stripAnsi(renderMarkdown("# 你好世界 🌍\n\nParagraph with émojis 🎉 and ñ"));
    expect(unicodeOutput).toContain("你好世界 🌍\n");
    expect(unicodeOutput).toContain("Paragraph with émojis 🎉 and ñ\n\n");

    expect(stripAnsi(renderMarkdown("> > > > deeply nested\n> > > > blockquote"))).toBe(
      `${symbols.bar} ${symbols.bar} ${symbols.bar} ${symbols.bar} deeply nested\n${symbols.bar} ${symbols.bar} ${symbols.bar} ${symbols.bar} blockquote\n\n`
    );
  });

  it("renders long fenced code blocks completely", () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`);
    const markdown = ["```txt", ...lines, "```"].join("\n");
    const output = stripAnsi(renderMarkdown(markdown));

    expect(output).toContain(" line 1\n");
    expect(output).toContain(" line 100\n");
  });
});
