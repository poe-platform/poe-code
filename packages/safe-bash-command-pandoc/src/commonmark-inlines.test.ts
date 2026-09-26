import { describe, expect, it, vi } from "vitest";
import { parseCommonMarkInlines } from "./commonmark-inlines.js";
import { parseCommonMarkBlocks } from "./commonmark-blocks.js";
import { createExecutionContext } from "./execution.js";
import { readDocument, convert } from "./engine.js";
import type { Inline } from "./ast-types.js";

// Original strings and handwritten ASTs, grounded in CommonMark 0.31.2 §§2,6.
// No spec fixture payloads, writer oracle, disk mutation or external execution.
const s = (c: string): Inline => ({ t: "Str", c });
const sp: Inline = { t: "Space" };
const em = (...c: Inline[]): Inline => ({ t: "Emph", c });
const strong = (...c: Inline[]): Inline => ({ t: "Strong", c });
const code = (c: string): Inline => ({ t: "Code", c: [["", [], []], c] });
const link = (text: Inline[], url: string, title = "", image = false): Inline =>
  ({ t: image ? "Image" : "Link", c: [["", [], []], text, [url, title]] });
async function parse(text: string) {
  const context = createExecutionContext("read", { yield: async () => {} });
  const document = await parseCommonMarkBlocks(text, context);
  const paragraph = document.blocks[0];
  if (paragraph?.kind !== "paragraph") throw new Error("expected original paragraph");
  return parseCommonMarkInlines(paragraph.inline, document.definitions, context);
}

