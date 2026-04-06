import { describe, expect, expectTypeOf, it } from "vitest";
import type { MdNode } from "./index.js";
import { parseBlocks } from "./parser/block.js";
import { parseInline } from "./parser/inline.js";

type NodeOf<TType extends MdNode["type"]> = Extract<MdNode, { type: TType }>;

function createTableCell(value: string): MdNode {
  return {
    type: "tableCell",
    children: value.length === 0 ? [] : [{ type: "text", value }]
  };
}

function createTableRow(...values: string[]): MdNode {
  return {
    type: "tableRow",
    children: values.map((value) => createTableCell(value))
  };
}

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

describe("parseInline", () => {
  it("returns a single text node for plain inline text", () => {
    expect(parseInline("plain text")).toEqual([{ type: "text", value: "plain text" }]);
  });

  it("parses backslash escapes for markdown punctuation (tests 48-49)", () => {
    expect(parseInline("\\[link\\] and \\`code\\`")).toEqual([
      { type: "text", value: "[link] and `code`" }
    ]);
  });

  it("parses single-backtick inline code without trimming spaces (test 38)", () => {
    expect(parseInline("before `  code  ` after")).toEqual([
      { type: "text", value: "before " },
      { type: "inlineCode", value: "  code  " },
      { type: "text", value: " after" }
    ]);
  });

  it("parses double-backtick inline code and keeps inner markdown literal (tests 39-40)", () => {
    expect(parseInline("``**bold** `code` ``")).toEqual([
      { type: "inlineCode", value: "**bold** `code` " }
    ]);
  });

  it("parses links, images, and autolinks (tests 41-46)", () => {
    expect(
      parseInline(
        '[link](https://example.com "Example") ![alt](https://example.com/image.png "Image") <https://example.com>'
      )
    ).toEqual([
      {
        type: "link",
        url: "https://example.com",
        title: "Example",
        children: [{ type: "text", value: "link" }]
      },
      { type: "text", value: " " },
      {
        type: "image",
        url: "https://example.com/image.png",
        alt: "alt",
        title: "Image"
      },
      { type: "text", value: " " },
      {
        type: "link",
        url: "https://example.com",
        children: [{ type: "text", value: "https://example.com" }]
      }
    ]);
  });

  it("supports empty link text and recursive parsing in link children (tests 43, 47)", () => {
    expect(parseInline('[](https://example.com) [see `code`](/docs)')).toEqual([
      { type: "link", url: "https://example.com", children: [] },
      { type: "text", value: " " },
      {
        type: "link",
        url: "/docs",
        children: [{ type: "text", value: "see " }, { type: "inlineCode", value: "code" }]
      }
    ]);
  });

  it("treats malformed links with missing closers as literal text", () => {
    expect(parseInline("[text")).toEqual([{ type: "text", value: "[text" }]);
    expect(parseInline("[text](https://example.com")).toEqual([
      { type: "text", value: "[text](https://example.com" }
    ]);
  });

  it("treats unclosed link syntax as literal text and supports empty destinations (tests 119-122)", () => {
    expect(parseInline("[text]( [text](url [text]() ![]()")).toEqual([
      {
        type: "text",
        value: "[text]( [text](url "
      },
      { type: "link", url: "", children: [{ type: "text", value: "text" }] },
      { type: "text", value: " " },
      { type: "image", url: "", alt: "" }
    ]);
  });

  it("preserves escaped punctuation inside labels, alt text, and destinations", () => {
    expect(parseInline(String.raw`[a\]b](https://example.com/a\)) ![\[alt\]](img\))`)).toEqual([
      {
        type: "link",
        url: "https://example.com/a)",
        children: [{ type: "text", value: "a]b" }]
      },
      { type: "text", value: " " },
      {
        type: "image",
        url: "img)",
        alt: "[alt]"
      }
    ]);
  });

  it("preserves spaces and balanced parentheses in link destinations (tests 149-150)", () => {
    expect(
      parseInline("[spacey](https://example.com/a path) [paren](https://example.com/a_(b))")
    ).toEqual([
      {
        type: "link",
        url: "https://example.com/a path",
        children: [{ type: "text", value: "spacey" }]
      },
      { type: "text", value: " " },
      {
        type: "link",
        url: "https://example.com/a_(b)",
        children: [{ type: "text", value: "paren" }]
      }
    ]);
  });

  it("parses inline HTML tags as html nodes (test 53)", () => {
    expect(parseInline("<kbd>Ctrl</kbd> + <br/>")).toEqual([
      { type: "html", value: "<kbd>" },
      { type: "text", value: "Ctrl" },
      { type: "html", value: "</kbd>" },
      { type: "text", value: " + " },
      { type: "html", value: "<br/>" }
    ]);
  });

  it("parses emphasis and strong with asterisks and underscores (tests 31-34)", () => {
    expect(parseInline("*em* _em_ **strong** __strong__")).toEqual([
      { type: "emphasis", children: [{ type: "text", value: "em" }] },
      { type: "text", value: " " },
      { type: "emphasis", children: [{ type: "text", value: "em" }] },
      { type: "text", value: " " },
      { type: "strong", children: [{ type: "text", value: "strong" }] },
      { type: "text", value: " " },
      { type: "strong", children: [{ type: "text", value: "strong" }] }
    ]);
  });

  it("parses nested delimiter combinations requested by the inline spec cases", () => {
    expect(parseInline("***both***")).toEqual([
      {
        type: "emphasis",
        children: [{ type: "strong", children: [{ type: "text", value: "both" }] }]
      }
    ]);

    expect(parseInline("*foo **bar** baz*")).toEqual([
      {
        type: "emphasis",
        children: [
          { type: "text", value: "foo " },
          { type: "strong", children: [{ type: "text", value: "bar" }] },
          { type: "text", value: " baz" }
        ]
      }
    ]);
  });

  it("applies asterisk emphasis inside words but not underscore emphasis (tests 36-37)", () => {
    expect(parseInline("foo*bar*baz")).toEqual([
      { type: "text", value: "foo" },
      { type: "emphasis", children: [{ type: "text", value: "bar" }] },
      { type: "text", value: "baz" }
    ]);

    expect(parseInline("foo_bar_baz")).toEqual([{ type: "text", value: "foo_bar_baz" }]);
  });

  it("parses emphasis across line boundaries and next to punctuation (tests 54, 151)", () => {
    expect(parseInline("*foo\nbar*")).toEqual([
      { type: "emphasis", children: [{ type: "text", value: "foo\nbar" }] }
    ]);

    expect(parseInline("\"*hello*\"")).toEqual([
      { type: "text", value: "\"" },
      { type: "emphasis", children: [{ type: "text", value: "hello" }] },
      { type: "text", value: "\"" }
    ]);
  });

  it("treats invalid or unresolved delimiter runs as literal text (tests 116-118, 123-124, 144)", () => {
    expect(parseInline("*hello")).toEqual([{ type: "text", value: "*hello" }]);
    expect(parseInline("**hello")).toEqual([{ type: "text", value: "**hello" }]);
    expect(parseInline("~~hello")).toEqual([{ type: "text", value: "~~hello" }]);
    expect(parseInline("* spaced *")).toEqual([{ type: "text", value: "* spaced *" }]);
    expect(parseInline("*foo **bar")).toEqual([{ type: "text", value: "*foo **bar" }]);
    expect(parseInline("*hello_")).toEqual([{ type: "text", value: "*hello_" }]);
  });

  it("parses strikethrough with double tildes (test 52)", () => {
    expect(parseInline("~~deleted~~")).toEqual([
      { type: "strikethrough", children: [{ type: "text", value: "deleted" }] }
    ]);
  });

  it("does not cross emphasis delimiters across mismatched runs", () => {
    expect(parseInline("*foo _bar* baz_")).toEqual([
      { type: "emphasis", children: [{ type: "text", value: "foo _bar" }] },
      { type: "text", value: " baz_" }
    ]);

    expect(parseInline("_a *b_ c*")).toEqual([
      { type: "emphasis", children: [{ type: "text", value: "a *b" }] },
      { type: "text", value: " c*" }
    ]);

    expect(parseInline("*foo __bar* baz__")).toEqual([
      { type: "emphasis", children: [{ type: "text", value: "foo __bar" }] },
      { type: "text", value: " baz__" }
    ]);

    expect(parseInline("__foo *bar__ baz*")).toEqual([
      { type: "strong", children: [{ type: "text", value: "foo *bar" }] },
      { type: "text", value: " baz*" }
    ]);
  });

  it("does not cross strikethrough delimiters over emphasis", () => {
    expect(parseInline("*a ~~b* c~~")).toEqual([
      { type: "emphasis", children: [{ type: "text", value: "a ~~b" }] },
      { type: "text", value: " c~~" }
    ]);

    expect(parseInline("~~a *b~~ c*")).toEqual([
      { type: "strikethrough", children: [{ type: "text", value: "a *b" }] },
      { type: "text", value: " c*" }
    ]);
  });

  it("parses footnote references only when the definition label exists (tests 103, 106, 108, 138)", () => {
    expect(parseInline("See [^note] and [^missing].", { footnoteLabels: new Set(["note"]) })).toEqual(
      [
        { type: "text", value: "See " },
        { type: "footnoteReference", label: "note" },
        { type: "text", value: " and [^missing]." }
      ]
    );
  });

  it("parses bare URL and email autolink literals (tests 110-113)", () => {
    expect(
      parseInline("https://example.com http://example.com www.example.com user@example.com")
    ).toEqual([
      {
        type: "link",
        url: "https://example.com",
        children: [{ type: "text", value: "https://example.com" }]
      },
      { type: "text", value: " " },
      {
        type: "link",
        url: "http://example.com",
        children: [{ type: "text", value: "http://example.com" }]
      },
      { type: "text", value: " " },
      {
        type: "link",
        url: "http://www.example.com",
        children: [{ type: "text", value: "www.example.com" }]
      },
      { type: "text", value: " " },
      {
        type: "link",
        url: "mailto:user@example.com",
        children: [{ type: "text", value: "user@example.com" }]
      }
    ]);
  });

  it("trims trailing punctuation from literal autolinks but keeps balanced delimiters", () => {
    expect(parseInline("See www.example.com, https://example.com/path(ok). and user@example.com."))
      .toEqual([
        { type: "text", value: "See " },
        {
          type: "link",
          url: "http://www.example.com",
          children: [{ type: "text", value: "www.example.com" }]
        },
        { type: "text", value: ", " },
        {
          type: "link",
          url: "https://example.com/path(ok)",
          children: [{ type: "text", value: "https://example.com/path(ok)" }]
        },
        { type: "text", value: ". and " },
        {
          type: "link",
          url: "mailto:user@example.com",
          children: [{ type: "text", value: "user@example.com" }]
        },
        { type: "text", value: "." }
      ]);
  });

  it("does not trigger literal autolinks inside code spans or links (test 114)", () => {
    expect(parseInline("`https://example.com` [www.example.com](https://outer.test)")).toEqual([
      { type: "inlineCode", value: "https://example.com" },
      { type: "text", value: " " },
      {
        type: "link",
        url: "https://outer.test",
        children: [{ type: "text", value: "www.example.com" }]
      }
    ]);
  });

  it("parses hard line breaks from trailing spaces and backslashes (tests 50-51)", () => {
    expect(parseInline("alpha  \nbeta\\\ngamma\ndelta")).toEqual([
      { type: "text", value: "alpha" },
      { type: "break" },
      { type: "text", value: "beta" },
      { type: "break" },
      { type: "text", value: "gamma\ndelta" }
    ]);
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

  it("applies inline parsing inside ATX headings", () => {
    expect(parseBlocks("## Hello *world*")).toEqual([
      {
        type: "heading",
        depth: 2,
        children: [
          { type: "text", value: "Hello " },
          { type: "emphasis", children: [{ type: "text", value: "world" }] }
        ]
      }
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

  it("parses block-level HTML content as an html node", () => {
    expect(parseBlocks("<div>\nalpha\n</div>\n\nbeta")).toEqual([
      { type: "html", value: "<div>\nalpha\n</div>" },
      { type: "paragraph", children: [{ type: "text", value: "beta" }] }
    ]);
  });

  it("renders HTML-like content with an invalid tag name as text (test 136)", () => {
    expect(parseBlocks("<not a tag>")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "<not a tag>" }] }
    ]);
  });

  it("parses a simple 2-column GFM pipe table (test 56)", () => {
    expect(parseBlocks("| Name | Value |\n| --- | --- |\n| alpha | beta |")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("Name", "Value"), createTableRow("alpha", "beta")]
      }
    ]);
  });

  it("parses table alignment from the separator row (test 57)", () => {
    expect(
      parseBlocks("| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |")
    ).toEqual([
      {
        type: "table",
        align: ["left", "center", "right"],
        children: [createTableRow("Left", "Center", "Right"), createTableRow("a", "b", "c")]
      }
    ]);
  });

  it("applies inline parsing inside table cells (test 58)", () => {
    expect(parseBlocks("| Name | Notes |\n| --- | --- |\n| *alpha* | `beta` and **gamma** |"))
      .toEqual([
        {
          type: "table",
          align: [null, null],
          children: [
            createTableRow("Name", "Notes"),
            {
              type: "tableRow",
              children: [
                {
                  type: "tableCell",
                  children: [{ type: "emphasis", children: [{ type: "text", value: "alpha" }] }]
                },
                {
                  type: "tableCell",
                  children: [
                    { type: "inlineCode", value: "beta" },
                    { type: "text", value: " and " },
                    { type: "strong", children: [{ type: "text", value: "gamma" }] }
                  ]
                }
              ]
            }
          ]
        }
      ]);
  });

  it("parses empty cells in GFM pipe tables (test 59)", () => {
    expect(parseBlocks("| A | B | C |\n| --- | --- | --- |\n| | mid | |")).toEqual([
      {
        type: "table",
        align: [null, null, null],
        children: [createTableRow("A", "B", "C"), createTableRow("", "mid", "")]
      }
    ]);
  });

  it("pads short rows to the header column count (test 60)", () => {
    expect(parseBlocks("| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |")).toEqual([
      {
        type: "table",
        align: [null, null, null],
        children: [createTableRow("A", "B", "C"), createTableRow("1", "2", "")]
      }
    ]);
  });

  it("unescapes escaped pipes inside cells (test 61)", () => {
    expect(parseBlocks("| A | B |\n| --- | --- |\n| left \\| right | keep |")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("A", "B"), createTableRow("left | right", "keep")]
      }
    ]);
  });

  it("does not parse a pipe table without an alignment row (test 62)", () => {
    expect(parseBlocks("| A | B |\n| C | D |")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "| A | B |\n| C | D |" }] }
    ]);
  });

  it("parses a minimal table with a header, separator, and one row (test 63)", () => {
    expect(parseBlocks("A | B\n--- | ---\nC | D")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("A", "B"), createTableRow("C", "D")]
      }
    ]);
  });

  it("parses tables with leading and trailing pipes (test 64)", () => {
    expect(parseBlocks("| A | B |\n| --- | --- |\n| C | D |")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("A", "B"), createTableRow("C", "D")]
      }
    ]);
  });

  it("parses tables without leading or trailing pipes (test 65)", () => {
    expect(parseBlocks("A | B\n--- | ---\nC | D")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("A", "B"), createTableRow("C", "D")]
      }
    ]);
  });

  it("pads and truncates inconsistent row widths to match the header (test 127)", () => {
    expect(parseBlocks("| A | B |\n| --- | --- |\n| one | two | three |\n| solo |")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [
          createTableRow("A", "B"),
          createTableRow("one", "two"),
          createTableRow("solo", "")
        ]
      }
    ]);
  });

  it("parses header-only tables without requiring data rows (test 128)", () => {
    expect(parseBlocks("| A | B |\n| --- | --- |")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("A", "B")]
      }
    ]);
  });

  it("does not parse tables with invalid separator rows (test 129)", () => {
    expect(parseBlocks("| A | B |\n| --- | nope |\n| C | D |")).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", value: "| A | B |\n| --- | nope |\n| C | D |" }]
      }
    ]);
  });

  it("stops a table before a following blockquote that contains pipes", () => {
    expect(parseBlocks("| A | B |\n| --- | --- |\n> quoted | row")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("A", "B")]
      },
      {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "quoted | row" }]
          }
        ]
      }
    ]);
  });

  it("stops a table before a following heading that contains pipes", () => {
    expect(parseBlocks("| A | B |\n| --- | --- |\n# heading | pipe")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("A", "B")]
      },
      {
        type: "heading",
        depth: 1,
        children: [{ type: "text", value: "heading | pipe" }]
      }
    ]);
  });

  it("stops a table before a following list item that contains pipes", () => {
    expect(parseBlocks("| A | B |\n| --- | --- |\n- item | value")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [createTableRow("A", "B")]
      },
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", value: "item | value" }]
              }
            ]
          }
        ]
      }
    ]);
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

  it("parses NOTE alerts before regular blockquotes (test 95)", () => {
    expect(parseBlocks("> [!NOTE]\n> alpha")).toEqual([
      {
        type: "alert",
        kind: "NOTE",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      }
    ]);
  });

  it("parses TIP alerts before regular blockquotes (test 96)", () => {
    expect(parseBlocks("> [!TIP]\n> alpha")).toEqual([
      {
        type: "alert",
        kind: "TIP",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      }
    ]);
  });

  it("parses IMPORTANT alerts before regular blockquotes (test 97)", () => {
    expect(parseBlocks("> [!IMPORTANT]\n> alpha")).toEqual([
      {
        type: "alert",
        kind: "IMPORTANT",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      }
    ]);
  });

  it("parses WARNING alerts before regular blockquotes (test 98)", () => {
    expect(parseBlocks("> [!WARNING]\n> alpha")).toEqual([
      {
        type: "alert",
        kind: "WARNING",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      }
    ]);
  });

  it("parses CAUTION alerts before regular blockquotes (test 99)", () => {
    expect(parseBlocks("> [!CAUTION]\n> alpha")).toEqual([
      {
        type: "alert",
        kind: "CAUTION",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      }
    ]);
  });

  it("parses multi-line alert content as nested blocks (test 100)", () => {
    expect(parseBlocks("> [!NOTE]\n> alpha\n>\n> beta")).toEqual([
      {
        type: "alert",
        kind: "NOTE",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "alpha" }] },
          { type: "paragraph", children: [{ type: "text", value: "beta" }] }
        ]
      }
    ]);
  });

  it("applies inline parsing inside alerts (test 101)", () => {
    expect(parseBlocks("> [!TIP]\n> use *care* and `focus`")).toEqual([
      {
        type: "alert",
        kind: "TIP",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "use " },
              { type: "emphasis", children: [{ type: "text", value: "care" }] },
              { type: "text", value: " and " },
              { type: "inlineCode", value: "focus" }
            ]
          }
        ]
      }
    ]);
  });

  it("parses nested block elements inside alerts (test 102)", () => {
    expect(parseBlocks("> [!WARNING]\n> - first\n> - second")).toEqual([
      {
        type: "alert",
        kind: "WARNING",
        children: [
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
        ]
      }
    ]);
  });

  it("parses a simple footnote definition (test 103)", () => {
    expect(parseBlocks("[^1]: alpha")).toEqual([
      {
        type: "footnoteDefinition",
        label: "1",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      }
    ]);
  });

  it("parses footnote definitions with multi-line content (test 104)", () => {
    expect(parseBlocks("[^1]: alpha\n    beta\n\n    gamma")).toEqual([
      {
        type: "footnoteDefinition",
        label: "1",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "alpha\nbeta" }] },
          { type: "paragraph", children: [{ type: "text", value: "gamma" }] }
        ]
      }
    ]);
  });

  it("parses multiple footnote definitions in a document (test 105)", () => {
    expect(parseBlocks("[^1]: alpha\n[^2]: beta")).toEqual([
      {
        type: "footnoteDefinition",
        label: "1",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
      },
      {
        type: "footnoteDefinition",
        label: "2",
        children: [{ type: "paragraph", children: [{ type: "text", value: "beta" }] }]
      }
    ]);
  });

  it("parses footnote definitions with alphanumeric labels (test 109)", () => {
    expect(parseBlocks("[^note1]: alpha")).toEqual([
      {
        type: "footnoteDefinition",
        label: "note1",
        children: [{ type: "paragraph", children: [{ type: "text", value: "alpha" }] }]
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

  it("treats unknown alert kinds as regular blockquotes (test 137)", () => {
    expect(parseBlocks("> [!UNKNOWN]\n> alpha")).toEqual([
      {
        type: "blockquote",
        children: [{ type: "paragraph", children: [{ type: "text", value: "[!UNKNOWN]\nalpha" }] }]
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

  it("applies inline parsing inside task list items (spec test 77)", () => {
    expect(parseBlocks("- [x] *done*")).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            checked: true,
            children: [
              {
                type: "paragraph",
                children: [{ type: "emphasis", children: [{ type: "text", value: "done" }] }]
              }
            ]
          }
        ]
      }
    ]);
  });

  it("applies inline parsing across supported block children and keeps code/html raw", () => {
    expect(
      parseBlocks([
        "Alpha [^note] and https://example.com  ",
        "next",
        "",
        "> quote *em*",
        "",
        "- item with user@example.com",
        "",
        "| Head | Value |",
        "| --- | --- |",
        "| `code` | www.example.com |",
        "",
        "> [!NOTE]",
        "> alert with [link](https://example.com)",
        "",
        "[^note]: footnote with **strong**",
        "",
        "```",
        "literal https://example.com [^note]",
        "```",
        "",
        "<div>*literal*</div>"
      ].join("\n"))
    ).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "Alpha " },
          { type: "footnoteReference", label: "note" },
          { type: "text", value: " and " },
          {
            type: "link",
            url: "https://example.com",
            children: [{ type: "text", value: "https://example.com" }]
          },
          { type: "break" },
          { type: "text", value: "next" }
        ]
      },
      {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "quote " },
              { type: "emphasis", children: [{ type: "text", value: "em" }] }
            ]
          }
        ]
      },
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [
              {
                type: "paragraph",
                children: [
                  { type: "text", value: "item with " },
                  {
                    type: "link",
                    url: "mailto:user@example.com",
                    children: [{ type: "text", value: "user@example.com" }]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        type: "table",
        align: [null, null],
        children: [
          createTableRow("Head", "Value"),
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "inlineCode", value: "code" }] },
              {
                type: "tableCell",
                children: [
                  {
                    type: "link",
                    url: "http://www.example.com",
                    children: [{ type: "text", value: "www.example.com" }]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        type: "alert",
        kind: "NOTE",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "alert with " },
              {
                type: "link",
                url: "https://example.com",
                children: [{ type: "text", value: "link" }]
              }
            ]
          }
        ]
      },
      {
        type: "footnoteDefinition",
        label: "note",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "footnote with " },
              { type: "strong", children: [{ type: "text", value: "strong" }] }
            ]
          }
        ]
      },
      {
        type: "code",
        value: "literal https://example.com [^note]"
      },
      {
        type: "html",
        value: "<div>*literal*</div>"
      }
    ]);
  });

  it("keeps unresolved footnotes literal and applies hard breaks inside alerts and footnotes", () => {
    expect(
      parseBlocks([
        "See [^missing].",
        "",
        "> [!NOTE]",
        "> line  ",
        "> next",
        "",
        "[^note]: footnote line  ",
        "    next"
      ].join("\n"))
    ).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", value: "See [^missing]." }]
      },
      {
        type: "alert",
        kind: "NOTE",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "line" },
              { type: "break" },
              { type: "text", value: "next" }
            ]
          }
        ]
      },
      {
        type: "footnoteDefinition",
        label: "note",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "footnote line" },
              { type: "break" },
              { type: "text", value: "next" }
            ]
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
