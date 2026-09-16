import { describe, expect, it } from "vitest";
import { readDocument, createFormatRegistry, inspectFormats, convert } from "./index.js";
import type { Block, Inline } from "./index.js";
const str = (c: string): Inline => ({ t: "Str", c });
const read = async (text: string, from = "gfm") =>
  (await readDocument({ bytes: new TextEncoder().encode(text) }, { from }, {})).blocks;
const para = (c: readonly Inline[]): Block => ({ t: "Para", c });
const link = (label: string, url = label): Inline => ({ t: "Link", c: [["", [], []], [str(label)], [url, ""]] });
function table(block: Block) {
  expect(block.t).toBe("Table");
  if (block.t !== "Table") throw new Error("Expected table");
  return block.c;
}
describe("declared GFM reader", () => {
  it("uses the descriptor for availability, exact defaults, inspection and SDK validation", async () => {
    const registry = createFormatRegistry();
    expect(registry.list("read")).toContain("gfm");
    expect(registry.listExtensions("gfm")).toEqual(["+autolink_bare_uris", "+pipe_tables", "+raw_html", "+strikeout", "+task_lists"]);
    expect(inspectFormats(["--list-extensions=gfm-strikeout+strikeout-task_lists"])).toBe("+autolink_bare_uris\n+pipe_tables\n+raw_html\n+strikeout\n-task_lists\n");
    for (const extension of ["footnotes", "tex_math_dollars", "yaml_metadata_block", "smart", "definition_lists", "gfm_auto_identifiers", "hard_line_breaks", "emoji", "alerts", "tex_math_gfm", "attributes"]) {
      await expect(read("literal", `gfm+${extension}`)).rejects.toMatchObject({ code: "E_EXTENSION" });
      expect(() => inspectFormats([`--list-extensions=gfm+${extension}`])).toThrowError(expect.objectContaining({ code: "E_EXTENSION" }));
    }
    expect(await read("~~x~~", "gfm-strikeout+strikeout")).toEqual([para([{ t: "Strikeout", c: [str("x")] }])]);
  });
  it("builds aligned tables, pads short rows and drops excess cells", async () => {
    const c = table((await read("| a | b | c |\n| :-- | :-: | --: |\n| x |\n| y | z | w | extra |"))[0]!);
    expect(c[2].map((col) => col[0])).toEqual(["AlignLeft", "AlignCenter", "AlignRight"]);
    expect(c[3][1][0]![1].map((cell) => cell[4])).toEqual([[{ t: "Plain", c: [str("a")] }], [{ t: "Plain", c: [str("b")] }], [{ t: "Plain", c: [str("c")] }]]);
    expect(c[4][0]![3].map((row) => row[1].map((cell) => cell[4]))).toEqual([
      [[{ t: "Plain", c: [str("x")] }], [], []],
      [[{ t: "Plain", c: [str("y")] }], [{ t: "Plain", c: [str("z")] }], [{ t: "Plain", c: [str("w")] }]]
    ]);
  });
  it("splits pipes before inline parsing including escaped pipes inside code spans", async () => {
    const c = table((await read("a | b\n--- | ---\nx\\|y | `z\\|w`\n`a|b` | c"))[0]!);
    expect(c[4][0]![3][0]![1].map((cell) => cell[4])).toEqual([[{ t: "Plain", c: [str("x|y")] }], [{ t: "Plain", c: [{ t: "Code", c: [["", [], []], "z|w"] }] }]]);
    expect(c[4][0]![3][1]![1].map((cell) => cell[4])).toEqual([[{ t: "Plain", c: [str("`a")] }], [{ t: "Plain", c: [str("b`")] }]]);
  });
  it("accepts empty and header-only tables and rejects missing/mismatched delimiters", async () => {
    for (const text of ["| | |\n|-|-|", "a | b\n- | -"]) {
      const c = table((await read(text))[0]!);
      expect(c[4][0]![3]).toEqual([]);
    }
    for (const text of ["a | b\nx | y", "a | b\n---", "a | b\n-- | x", "a\n---"]) expect((await read(text))[0]!.t).not.toBe("Table");
    const blocks = await read("a | b\n- | -\nx | y\ncontinued\n\nnext");
    expect(table(blocks[0]!)[4][0]![3]).toHaveLength(1);
    expect(blocks.slice(1)).toEqual([para([str("continued")]), para([str("next")])]);
  });
  it("recognizes tables inside containers without admitting lazy multiline cells", async () => {
    const blocks = await read("> a | b\n> - | -\n> x | y\n\n- a | b\n  - | -\n  x | y");
    expect(blocks[0]!.t).toBe("BlockQuote");
    expect(blocks[1]!.t).toBe("BulletList");
    if (blocks[0]!.t === "BlockQuote") table(blocks[0]!.c[0]!);
    if (blocks[1]!.t === "BulletList") table(blocks[1]!.c[0]![0]!);
  });
  it.each(["~~x~~", "~~*x*~~", "a~~x~~b"])("handles strikeout delimiter runs: %s", async (text) => {
    const blocks = await read(text);
    expect(blocks).toEqual([para(text === "~~*x*~~" ? [{ t: "Strikeout", c: [{ t: "Emph", c: [str("x")] }] }] : text === "a~~x~~b" ? [str("a"), { t: "Strikeout", c: [str("x")] }, str("b")] : [{ t: "Strikeout", c: [str("x")] }])]);
  });
  it.each(["~x~", "a~~~x~~~b", "~~~x~~~", "~~~~x~~~~", "~x~~", "~~x~", "~~ x~~", "~~x ~~", "\\~~x~~", "`~~x~~`"])("leaves invalid/protected strikeout literal: %s", async (text) => {
    const blocks = await read(text);
    expect(JSON.stringify(blocks)).not.toContain('"Strikeout"');
  });
  it("retains task states as leading task-list-marker spans in nested/tight and loose lists", async () => {
    const blocks = await read("- [x] done\n  - [ ] child\n- [X] upper\n\n- [ ] loose\n\n  [x] later");
    expect(blocks[0]!.t).toBe("BulletList");
    if (blocks[0]!.t !== "BulletList") throw new Error("Expected list");
    const items = blocks[0]!.c;
    const marker = (checked: boolean): Inline => ({ t: "Span", c: [["", ["task-list-marker"], [["checked", String(checked)]]], []] });
    expect(items[0]![0]).toEqual(para([marker(true), str("done")]));
    const child = items[0]![1]!;
    expect(child.t).toBe("BulletList");
    if (child.t === "BulletList") expect(child.c[0]![0]).toEqual({ t: "Plain", c: [marker(false), str("child")] });
    expect(items[1]![0]).toEqual(para([marker(true), str("upper")]));
    expect(items[2]![1]).toEqual(para([str("[x]"), { t: "Space" }, str("later")]));
    const result = await convert([{ bytes: new TextEncoder().encode("- [ ] todo") }], { from: "gfm", to: "json" }, {});
    expect(result.kind === "text" && result.text).toContain('"checked","false"');
  });
  it("retains state for empty task items", async () => {
    expect(await read("- [ ]\n- [x]")).toEqual([{ t: "BulletList", c: [[{ t: "Plain", c: [{ t: "Span", c: [["", ["task-list-marker"], [["checked", "false"]]], []] }] }], [{ t: "Plain", c: [{ t: "Span", c: [["", ["task-list-marker"], [["checked", "true"]]], []] }] }]] }]);
  });
  it("accepts tab whitespace inside and after task markers", async () => {
    expect(await read("- [\t]\ttodo")).toEqual([{ t: "BulletList", c: [[{ t: "Plain", c: [{ t: "Span", c: [["", ["task-list-marker"], [["checked", "false"]]], []] }, str("todo")] }]] }]);
  });
  it("does not implicitly interpret Pandoc Markdown extras", async () => {
    const blocks = await read("$x$ :smile: “quote”\n\nterm\n: definition\n\n[^note]\n\n[^note]: note");
    expect(JSON.stringify(blocks)).not.toContain('"Math"');
    expect(JSON.stringify(blocks)).not.toContain('"Note"');
    expect(JSON.stringify(blocks)).not.toContain('"DefinitionList"');
    expect((await readDocument({ bytes: new TextEncoder().encode("---\ntitle: test\n---") }, { from: "gfm" }, {})).metadata).toEqual({});
  });
  it("does not recognize malformed tasks or markers outside the first list paragraph", async () => {
    for (const text of ["[x] standalone", "- [y] text", "- [x]text", "- \\[x] text", "- ` [x] ` text", "- heading\n\n  [x] later"]) expect(JSON.stringify(await read(text))).not.toContain("task-list-marker");
  });
  it.each([
    ["www.example.org.", [link("www.example.org", "http://www.example.org"), str(".")]],
    ["https://example.org.", [link("https://example.org"), str(".")]],
    ["(me@example.org)", [str("("), link("me@example.org", "mailto:me@example.org"), str(")")]],
    ["https://example.org/a(b)).", [link("https://example.org/a(b)"), str(").")]],
    ["www.example.org/test?", [link("www.example.org/test", "http://www.example.org/test"), str("?")]],
    ["a.b+tag@example.org", [link("a.b+tag@example.org", "mailto:a.b+tag@example.org")]],
    ["https://例え.テスト/道。", [link("https://例え.テスト/道。", "https://%E4%BE%8B%E3%81%88.%E3%83%86%E3%82%B9%E3%83%88/%E9%81%93%E3%80%82")]],
    ["（https://example.org/a）", [str("（https://example.org/a）")]],
    ["(https://example.org/a[b])", [str("("), link("https://example.org/a[b]", "https://example.org/a%5Bb%5D"), str(")")]]
  ] as const)("handles bare links and punctuation: %s", async (text, expected) => {
    expect(await read(text)).toEqual([para(expected)]);
  });
  it("handles entity suffixes, invalid domains and multiline strikeout boundaries", async () => {
    expect(await read("www.example.org/a&copy;")).toEqual([para([link("www.example.org/a", "http://www.example.org/a"), str("©")])]);
    for (const text of ["www.foo_bar.org", "https://localhost", "hello@mail+xyz.example", "a@b.c-", "a@b.c_"]) expect(await read(text)).toEqual([para([str(text)])]);
    expect(await read("~~a\nb~~")).toEqual([para([{ t: "Strikeout", c: [str("a"), { t: "SoftBreak" }, str("b")] }])]);
    expect(await read("~~a\n\nb~~")).toEqual([para([str("~~a")]), para([str("b~~")])]);
  });
  it("disables block HTML and applies tagfilter independently of table toggling", async () => {
    expect(await read("<div>\nx\n</div>", "gfm-raw_html")).toEqual([para([str("<div>"), { t: "SoftBreak" }, str("x"), { t: "SoftBreak" }, str("</div>")])]);
    expect(await read("<SCRIPT>\nx\n</SCRIPT>", "gfm-pipe_tables")).toEqual([{ t: "RawBlock", c: ["html", "&lt;SCRIPT>\nx\n&lt;/SCRIPT>\n"] }]);
    expect(await read("a <scripture>x</scripture>")).toEqual([para([str("a"), { t: "Space" }, { t: "RawInline", c: ["html", "<scripture>"] }, str("x"), { t: "RawInline", c: ["html", "</scripture>"] }])]);
  });
  it("keeps bare links out of code and explicit link labels", async () => {
    expect(await read("`https://example.org` [https://example.org](u)")).toEqual([para([{ t: "Code", c: [["", [], []], "https://example.org"] }, { t: "Space" }, { t: "Link", c: [["", [], []], [str("https://example.org")], ["u", ""]] }])]);
  });
  it("filters only the GFM disallowed raw tags, retaining allowed HTML", async () => {
    for (const tag of ["title", "textarea", "style", "xmp", "iframe", "noembed", "noframes", "script", "plaintext"]) {
      expect(await read(`a <${tag}>x</${tag}>`)).toEqual([para([str(`a`), { t: "Space" }, str(`<${tag}>x</${tag}>`)])]);
      expect(await read(`<${tag}>\nx\n</${tag}>`)).toEqual([{ t: "RawBlock", c: ["html", `&lt;${tag}>\nx\n&lt;/${tag}>\n`] }]);
    }
    expect(await read("a <em>x</em>")).toEqual([para([str("a"), { t: "Space" }, { t: "RawInline", c: ["html", "<em>"] }, str("x"), { t: "RawInline", c: ["html", "</em>"] }])]);
  });
  it.each([
    ["strikeout", "~~text~~", [para([str("~~text~~")])]],
    ["task_lists", "- [x] task", [{ t: "BulletList", c: [[{ t: "Plain", c: [str("[x]"), { t: "Space" }, str("task")] }]] }]],
    ["autolink_bare_uris", "https://example.org", [para([str("https://example.org")])]],
    ["pipe_tables", "a | b\n--- | ---\nx | y", [para([str("a"), { t: "Space" }, str("|"), { t: "Space" }, str("b"), { t: "SoftBreak" }, str("---"), { t: "Space" }, str("|"), { t: "Space" }, str("---"), { t: "SoftBreak" }, str("x"), { t: "Space" }, str("|"), { t: "Space" }, str("y")])]],
    ["raw_html", "a <em>x</em>", [para([str("a"), { t: "Space" }, str("<em>x</em>")])]]
  ] as const)("independently keeps %s syntax literal when disabled", async (extension, text, expected) => {
    expect(await read(text, `gfm-${extension}`)).toEqual(expected);
    expect(await read(text, `gfm+${extension}-${extension}`)).toEqual(expected);
    expect(await read(text, `gfm-${extension}+${extension}`)).toEqual(await read(text));
  });
});
