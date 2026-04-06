import { describe, expect, expectTypeOf, it } from "vitest";
import type { MdNode } from "./index.js";

type NodeOf<TType extends MdNode["type"]> = Extract<MdNode, { type: TType }>;

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
