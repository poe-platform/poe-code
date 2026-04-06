import { describe, expect, expectTypeOf, it } from "vitest";
import type { MdNode } from "./index.js";
import { parseBlocks } from "./parser/block.js";

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
    expect(parseBlocks("```json\n{\n  \"key\": true\n}\n\ntrailing text")).toEqual([
      {
        type: "code",
        lang: "json",
        value: "{\n  \"key\": true\n}\n\ntrailing text"
      }
    ]);
  });

  it("allows closing fences with trailing spaces", () => {
    expect(parseBlocks("```\nvalue\n```   ")).toEqual([{ type: "code", value: "value" }]);
  });

  it("normalizes BOM and CRLF input while parsing blocks", () => {
    expect(parseBlocks("\uFEFF```ts title=demo\r\nconst value = 1;\r\n```\r\n\r\nnext\r\n")).toEqual([
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

  it("keeps ATX heading content as raw text for inline formatting placeholders", () => {
    expect(parseBlocks("## Hello *world*")).toEqual([
      { type: "heading", depth: 2, children: [{ type: "text", value: "Hello *world*" }] }
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
      parseBlocks(
        "> ## heading\n>\n> - first\n> - second\n>\n> ```ts\n> const value = 1;\n> ```"
      )
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
                    children: [
                      { type: "paragraph", children: [{ type: "text", value: "child" }] }
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
                    children: [
                      { type: "paragraph", children: [{ type: "text", value: "child" }] }
                    ]
                  },
                  {
                    type: "listItem",
                    children: [
                      { type: "paragraph", children: [{ type: "text", value: "second" }] }
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

  it("leaves inline formatting inside task list items as raw text for now (spec test 77)", () => {
    expect(parseBlocks("- [x] *done*")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            checked: true,
            children: [{ type: "paragraph", children: [{ type: "text", value: "*done*" }] }]
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
                    children: [
                      { type: "paragraph", children: [{ type: "text", value: "child" }] }
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
                    children: [
                      { type: "paragraph", children: [{ type: "text", value: "child" }] }
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
});
