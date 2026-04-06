import { describe, expect, it } from "vitest";
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
});
