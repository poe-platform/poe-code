import { describe, expect, it } from "vitest";
import { parseCommonMarkBlocks } from "./commonmark-blocks.js";
import { createExecutionContext } from "./execution.js";
import { createFormatRegistry } from "./formats.js";
import type { PendingBlock } from "./commonmark-blocks.js";

// Expected trees are handwritten block facts, not a parse/render round trip.
function tree(blocks: readonly PendingBlock[]): unknown[] {
  return blocks.map((block) => {
    switch (block.kind) {
      case "paragraph": return ["p", block.inline.lines.map((line) => line.text).join("\n")];
      case "heading": return ["h", block.level, block.inline.lines.map((line) => line.text).join("\n")];
      case "thematicBreak": return ["hr"];
      case "code": return ["code", block.info, block.literal];
      case "html": return ["html", block.literal];
      case "quote": return ["quote", tree(block.blocks)];
      case "list": return ["list", block.start, block.marker, block.tight, block.items.map((item) => tree(item.blocks))];
    }
  });
}
const p = (text: string) => ["p", text];
const code = (text: string, info = "") => ["code", info, text];
const list = (items: unknown[][], tight = true, start: number | null = null, marker = "-") =>
  ["list", start, marker, tight, items];
async function parse(text: string) {
  return parseCommonMarkBlocks(text, createExecutionContext("read", { yield: async () => {} }), "case.md");
}

