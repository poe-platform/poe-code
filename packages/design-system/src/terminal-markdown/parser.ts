import type { MdNode, MdRange } from "./ast.js";
import { parseBlockDocument } from "./parser/block.js";

export function parse(markdown: string): { frontmatter?: Record<string, unknown>; ast: MdNode } {
  const { frontmatter, frontmatterRange, children } = parseBlockDocument(markdown);
  const ast = withRange(
    {
      type: "root",
      children:
        frontmatter === undefined
          ? children
          : [createFrontmatterNode(frontmatter, frontmatterRange), ...children]
    },
    {
      start: 0,
      end: Buffer.byteLength(markdown, "utf8")
    }
  );

  return {
    ...(frontmatter === undefined ? {} : { frontmatter }),
    ast
  };
}

function createFrontmatterNode(data: Record<string, unknown>, range?: MdRange): Extract<
  MdNode,
  { type: "frontmatter" }
> {
  const node: Extract<MdNode, { type: "frontmatter" }> = {
    type: "frontmatter",
    data
  };

  if (range === undefined) {
    return node;
  }

  Object.defineProperty(node, "range", {
    value: range,
    enumerable: false,
    configurable: true,
    writable: true
  });

  return node;
}

function withRange<T extends MdNode>(node: T, range: MdRange): T {
  Object.defineProperty(node, "range", {
    value: range,
    enumerable: false,
    configurable: true,
    writable: true
  });

  return node;
}
