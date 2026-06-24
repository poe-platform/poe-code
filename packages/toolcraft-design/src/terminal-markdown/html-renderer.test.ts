import { describe, expect, expectTypeOf, it } from "vitest";
import { parse, render, renderHtml, renderMarkdown, renderMarkdownHtml } from "./index.js";
import type { HtmlRenderOptions } from "./html-renderer.js";

describe("terminal markdown html renderer", () => {
  it("renders headings, paragraphs, inline styles, and code without changing terminal output", () => {
    const markdown = [
      "# Status",
      "",
      "Ready with **strong**, *emphasis*, ~~old~~, and `poe-code configure`."
    ].join("\n");
    const terminalOutput = renderMarkdown(markdown);

    expect(renderMarkdownHtml(markdown)).toBe(
      [
        "<h1>Status</h1>",
        "<p>Ready with <strong>strong</strong>, <em>emphasis</em>, <del>old</del>, and <code>poe-code configure</code>.</p>"
      ].join("\n")
    );
    expect(renderMarkdown(markdown)).toBe(terminalOutput);
  });

  it("renders links, images, fenced code, blockquotes, alerts, thematic breaks, and breaks", () => {
    const markdown = [
      "[Docs](https://example.com/docs \"Read docs\") and ![Diagram](/assets/diagram.png \"System\")",
      "line one  ",
      "line two",
      "",
      "> Quote with <span>escaped html</span>",
      "",
      "> [!WARNING]",
      "> Check config.",
      "",
      "```ts",
      'const value = "<safe>";',
      "```",
      "",
      "---"
    ].join("\n");

    expect(renderMarkdownHtml(markdown)).toBe(
      [
        '<p><a href="https://example.com/docs" title="Read docs">Docs</a> and <img src="/assets/diagram.png" alt="Diagram" title="System">\nline one<br>line two</p>',
        "<blockquote><p>Quote with &lt;span&gt;escaped html&lt;/span&gt;</p></blockquote>",
        '<blockquote data-alert="WARNING"><p>Check config.</p></blockquote>',
        '<pre><code class="language-ts">const value = &quot;&lt;safe&gt;&quot;;</code></pre>',
        "<hr>"
      ].join("\n")
    );
  });

  it("renders ordered, unordered, nested, and task lists", () => {
    const markdown = [
      "3. ordered",
      "4. next",
      "",
      "- plain",
      "- [x] complete",
      "- [ ] pending",
      "  - nested"
    ].join("\n");

    expect(renderMarkdownHtml(markdown)).toBe(
      [
        '<ol start="3"><li>ordered</li><li>next</li></ol>',
        '<ul><li>plain</li><li><input type="checkbox" disabled checked> complete</li><li><input type="checkbox" disabled> pending<ul><li>nested</li></ul></li></ul>'
      ].join("\n")
    );
  });

  it("renders tables with a table head and body", () => {
    const markdown = [
      "| Feature | Status | Count |",
      "| :------ | :----: | ----: |",
      "| HTML | ready | 2 |"
    ].join("\n");

    expect(renderMarkdownHtml(markdown)).toBe(
      [
        "<table>",
        "<thead><tr><th style=\"text-align: left\">Feature</th><th style=\"text-align: center\">Status</th><th style=\"text-align: right\">Count</th></tr></thead>",
        "<tbody><tr><td style=\"text-align: left\">HTML</td><td style=\"text-align: center\">ready</td><td style=\"text-align: right\">2</td></tr></tbody>",
        "</table>"
      ].join("\n")
    );
  });

  it("renders footnotes as a trailing section in first-reference order", () => {
    const markdown = [
      "Second first[^b], then first[^a].",
      "",
      "[^a]: Alpha note.",
      "[^b]: Beta **note**."
    ].join("\n");

    expect(renderMarkdownHtml(markdown)).toBe(
      [
        '<p>Second first<sup id="fnref-b"><a href="#fn-b">1</a></sup>, then first<sup id="fnref-a"><a href="#fn-a">2</a></sup>.</p>',
        '<section class="footnotes"><ol><li id="fn-b"><p>Beta <strong>note</strong>.</p> <a href="#fnref-b" aria-label="Back to content">Back</a></li><li id="fn-a"><p>Alpha note.</p> <a href="#fnref-a" aria-label="Back to content">Back</a></li></ol></section>'
      ].join("\n")
    );
  });

  it("hides frontmatter by default and renders it as yaml code when requested", () => {
    const markdown = ["---", "title: Demo", "draft: false", "---", "", "Body"].join("\n");

    expect(renderMarkdownHtml(markdown)).toBe("<p>Body</p>");
    expect(renderMarkdownHtml(markdown, { showFrontmatter: true })).toBe(
      [
        '<pre><code class="language-yaml">title: Demo',
        "draft: false</code></pre>",
        "<p>Body</p>"
      ].join("\n")
    );
  });

  it("escapes raw html by default and allows raw html only when requested", () => {
    const markdown = [
      "<section>",
      "<script>alert(1)</script>",
      "</section>",
      "",
      "Inline <span>safe?</span>"
    ].join("\n");

    expect(renderMarkdownHtml(markdown)).toBe(
      [
        "&lt;section&gt;",
        "&lt;script&gt;alert(1)&lt;/script&gt;",
        "&lt;/section&gt;",
        "<p>Inline &lt;span&gt;safe?&lt;/span&gt;</p>"
      ].join("\n")
    );
    expect(renderMarkdownHtml(markdown, { allowRawHtml: true })).toBe(
      ["<section>", "<script>alert(1)</script>", "</section>", "<p>Inline <span>safe?</span></p>"].join(
        "\n"
      )
    );
  });

  it("omits unsafe link and image URLs while preserving content and alt text", () => {
    const markdown = [
      "[safe](../docs/readme.md) [anchor](#top) [bad](javascript:alert(1))",
      "![bad image](javascript:alert(1)) ![safe image](./img.png)"
    ].join("\n");

    expect(renderMarkdownHtml(markdown)).toBe(
      '<p><a href="../docs/readme.md">safe</a> <a href="#top">anchor</a> <a>bad</a>\n<img alt="bad image"> <img src="./img.png" alt="safe image"></p>'
    );
  });

  it("preserves unicode and degrades malformed markdown as literal text", () => {
    expect(renderMarkdownHtml("# 你好世界 🌍\n\nEmoji 🎉 and ñ")).toBe(
      "<h1>你好世界 🌍</h1>\n<p>Emoji 🎉 and ñ</p>"
    );
    expect(renderMarkdownHtml("This has *unclosed emphasis and **unclosed strong")).toBe(
      "<p>This has *unclosed emphasis and **unclosed strong</p>"
    );
    expect(renderMarkdownHtml("[broken link(no close paren")).toBe(
      "<p>[broken link(no close paren</p>"
    );
  });

  it("returns empty output for empty markdown and renders AST-first callers", () => {
    const { ast } = parse("# Status");

    expect(renderMarkdownHtml("")).toBe("");
    expect(renderHtml(ast)).toBe("<h1>Status</h1>");
    expect(render(ast)).toBe(renderMarkdown("# Status"));
  });

  it("renders cyclic frontmatter values without throwing", () => {
    const metadata: { self?: unknown } = {};
    metadata.self = metadata;

    expect(() =>
      renderHtml(
        {
          type: "root",
          children: [{ type: "frontmatter", data: { metadata } }]
        },
        { showFrontmatter: true }
      )
    ).not.toThrow();
    expect(
      renderHtml(
        {
          type: "root",
          children: [{ type: "frontmatter", data: { metadata } }]
        },
        { showFrontmatter: true }
      )
    ).toContain('{&quot;self&quot;:&quot;[Circular]&quot;}');
  });

  it("exports html render options", () => {
    expectTypeOf<HtmlRenderOptions>().toEqualTypeOf<{
      showFrontmatter?: boolean;
      allowRawHtml?: boolean;
    }>();
  });
});
