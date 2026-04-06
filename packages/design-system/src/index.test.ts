import { describe, expect, expectTypeOf, it } from "vitest";
import { parse, render, renderMarkdown, type MdNode, type RenderOptions } from "./index.js";

describe("design-system root exports", () => {
  it("re-exports terminal markdown helpers", () => {
    expect(renderMarkdown("# Heading")).toBe(render(parse("# Heading").ast));
  });

  it("re-exports renderMarkdown with render options intact", () => {
    const markdown = ["---", "title: Heading", "---", "", "Body text"].join("\n");

    expect(renderMarkdown(markdown, { showFrontmatter: true })).toBe(
      render(parse(markdown).ast, { showFrontmatter: true })
    );
  });

  it("re-exports terminal markdown types", () => {
    expectTypeOf<MdNode>().toMatchTypeOf<{ type: string }>();
    expectTypeOf<RenderOptions>().toMatchTypeOf<{
      width?: number;
      showFrontmatter?: boolean;
    }>();
  });
});