describe("original CommonMark inline obligations", () => {
  it.each([
    ["single and double runs", "*red* **blue**", [em(s("red")), sp, strong(s("blue"))]],
    ["triple run", "***red***", [em(strong(s("red")))]],
    ["unequal runs", "**red*", [s("*"), em(s("red"))]],
    ["nested runs", "**red *blue* green**", [strong(s("red"), sp, em(s("blue")), sp, s("green"))]],
    ["rule of three prevents pair", "a**b*c", [s("a**b*c")]],
    ["rule of three permits multiples", "a***b***c", [s("a"), em(strong(s("b"))), s("c")]],
    ["rule of three remnant", "*a**b*", [em(s("a**b"))]],
    ["intraword underscores", "red_blue_green red__blue__green", [s("red_blue_green"), sp, s("red__blue__green")]],
    ["punctuation flanking", "(_red_)!", [s("("), em(s("red")), s(")!")]],
    ["no whitespace opener", "x * red*", [s("x"), sp, s("*"), sp, s("red*")]],
    ["escaped delimiters", "\\*red\\* \\_ \\a", [s("*red*"), sp, s("_"), sp, s("\\a")]],
    ["mismatched backticks", "``red`blue", [s("``red`blue")]],
    ["code spaces normalized", "` red\nblue `", [code("red blue")]],
    ["code one boundary space only", "`  red  `", [code(" red ")]],
    ["all-space code unchanged", "`   `", [code("   ")]],
    ["code literals", "`\\* &amp;`", [code("\\* &amp;")]],
    ["matching backtick lengths", "``red`blue``", [code("red`blue")]],
    ["escaped partial backtick run without match", "red \\``blue", [s("red"), sp, s("``blue")]],
    ["balanced target", "[red](a(b(c)))", [link([s("red")], "a(b(c))")]],
    ["escaped target parentheses", "[red](a\\(b\\))", [link([s("red")], "a(b)")]],
    ["angle target spaces", "[red](<a b>)", [link([s("red")], "a%20b")]],
    ["empty target", "[red]()", [link([s("red")], "")]],
    ["empty angle target", "[red](<>)", [link([s("red")], "")]],
    ["quoted destination with leading gap", '[red]( "caption")', [link([s("red")], "%22caption%22")]],
    ["title with empty angle target", '[red](<> "caption")', [link([s("red")], "", "caption")]],
    ["escaped title", '[red](u "a\\"b &amp;")', [link([s("red")], "u", 'a"b &')]],
    ["parenthesis title", "[red](u (caption))", [link([s("red")], "u", "caption")]],
    ["invalid title fallback", '[red](u "caption" junk)', [s("[red](u"), sp, s('"caption"'), sp, s("junk)")]],
    ["space before target is text", "[red] (u)", [s("[red]"), sp, s("(u)")]],
    ["link containing image", "[![red](pic)](page)", [link([link([s("red")], "pic", "", true)], "page")]],
    ["image containing link", "![[red](page)](pic)", [link([link([s("red")], "page")], "pic", "", true)]],
    ["image containing image", "![![red](a)](b)", [link([link([s("red")], "a", "", true)], "b", "", true)]],
    ["nested links forbidden", "[outer [red](a)](b)", [s("[outer"), sp, link([s("red")], "a"), s("](b)")]],
    ["autolink forbids outer link", "[<https://red.test>](b)", [s("["), link([s("https://red.test")], "https://red.test"), s("](b)")]],
    ["emphasis inside link", "[*red*](u)", [link([em(s("red"))], "u")]],
    ["emphasis outside link", "*[red](u)*", [em(link([s("red")], "u"))]],
    ["unresolved full reference", "[red][missing]", [s("[red][missing]")]],
    ["unresolved preserves emphasis", "[*red*][missing]", [s("["), em(s("red")), s("][missing]")]],
    ["forward normalized reference", "[red][ A\t B ]\n\n[a b]: /first\n[A B]: /second", [link([s("red")], "/first")]],
    ["Unicode folded shortcut", "[ẞ]\n\n[ss]: /target", [link([s("ẞ")], "/target")]],
    ["collapsed reference", "[red][]\n\n[RED]: /target 'caption'", [link([s("red")], "/target", "caption")]],
    ["escaped label identity", "[red][a\\]]\n\n[a\\]]: /target", [link([s("red")], "/target")]],
    ["entities do not create syntax", "&ast;red&ast; &amp;lt;", [s("*red*"), sp, s("&lt;")]],
    ["entity boundaries", "&amp &AMP; &unknown; &#65; &#x1F600; &#0;", [s("&amp"), sp, s("&"), sp, s("&unknown;"), sp, s("A"), sp, s("😀"), sp, s("�")]],
    ["entity digit limits", "&#12345678; &#x1234567;", [s("&#12345678;"), sp, s("&#x1234567;")]],
    ["URI autolink", "<git+ssh://red.test/a>.", [link([s("git+ssh://red.test/a")], "git+ssh://red.test/a"), s(".")]],
    ["email autolink", "<red+blue@example.test>", [link([s("red+blue@example.test")], "mailto:red+blue@example.test")]],
    ["invalid angle autolinks", "<a:b> <https://a b> <red@-bad.test>", [s("<a:b>"), sp, s("<https://a"), sp, s("b>"), sp, s("<red@-bad.test>")]],
    ["raw tag", 'red <i data-x="*">blue</i>', [s("red"), sp, { t: "RawInline", c: ["html", '<i data-x="*">'] }, s("blue"), { t: "RawInline", c: ["html", "</i>"] }]],
    ["inline raw comment", "red <!-- *blue* -->", [s("red"), sp, { t: "RawInline", c: ["html", "<!-- *blue* -->"] }]],
    ["soft break strips edges", "red \n blue", [s("red"), { t: "SoftBreak" }, s("blue")]],
    ["space hard break", "red  \nblue", [s("red"), { t: "LineBreak" }, s("blue")]],
    ["backslash hard break", "red\\\nblue", [s("red"), { t: "LineBreak" }, s("blue")]],
    ["EOF is not hard break", "red  ", [s("red")]],
    ["internal spaces preserved", "red   blue", [s("red"), sp, sp, sp, s("blue")]],
    ["tab is literal text", "red\tblue", [s("red\tblue")]],
    ["URI bracket encoding", "<https://red.test/?q=[blue]>", [link([s("https://red.test/?q=[blue]")], "https://red.test/?q=%5Bblue%5D")]],
    ["comment internal hyphens", "red <!-- a --\nb -->", [s("red"), sp, { t: "RawInline", c: ["html", "<!-- a --\nb -->"] }]],
    ["short comment closes immediately", "red <!--> blue", [s("red"), sp, { t: "RawInline", c: ["html", "<!-->"] }, sp, s("blue")]],
    ["short hyphen comment", "red <!---> blue", [s("red"), sp, { t: "RawInline", c: ["html", "<!--->"] }, sp, s("blue")]],
    ["form feed label identity is distinct", "[red][a\fb]\n\n[a b]: u", [s("[red][a\fb]")]],
    ["form feed cannot separate destination", "[red](u\f'caption')", [s("[red](u\f'caption')")]],
    ["null text becomes replacement", "red\u0000blue", [s("red�blue")]],
    ["null in code becomes replacement", "`red\u0000blue`", [code("red�blue")]],
  ] satisfies [string, string, Inline[]][])("%s", async (_name, input, expected) => {
    expect(await parse(input)).toEqual(expected);
  });

  it("assembles discovered blocks and activates only the commonmark reader", async () => {
    expect(await readDocument({ bytes: new TextEncoder().encode("# *red*\n\n- [blue]\n\n[blue]: u\n\n<div>\nraw\n") }, { from: "commonmark" }, {})).toEqual({
      metadata: {}, resources: [], blocks: [
        { t: "Header", c: [1, ["", [], []], [em(s("red"))]] },
        { t: "BulletList", c: [[{ t: "Plain", c: [link([s("blue")], "u")] }]] },
        { t: "RawBlock", c: ["html", "<div>\nraw\n"] }
      ]
    });
  });
  it("shares reference discovery across joined conversion inputs and never resolves images", async () => {
    const resolve = vi.fn();
    const result = await convert(["[red]\n\n[red]: u", "[red] ![blue](pic)"].map((text) => ({ bytes: new TextEncoder().encode(text) })), { from: "commonmark", to: "json" }, { resources: { resolve } });
    if (result.kind !== "text") throw new Error("expected JSON");
    expect(JSON.parse(result.text).blocks).toEqual([
      { t: "Para", c: [link([s("red")], "u")] },
      { t: "Para", c: [link([s("red")], "u"), sp, link([s("blue")], "pic", "", true)] }
    ]);
    expect(resolve).not.toHaveBeenCalled();
  });
  it.each([
    ["depth", "*".repeat(40) + "red" + "*".repeat(40), { depth: 8 }],
    ["brackets", "[".repeat(40) + "red", { references: 8 }],
    ["work", "a**b*c ".repeat(100), { work: 50 }],
    ["retention", "red".repeat(100), { retainedBytes: 32 }],
    ["entities", "&amp;&amp;", { entities: 1 }],
    ["inline text", "red".repeat(40), { text: 32 }],
    ["expanded space nodes", "red" + " ".repeat(100) + "blue", { nodes: 20 }],
    ["output retention", "red" + " ".repeat(100) + "blue", { retainedBytes: 1600 }],
  ])("bounds %s in the inline phase", async (_name, text, limits) => {
    const context = createExecutionContext("read", { limits, yield: async () => {} });
    await expect(parseCommonMarkInlines({ kind: "pendingInline", lines: [{ text, start: { line: 1, column: 1 } }] }, [], context)).rejects.toMatchObject({ code: "E_LIMIT" });
  });
  it("cooperates and cancels on a long inline run", async () => {
    const controller = new AbortController();
    let yields = 0;
    const context = createExecutionContext("read", { signal: controller.signal, yield: async () => { if (++yields === 2) controller.abort(); } });
    await expect(parseCommonMarkInlines({ kind: "pendingInline", lines: [{ text: "red ".repeat(2000), start: { line: 1, column: 1 } }] }, [], context)).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(yields).toBe(2);
  });
  it("keeps the first definition when resolving a pre-discovered buffer", async () => {
    const source = { source: "case", start: { line: 1, column: 1 }, end: { line: 1, column: 10 } };
    expect(await parseCommonMarkInlines({ kind: "pendingInline", lines: [{ text: "[red]", start: { line: 1, column: 1 } }] }, [
      { label: "red", destination: "first", title: "", source },
      { label: "red", destination: "second", title: "", source }
    ], createExecutionContext("read", {}))).toEqual([link([s("red")], "first")]);
  });
});
