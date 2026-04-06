import type { MdNode } from "./ast.js";
import { parseBlockDocument } from "./parser/block.js";

export function parse(markdown: string): { frontmatter?: Record<string, unknown>; ast: MdNode } {
  const { frontmatter, children } = parseBlockDocument(markdown);

  return {
    ...(frontmatter === undefined ? {} : { frontmatter }),
    ast: {
      type: "root",
      children:
        frontmatter === undefined
          ? children
          : [{ type: "frontmatter", data: frontmatter }, ...children]
    }
  };
}