describe("CommonMark 0.31.2 original block structures", () => {
  it.each([
    ["empty", "", []],
    ["EOF paragraph", "hello", [p("hello")]],
    ["trailing spaces", "a  \nb\t \n", [p("a  \nb\t ")]],
    ["CRLF prose", "a\r\nb\r\n\r\nc", [p("a\nb"), p("c")]],
    ["indent paragraph", "   a\n    b", [p("a\nb")]],
    ["tab code", "\ta\n\t b\n", [code("a\n b\n")]],
    ["indented code blanks", "    a\n\n    b\n\n", [code("a\n\nb\n")]],
    ["code cannot interrupt", "a\n    b", [p("a\nb")]],
    ["ATX", "  ## hello ##  \n####### no\n#no", [["h", 2, "hello"], p("####### no\n#no")]],
    ["ATX escaped closing", "# a \\#\n#\n", [["h", 1, "a \\#"], ["h", 1, ""]]],
    ["multiline setext", "one\ntwo\n===", [["h", 1, "one\ntwo"]]],
    ["setext beats rule", "a\n---\n", [["h", 2, "a"]]],
    ["thematic ambiguity", "---\n- - -\n***\n___", [["hr"], ["hr"], ["hr"], ["hr"]]],
    ["setext not in empty item", "-\n---", [list([[]]), ["hr"]]],
    ["quote lazy", "> a\nb\n> c", [["quote", [p("a\nb\nc")]]]],
    ["quote blank terminates lazy", "> a\n\nb", [["quote", [p("a")]], p("b")]],
    ["quote rule interrupts lazy", "> a\n***", [["quote", [p("a")]], ["hr"]]],
    ["quote heading has no lazy", "> # a\nb", [["quote", [["h", 1, "a"]]], p("b")]],
    ["tight list", "- a\n- b", [list([[p("a")], [p("b")]])]],
    ["loose siblings", "- a\n\n- b", [list([[p("a")], [p("b")]], false)]],
    ["loose item blocks", "- a\n\n  b", [list([[p("a"), p("b")]], false)]],
    ["trailing blank stays tight", "- a\n\nend", [list([[p("a")]]), p("end")]],
    ["list lazy", "- a\nb", [list([[p("a\nb")]])]],
    ["bullet interruption", "a\n- b", [p("a"), list([[p("b")]])]],
    ["empty bullet cannot interrupt", "a\n-", [["h", 2, "a"]]],
    ["empty plus cannot interrupt", "a\n+", [p("a\n+")]],
    ["one interrupts", "a\n1. b", [p("a"), list([[p("b")]], true, 1, ".")]],
    ["other start cannot interrupt", "a\n2. b", [p("a\n2. b")]],
    ["ordered start", "23) a\n24) b", [list([[p("a")], [p("b")]], true, 23, ")")]],
    ["ten digits rejected", "1234567890. a", [p("1234567890. a")]],
    ["empty items", "-\n-\n- a", [list([[], [], [p("a")]])]],
    ["marker changes", "- a\n+ b", [list([[p("a")]]), list([[p("b")]], true, null, "+")]],
    ["empty sibling after text", "- a\n-", [list([[p("a")], []])]],
    ["zero ordered start", "0. a\n1. b", [list([[p("a")], [p("b")]], true, 0, ".")]],
    ["empty ordered cannot interrupt", "a\n1.", [p("a\n1.")]],
    ["nested list looseness stays local", "- a\n  - b\n\n  - c\n- d", [list([[p("a"), list([[p("b")], [p("c")]], false)], [p("d")]])]],
    ["nested block blank loosens parent", "- a\n  - b\n\n  c", [list([[p("a"), list([[p("b")]]), p("c")]], false)]],
    ["blank fenced content stays tight", "- ```\n  x\n\n  y\n  ```\n- z", [list([[code("x\n\ny\n")], [p("z")]])]],
    ["empty item double blank ends item", "-\n\n  a", [list([[]]), p("a")]],
    ["definition content is not an initially empty item", "- [a]: u\n\n  b", [list([[p("b")]])]],
    ["quote lazy does not make setext", "> a\n===", [["quote", [p("a\n===")]]]],
    ["nested missing markers lazy", "> > a\nb", [["quote", [["quote", [p("a\nb")]]]]]],
    ["quote indented code not lazy", ">     a\nb", [["quote", [code("a\n")]], p("b")]],
    ["nested containers", "> - a\n>   - b\n>     > c", [["quote", [list([[p("a"), list([[p("b"), ["quote", [p("c")]]]])]])]]]],
    ["tab list padding", "-\ta\n\tb", [list([[p("a\nb")]])]],
    ["excess list padding", "-     a", [list([[code("a\n")]])]],
    ["fence info", "``` ts extra  \na  \n```", [code("a  \n", "ts extra")]],
    ["fence longer close", "```\na\n`````", [code("a\n")]],
    ["fence short conflict", "````\na\n```\n~~~~\n````", [code("a\n```\n~~~~\n")]],
    ["backtick in info rejected", "``` a`b", [p("``` a`b")]],
    ["tilde info accepts backtick", "~~~ a`b\nx\n~~~", [code("x\n", "a`b")]],
    ["fence indentation", "  ```\n a\n   b\n  ```", [code("a\n b\n")]],
    ["unclosed fence EOF", "```\nx", [code("x\n")]],
    ["empty unclosed fence", "```", [code("")]],
    ["fence close trailing text", "```\n``` x\n```", [code("``` x\n")]],
    ["quote unclosed fence", "> ```\n> x\ny", [["quote", [code("x\n")]], p("y")]],
    ["literal CRLF", "```\nx\r\ny\r\n```", [code("x\r\ny\r\n")]],
    ["literal tab retained", "```\n\tx\n```", [code("\tx\n")]],
    ["partial tab strip", "  ```\n\tx\n```", [code("  x\n")]],
    ["tab after code indent", "    \tx\n", [code("\tx\n")]],
    ["indented trailing spaces", "    a  \n", [code("a  \n")]],
    ["fence close excessive indent", "```\n    ```\n```", [code("    ```\n")]],
    ["HTML comment", "<!-- a\n\nb -->\nc", [["html", "<!-- a\n\nb -->\n"], p("c")]],
    ["HTML raw tag", "<script>\n\na\n</script>\nb", [["html", "<script>\n\na\n</script>\n"], p("b")]],
    ["HTML block tag", "<div>\na\n\nb", [["html", "<div>\na\n"], p("b")]],
    ["HTML processing", "<?x\ny?>\nz", [["html", "<?x\ny?>\n"], p("z")]],
    ["HTML declaration", "<!DOCTYPE html>\nx", [["html", "<!DOCTYPE html>\n"], p("x")]],
    ["HTML CDATA", "<![CDATA[x\ny]]>\nz", [["html", "<![CDATA[x\ny]]>\n"], p("z")]],
    ["HTML complete custom tag", "<custom a='b'>\nx\n\ny", [["html", "<custom a='b'>\nx\n"], p("y")]],
    ["HTML custom cannot interrupt", "a\n<custom>", [p("a\n<custom>")]],
    ["HTML block interrupts", "a\n<div>\nx", [p("a"), ["html", "<div>\nx\n"]]],
    ["HTML raw case insensitive", "<ScRiPt>\nx\n</SCRIPT> y\nz", [["html", "<ScRiPt>\nx\n</SCRIPT> y\n"], p("z")]],
    ["HTML raw alternate closing tag", "<script>\n</pre>\nx", [["html", "<script>\n</pre>\n"], p("x")]],
    ["HTML raw self close without gap stays inline", "<script/>\nx", [p("<script/>\nx")]],
    ["HTML type seven invalid attribute", "<custom a=>\nx", [p("<custom a=>\nx")]],
    ["HTML type seven slash", "<custom a=b />\nx", [["html", "<custom a=b />\nx\n"]]],
    ["HTML tag prefix not block", "<divine>\nx", [["html", "<divine>\nx\n"]]],
    ["HTML unterminated", "<!-- x", [["html", "<!-- x\n"]]],
    ["HTML CRLF", "<div>\r\nx\r\n", [["html", "<div>\r\nx\r\n"]]],
    ["definition removed", "[a]: /url\n\ntext", [p("text")]],
    ["definition cannot interrupt", "text\n[a]: /url", [p("text\n[a]: /url")]],
    ["invalid definition retained", "[a]: <bad<target>", [p("[a]: <bad<target>")]],
    ["angle destination spaces accepted", "[a]: <my target>", []],
    ["lowercase HTML declaration", "<!doctype html>\nx", [["html", "<!doctype html>\n"], p("x")]],
    ["definition before setext", "[a]: /u\n---", [["hr"]]],
    ["definition prefix then setext", "[a]: /u\ntext\n---", [["h", 2, "text"]]],
    ["definition followed by body", "[a]: /u\ntext", [p("text")]],
    ["definition invalid same line title", "[a]: /u 'title' garbage", [p("[a]: /u 'title' garbage")]],
    ["definition invalid next line title leaves body", "[a]: /u\n\"title\" garbage", [p('"title" garbage')]],
    ["multiline definition label", "[a\nb]: /u", []],
    ["empty angle destination", "[a]: <>", []],
    ["invalid destination control", "[a]: x\u0001y", [p("[a]: x\u0001y")]],
    ["escaped definition label", "[a\\]]: /u", []],
    ["definition oversized label literal", "[" + "a".repeat(1000) + "]: u", [p("[" + "a".repeat(1000) + "]: u")]],
    ["definition label Unicode scalar limit", "[" + "😀".repeat(999) + "]: u", []],
    ["definition escaped space invalid", "[a]: a\\ b", [p("[a]: a\\ b")]],
    ["definition escaped punctuation", "[a]: a\\(b\\)", []],
    ["setext keeps internal spaces", "a  \nb \n---", [["h", 2, "a  \nb "]]],
    ["indented blank retains excess indentation", "    red\n      \n      blue", [code("red\n  \n  blue\n")]],
    ["ordered delimiter change ends lazy item", "2. red\n3) blue", [list([[p("red")]], true, 2, "."), list([[p("blue")]], true, 3, ")")]],
    ["nested quote ending blank does not loosen list", "- red\n  > blue\n  >\n- green", [list([[p("red"), ["quote", [p("blue")]]], [p("green")]])]],
    ["null in literal code is replaced", "    red\u0000blue", [code("red�blue\n")]],
  ])("%s", async (_name, input, expected) => {
    expect(tree((await parse(input as string)).blocks)).toEqual(expected);
  });

  it("preserves pending inline source and original coordinates, including tabs", async () => {
    const result = await parse(">\t# hi\r\n>\ttext  \r\n");
    expect(result.blocks[0]?.source).toEqual({ source: "case.md", start: { line: 1, column: 1 }, end: { line: 2, column: 8 } });
    const quote = result.blocks[0]!;
    expect(quote.kind).toBe("quote");
    if (quote.kind !== "quote") throw new Error("expected quote");
    expect(quote.blocks[0]?.source.start).toEqual({ line: 1, column: 3 });
    const paragraph = quote.blocks[1]!;
    if (paragraph.kind !== "paragraph") throw new Error("expected paragraph");
    expect(paragraph.inline).toMatchObject({ kind: "pendingInline", lines: [{ text: "text  ", start: { line: 2, column: 3 } }] });
    expect(paragraph).not.toHaveProperty("t");
  });
  it("buffers original definitions, first normalized label wins, and supports multiline titles", async () => {
    const result = await parse("[ A  B ]: <u>\n  'title'\n[a b]: v\n> [q]: /quote\n\nbody");
    expect(result.definitions.map((definition) => [definition.label, definition.destination, definition.title])).toEqual([
      ["a b", "u", "title"], ["q", "/quote", ""]
    ]);
    expect(tree(result.blocks)).toEqual([["quote", []], p("body")]);
    expect(result.definitions[0]?.source.start).toEqual({ line: 1, column: 1 });
  });
  it("retains definition syntax and literal info for the later inline decoding phase", async () => {
    const result = await parse("[x]: a(b(c)) 'line\ntwo'\n[x]: /duplicate\n[y]:\n  /target\n``` a\\* &amp;\n```");
    expect(result.definitions.map(({ label, destination, title }) => [label, destination, title])).toEqual([
      ["x", "a(b(c))", "line\ntwo"], ["y", "/target", ""]
    ]);
    expect(tree(result.blocks)).toEqual([code("", "a\\* &amp;")]);
  });
  it("uses Unicode case folding for definition identity without merging dotless i", async () => {
    const result = await parse("[ẞ]: first\n[ss]: second\n[ς]: sigma\n[Σ]: duplicate\n[ı]: dotless\n[I]: ascii\n[Ꭰ]: cherokee\n[ꭰ]: duplicate\n[ﬀ]: ligature\n[ff]: duplicate");
    expect(result.definitions.map(({ label, destination }) => [label, destination])).toEqual([
      ["ss", "first"], ["σ", "sigma"], ["ı", "dotless"], ["i", "ascii"], ["Ꭰ", "cherokee"], ["ff", "ligature"]
    ]);
  });
  it("bounds pending definition buffers before EOF", async () => {
    await expect(parseCommonMarkBlocks("[a]: u\n[b]: v\n[c]: w\n" + "x".repeat(1000), createExecutionContext("read", { limits: { references: 2, work: 100 } }))).rejects.toMatchObject({ code: "E_LIMIT", message: expect.stringContaining("references") });
  });
  it("bounds expanded pathological tab lines independently of original string size", async () => {
    await expect(parseCommonMarkBlocks("\t".repeat(4), createExecutionContext("read", { limits: { text: 12 } }))).rejects.toMatchObject({ code: "E_LIMIT", message: expect.stringContaining("text") });
  });
  it("cooperates during a pathological line and checks cancellation before retaining it", async () => {
    const controller = new AbortController();
    let yields = 0;
    const context = createExecutionContext("read", {
      signal: controller.signal,
      yield: async () => { if (++yields === 2) controller.abort(); }
    });
    await expect(parseCommonMarkBlocks(" ".repeat(5000), context)).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(yields).toBe(2);
  });
  it.each([
    ["depth", "> ".repeat(10) + "x", { depth: 4 }],
    ["leaf depth", "> > > > x", { depth: 4 }],
    ["references", "[a]: u\n[b]: v", { references: 1 }],
    ["text", "x".repeat(500), { text: 100 }],
    ["work", "x".repeat(500), { work: 100 }],
    ["nodes", "# a\n# b", { nodes: 1 }],
    ["retainedBytes", "x".repeat(500), { retainedBytes: 100 }],
  ])("bounds %s", async (_name, input, limits) => {
    await expect(parseCommonMarkBlocks(input, createExecutionContext("read", { limits, yield: async () => {} }))).rejects.toMatchObject({ code: "E_LIMIT" });
  });
  it("checks cancellation and keeps CommonMark writing unavailable", async () => {
    const controller = new AbortController();
    const context = createExecutionContext("read", { signal: controller.signal });
    controller.abort();
    await expect(parseCommonMarkBlocks("hello", context)).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(createFormatRegistry().list("write")).not.toContain("commonmark");
  });
});
