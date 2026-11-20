import { expect, it, vi } from "vitest";
import { readDocument } from "./engine.js";
import type { Block, Inline, Attr } from "./ast-types.js";
const empty: Attr = ["", [], []];
const str = (c: string): Inline => ({ t: "Str", c });
const plain = (...c: Inline[]): Block => ({ t: "Plain", c });
const para = (...c: Inline[]): Block => ({ t: "Para", c });
const read = (html: string, limits = {}) =>
  readDocument(
    { bytes: new TextEncoder().encode(html) },
    { from: "html" },
    { limits, yield: async () => {} }
  );
it.each(["article", "footer", "nav", "details", "summary", "blockquote", "ul", "ol", "dl"])("retains direction scope on %s", async tag => {
  const content = tag === "ul" || tag === "ol" ? "<li>text</li>" : tag === "dl" ? "<dt>term</dt><dd>text</dd>" : "text";
  const block = (await read(`<${tag} dir="rtl">${content}</${tag}>`)).blocks[0];
  expect(block).toMatchObject({t: "Div", c: [["", [], [["dir", "rtl"]]], expect.any(Array)]});
});

it("keeps list direction around split runs and opposing item direction around the item content", async () => {
  expect((await read('<ol dir="rtl" reversed><li id="item" dir="ltr">First</li><li>Second</li></ol>')).blocks).toEqual([
    {t: "Div", c: [["", [], [["dir", "rtl"]]], [
      {t: "OrderedList", c: [[2, "DefaultStyle", "DefaultDelim"], [[{t: "Div", c: [["", [], [["dir", "ltr"]]], [plain({t: "Span", c: [["item", [], []], []]}, str("First"))]]}]]]},
      {t: "OrderedList", c: [[1, "DefaultStyle", "DefaultDelim"], [[plain(str("Second"))]]]}
    ]]}
  ]);
});

it("preserves BDI isolation and BDO override markers including unresolved direction", async () => {
  expect((await read('<p><bdi>auto</bdi><bdi dir="rtl">isolated</bdi><bdo dir="ltr" style="color:red">override</bdo><bdo>missing</bdo></p>')).blocks).toEqual([
    para(
      {t: "Span", c: [["", [], [["dir", "auto"]]], [str("auto")]]},
      {t: "Span", c: [["", [], [["dir", "rtl"]]], [str("isolated")]]},
      {t: "Span", c: [["", [], [["dir", "ltr"], ["style", "color:red;unicode-bidi:isolate-override"]]], [str("override")]]},
      {t: "Span", c: [["", [], [["dir", "auto"], ["style", "unicode-bidi:isolate-override"]]], [str("missing")]]}
    )
  ]);
});

it("retains generic inline direction and CSS for downstream capability validation", async () => {
  expect((await read('<p><custom dir="sideways">bad</custom><kbd style="direction:rtl">css</kbd></p>')).blocks).toEqual([
    para({t: "Span", c: [["", [], [["dir", "sideways"]]], [str("bad")]]}, {t: "Span", c: [["", [], [["style", "direction:rtl"]]], [str("css")]]})
  ]);
});

it.each(["rtl", "ltr", "auto", "invalid"])("preserves nested root and body directions: %s", async direction => {
  const document = await read(`<html dir="${direction}"><body dir="ltr"><p dir="rtl">Text</p></body></html>`);
  const body: Block = {t: "Div", c: [["", [], [["dir", "ltr"]]], [{t: "Div", c: [["", [], [["dir", "rtl"]]], [para(str("Text"))]]}]]};
  expect(document.blocks).toEqual(direction === "invalid" ? [{t: "Div", c: [["", [], [["dir", direction]]], [body]]}] : [body]);
  expect(document.direction).toBe(direction === "invalid" ? undefined : direction);
});
it("preserves mark highlighting, attributes and nested formatting", async () => {
  expect((await read('<p>A <mark>highlight</mark> B</p><mark id="note" class="custom" title="why"><em>nested</em></mark>')).blocks).toEqual([
    para(str("A"), { t: "Space" }, { t: "Span", c: [["", ["mark"], []], [str("highlight")]] }, { t: "Space" }, str("B")),
    plain({ t: "Span", c: [["note", ["mark", "custom"], [["title", "why"]]], [{ t: "Emph", c: [str("nested")] }]] })
  ]);
});
it("converts original heading and inline AST, with quoted delimiters and duplicate attributes", async () => {
  expect(
    (
      await read(
        '<h2 id="first" ID="last" title="a > b">Hello <em>world</em></h2><p>A <b>B</b> C&nbsp;D<br><img src="x" alt="pic"></p>'
      )
    ).blocks
  ).toEqual([
    {
      t: "Header",
      c: [
        2,
        ["first", [], [["title", "a > b"]]],
        [str("Hello"), { t: "Space" }, { t: "Emph", c: [str("world")] }]
      ]
    },
    para(
      str("A"),
      { t: "Space" },
      { t: "Strong", c: [str("B")] },
      { t: "Space" },
      str("C\u00a0D"),
      { t: "LineBreak" },
      { t: "Image", c: [empty, [str("pic")], ["x", ""]] }
    )
  ]);
});
it("decodes legacy and invalid numeric entities with attribute ambiguity rules", async () => {
  expect(
    (
      await read(
        '<p>&copy &ampx &#0; &#xD800; &#1114112; &#128;</p><a href="?a=&copyx&copy=1">go</a>'
      )
    ).blocks
  ).toEqual([
    para(
      str("©"),
      { t: "Space" },
      str("&x"),
      { t: "Space" },
      str("�"),
      { t: "Space" },
      str("�"),
      { t: "Space" },
      str("�"),
      { t: "Space" },
      str("€")
    ),
    plain({ t: "Link", c: [empty, [str("go")], ["?a=&copyx&copy=1", ""]] })
  ]);
});
it("recovers formatting, omitted paragraph/list tags and non-void slash syntax", async () => {
  expect((await read("<p><b><i>A</b>B</i><p>C<ul><li>one<li>two</ul><div/>tail")).blocks).toEqual([
    para({ t: "Strong", c: [{ t: "Emph", c: [str("A")] }] }, { t: "Emph", c: [str("B")] }),
    para(str("C")),
    { t: "BulletList", c: [[plain(str("one"))], [plain(str("two"))]] },
    { t: "Div", c: [empty, [plain(str("tail"))]] }
  ]);
});
it("preserves language, direction, div/span attributes, links, inline styles and pre newlines", async () => {
  const doc = await read(
    '<html lang="pl" dir="rtl"><div id="d" class="a b" data-x="v"><span lang="fr" dir="ltr"><u>U</u><s>S</s><sup>2</sup><sub>n</sub><code>x  y</code></span></div><pre><code class="ts">\nlet x = 1;\n</code></pre><ol start="3"><li>X</ol>'
  );
  expect(doc).toMatchObject({ language: "pl", direction: "rtl", resources: [] });
  expect(doc.blocks).toEqual([
    {
      t: "Div",
      c: [
        ["d", ["a", "b"], [["data-x", "v"]]],
        [
          plain({
            t: "Span",
            c: [
              [
                "",
                [],
                [
                  ["lang", "fr"],
                  ["dir", "ltr"]
                ]
              ],
              [
                { t: "Underline", c: [str("U")] },
                { t: "Strikeout", c: [str("S")] },
                { t: "Superscript", c: [str("2")] },
                { t: "Subscript", c: [str("n")] },
                { t: "Code", c: [empty, "x  y"] }
              ]
            ]
          })
        ]
      ]
    },
    { t: "CodeBlock", c: [["", ["ts"], []], "\nlet x = 1;\n"] },
    { t: "OrderedList", c: [[3, "DefaultStyle", "DefaultDelim"], [[plain(str("X"))]]] }
  ]);
  expect((await read("<pre>\nA\r\nB\n</pre>")).blocks).toEqual([
    { t: "CodeBlock", c: [empty, "A\nB\n"] }
  ]);
});
it("never executes or resolves resources; drops unsafe subtrees, comments and base", async () => {
  const resolve = vi.fn(async () => {
    throw new Error("resource denied");
  });
  const html =
    '<head><base href="https://denied/"><style>x</style></head><script>bad</scriptx><p>bad</p></script ><p>ok<!--hidden--><iframe src="https://denied/">hidden</iframe><img src="file:///secret"><a href="&fjlig;ile:///x">link</a><custom>text</custom></p>';
  const doc = await readDocument(
    { bytes: new TextEncoder().encode(html), base: "https://ignored/" },
    { from: "html" },
    { resources: { resolve }, yield: async () => {} }
  );
  expect(resolve).not.toHaveBeenCalled();
  expect(doc.resources).toEqual([]);
  expect(doc.blocks).toEqual([
    para(
      str("ok"),
      { t: "Image", c: [empty, [], ["file:///secret", ""]] },
      { t: "Link", c: [empty, [str("link")], ["fjile:///x", ""]] },
      str("text")
    )
  ]);
});
it("constructs original figure and malformed table AST with caption and cell spans", async () => {
  const doc = await read(
    '<figure id="f"><img src="p"><figcaption>Picture</figcaption></figure><table id="t">outside<caption>Grid</caption><tr><th colspan="2">H<tr><td rowspan="2">A<td>B<tr><td>C</table>'
  );
  const cell = (text: string, r = 1, c = 1) => [empty, "AlignDefault", r, c, [plain(str(text))]];
  expect(doc.blocks).toEqual([
    {
      t: "Figure",
      c: [
        ["f", [], []],
        [null, [plain(str("Picture"))]],
        [plain({ t: "Image", c: [empty, [], ["p", ""]] })]
      ]
    },
    plain(str("outside")),
    {
      t: "Table",
      c: [
        ["t", [], []],
        [null, [plain(str("Grid"))]],
        [
          ["AlignDefault", { t: "ColWidthDefault" }],
          ["AlignDefault", { t: "ColWidthDefault" }]
        ],
        [empty, [[empty, [cell("H", 1, 2)]]]],
        [
          [
            empty,
            0,
            [],
            [
              [empty, [cell("A", 2), cell("B")]],
              [empty, [cell("C")]]
            ]
          ]
        ],
        [empty, []]
      ]
    }
  ]);
});
it("rejects invalid UTF-8 and bounds parsing including discarded content", async () => {
  for (const bytes of [
    Uint8Array.of(0xc0, 0xaf),
    Uint8Array.of(0xed, 0xa0, 0x80),
    Uint8Array.of(0xe2)
  ])
    await expect(readDocument({ bytes }, { from: "html" }, {})).rejects.toMatchObject({
      code: "E_ENCODING"
    });
  for (const [html, limits] of [
    ["<div>".repeat(20), { depth: 8 }],
    ["<script>" + "x".repeat(500) + "</script>", { text: 20 }],
    ['<p a="1" b="2">x', { attributes: 1 }],
    ["&amp;".repeat(20), { entities: 4 }],
    ["<table><tr><td>x", { tableCells: 0 }]
  ] as const)
    await expect(read(html, limits)).rejects.toMatchObject({ code: "E_LIMIT" });
});
it("drops event attributes and preserves attributes on formatted text and paragraphs", async () => {
  expect(
    (
      await read(
        '<p lang="de" onclick="evil()"><em dir="rtl" onload="evil()">text</em></p><pre id="p"><code class="js" id="c">x</code></pre>'
      )
    ).blocks
  ).toEqual([
    {
      t: "Div",
      c: [
        ["", [], [["lang", "de"]]],
        [para({ t: "Span", c: [["", [], [["dir", "rtl"]]], [{ t: "Emph", c: [str("text")] }]] })]
      ]
    },
    { t: "CodeBlock", c: [["p", ["js"], []], "x"] }
  ]);
});
it("preserves explicit table sections and defaults invalid spans", async () => {
  const doc = await read(
    '<table><thead><tr><th>Head</thead><tbody><tr><td colspan="bad" rowspan="0">Body</tbody><tfoot><tr><td>Foot</tfoot></table>'
  );
  const cell = (text: string) => [empty, "AlignDefault", 1, 1, [plain(str(text))]];
  expect(doc.blocks).toEqual([
    {
      t: "Table",
      c: [
        empty,
        [null, []],
        [["AlignDefault", { t: "ColWidthDefault" }]],
        [empty, [[empty, [cell("Head")]]]],
        [[empty, 0, [], [[empty, [cell("Body")]]]]],
        [empty, [[empty, [cell("Foot")]]]]
      ]
    }
  ]);
});
it("is invariant across byte boundaries and cancels before finishing parsing", async () => {
  const html = "<p>é&nbsp;<b>A</b></p><textarea>&lt;raw&gt;</textarea>";
  const bytes = new TextEncoder().encode(html);
  expect(
    await readDocument(
      { chunks: Array.from(bytes, (b) => Uint8Array.of(b)) },
      { from: "html" },
      { yield: async () => {} }
    )
  ).toEqual(await read(html));
  const controller = new AbortController();
  await expect(
    readDocument(
      { bytes: new TextEncoder().encode("<p>" + "x".repeat(5000)) },
      { from: "html" },
      {
        signal: controller.signal,
        yield: async () => {
          controller.abort();
        }
      }
    )
  ).rejects.toMatchObject({ code: "E_CANCELLED" });
});
it("unwraps unsupported element names that coincide with object prototype keys", async () => {
  expect((await read("<p><constructor>safe</constructor></p>")).blocks).toEqual([
    para(str("safe"))
  ]);
});

it.each([
  ["", "DefaultStyle"], ["1", "Decimal"], ["a", "LowerAlpha"],
  ["A", "UpperAlpha"], ["i", "LowerRoman"], ["I", "UpperRoman"],
  ["invalid", "DefaultStyle"], ["constructor", "DefaultStyle"]
])("preserves HTML ordered-list type %s", async (type, style) => {
  expect((await read(`<ol start="3" type="${type}"><li>First</li><li>Second</li></ol>`)).blocks).toEqual([
    {t: "OrderedList", c: [[3, style, "DefaultDelim"], [[plain(str("First"))], [plain(str("Second"))]]]}
  ]);
});

it("preserves authored attributes on table header and footer groups", async () => {
  const document = await read('<table><thead id="head" class="heading" data-kind="labels"><tr><th>Header</th></tr></thead><tbody><tr><td>Body</td></tr></tbody><tfoot id="foot" class="summary" title="Totals"><tr><td>Footer</td></tr></tfoot></table>');
  const table = document.blocks[0];
  expect(table?.t).toBe("Table");
  if (table?.t !== "Table") throw new Error("Expected table");
  expect(table.c[3][0]).toEqual(["head", ["heading"], [["data-kind", "labels"]]]);
  expect(table.c[5][0]).toEqual(["foot", ["summary"], [["title", "Totals"]]]);
});

it("preserves mixed row header emphasis without promoting data cells to headers", async () => {
  const document = await read('<table><tr><th scope="row">Label <em>detail</em></th><td>Value</td></tr></table>');
  const table = document.blocks[0];
  if (table?.t !== "Table") throw new Error("Expected table");
  expect(table.c[3][1]).toEqual([]);
  expect(table.c[4][0]?.[1]).toBe(1);
  expect(table.c[4][0]?.[3][0]?.[1].map(cell => cell[4])).toEqual([
    [plain(str("Label"), {t: "Space"}, {t: "Emph", c: [str("detail")]})],
    [plain(str("Value"))]
  ]);
});

it("keeps paragraph, div and list boundaries inside a mixed header cell", async () => {
  const document = await read('<table><tr><th><p>First</p><div id="inside"><p>Second</p></div><ul><li>Nested</li></ul></th><td><p>Regular</p></td></tr></table>');
  const table = document.blocks[0];
  if (table?.t !== "Table") throw new Error("Expected table");
  expect(table.c[4][0]?.[3][0]?.[1].map(cell => cell[4])).toEqual([
    [para(str("First")), {t: "Div", c: [["inside", [], []], [para(str("Second"))]]}, {t: "BulletList", c: [[plain(str("Nested"))]]}],
    [para(str("Regular"))]
  ]);
});

it("keeps ordinary all-header rows semantic without adding inline Strong wrappers", async () => {
  const document = await read('<table><tr><th>First</th><th>Second</th></tr><tr><td>Data</td><td>Value</td></tr></table>');
  const table = document.blocks[0];
  if (table?.t !== "Table") throw new Error("Expected table");
  expect(table.c[3][1][0]?.[1].map(cell => cell[4])).toEqual([[plain(str("First"))], [plain(str("Second"))]]);
});

it("distinguishes authored body section headings from inferred repeating table headings", async () => {
  const body = (await read('<table><tbody id="section"><tr><th>A</th><th>B</th></tr><tr><th>Label</th><td>Value</td></tr></tbody></table>')).blocks[0];
  if (body?.t !== "Table") throw new Error("Expected table");
  expect(body.c[3][1]).toHaveLength(0);
  expect(body.c[4][0]?.[0][0]).toBe("section");
  expect(body.c[4][0]?.[1]).toBe(1);
  expect(body.c[4][0]?.[2]).toHaveLength(1);
  expect(body.c[4][0]?.[3]).toHaveLength(1);
  const inferred = (await read('<table><tr><th>A</th><th>B</th></tr><tr><td>Value</td><td>Next</td></tr></table>')).blocks[0];
  if (inferred?.t !== "Table") throw new Error("Expected table");
  expect(inferred.c[3][1]).toHaveLength(1);
});

it("preserves nonprefix and varying header cells without promoting data or wrapping rich blocks in Strong", async () => {
  const table = (await read('<table><tbody><tr><th><pre>header code</pre></th><td>Data</td></tr><tr><td scope="row">Data</td><th role="cell"><pre>other header</pre></th></tr></tbody></table>')).blocks[0];
  if (table?.t !== "Table") throw new Error("Expected table");
  const body = table.c[4][0]!;
  expect(body[1]).toBe(0);
  expect(body[3][0]?.[1][0]?.[0][2]).toEqual([["role", "rowheader"]]);
  expect(body[3][0]?.[1][0]?.[4]).toEqual([{t: "CodeBlock", c: [empty, "header code"]}]);
  expect(body[3][1]?.[1][0]?.[0][2]).toEqual([]);
  expect(body[3][1]?.[1][1]?.[0][2]).toEqual([["role", "cell"], ["scope", "col"]]);
});

it("keeps body header rowspans in one row sequence and clamps spans to each authored group", async () => {
  const table = (await read('<table><tfoot><tr><th rowspan="99" colspan="2">Foot</th></tr></tfoot><tbody id="group"><tr><th rowspan="0">Header</th><th>Second</th></tr><tr><td>Data</td></tr></tbody><tbody><tr><td>Next</td><td>Group</td></tr></tbody></table>')).blocks[0];
  if (table?.t !== "Table") throw new Error("Expected table");
  expect(table.c[3][1]).toHaveLength(0);
  const body = table.c[4][0]!;
  expect(body[0][0]).toBe("group");
  expect(body[2]).toHaveLength(0);
  expect(body[3]).toHaveLength(2);
  expect(body[3][0]?.[1][0]?.[2]).toBe(2);
  expect(body[3][0]?.[1][0]?.[0][2]).toContainEqual(["role", "rowheader"]);
  expect(table.c[5][1][0]?.[1][0]?.[2]).toBe(1);
});

it("uses geometric prefix header columns for regular colspans", async () => {
  const table = (await read('<table><tbody><tr><th colspan="2">Label</th><td>Data</td></tr><tr><th>A</th><th>B</th><td>Next</td></tr></tbody></table>')).blocks[0];
  if (table?.t !== "Table") throw new Error("Expected table");
  expect(table.c[4][0]?.[1]).toBe(2);
  expect(table.c[4][0]?.[3][0]?.[1][0]?.[0][2]).toEqual([]);
});

it("omits empty authored rows without promoting a later direct row or losing its anchor", async () => {
  const document = await read('<table><tr id="empty"></tr><tr><th>A</th><th>B</th></tr></table>');
  const table = document.blocks[0];
  if (table?.t !== "Table") throw new Error("Expected table");
  expect(table.c[3][1]).toHaveLength(0);
  expect(table.c[4][0]?.[3]).toHaveLength(1);
  expect(table.c[4][0]?.[3][0]?.[1][0]?.[4]).toEqual([plain({t: "Span", c: [["empty", [], []], []]}, str("A"))]);
});

it("translates rowspans after empty-row omission and carries anchors in rendered group order", async () => {
  const document = await read('<table><tfoot><tr id="tail"></tr></tfoot><thead><tr><th rowspan="99">Top</th><th>Heading</th></tr><tr id="head-empty"></tr></thead><tbody><tr><th rowspan="0">Label</th><td>First</td></tr><tr id="body-empty"></tr><tr><td>Second</td></tr></tbody></table>');
  const table = document.blocks[0];
  if (table?.t !== "Table") throw new Error("Expected table");
  expect(table.c[3][1]).toHaveLength(1);
  expect(table.c[3][1][0]?.[1][0]?.[2]).toBe(1);
  expect(table.c[4][0]?.[3]).toHaveLength(2);
  expect(table.c[4][0]?.[3][0]?.[1][0]?.[2]).toBe(2);
  expect(table.c[4][0]?.[3][0]?.[1][0]?.[4]).toEqual([plain({t: "Span", c: [["head-empty", [], []], []]}, str("Label"))]);
  expect(table.c[4][0]?.[3][1]?.[1][0]?.[4]).toEqual([plain({t: "Span", c: [["body-empty", [], []], []]}, str("Second"))]);
  expect(table.c[5][1]).toHaveLength(0);
  expect(document.blocks[1]).toEqual(plain({t: "Span", c: [["tail", [], []], []]}));
});

it.each([
  ["00", "0", 2], ["000", "00", 2], ["0", "invalid", 2],
  ["invalid", "0", 1], ["", "", 1], ["-1", "-1", 1]
] as const)("parses numeric-zero row spans while keeping invalid and zero colspans at one: %s/%s", async (rowspan, colspan, expected) => {
  const table = (await read(`<table><tbody><tr><td rowspan="${rowspan}" colspan="${colspan}">First</td><td>Value</td></tr><tr>${expected === 1 ? "<td>Next</td>" : ""}<td>Second</td></tr></tbody></table>`)).blocks[0];
  if (table?.t !== "Table") throw new Error("Expected table");
  const cell = table.c[4][0]?.[3][0]?.[1][0];
  expect(cell?.[2]).toBe(expected);
  expect(cell?.[3]).toBe(1);
});

it.each([
  ['<ol><li>One</li><li value="5">Five</li><li>Six</li></ol>', [[1, 1], [5, 2]]],
  ['<ol reversed=""><li>Three</li><li>Two</li><li>One</li></ol>', [[3, 1], [2, 1], [1, 1]]],
  ['<ol reversed="" start="8"><li>Eight</li><li>Seven</li><li>Six</li></ol>', [[8, 1], [7, 1], [6, 1]]],
  ['<ol reversed=""><li>Three</li><li value="8">Eight</li><li>Seven</li></ol>', [[3, 1], [8, 1], [7, 1]]],
  ['<ol start="0"><li>Zero</li><li>One</li></ol>', [[0, 2]]],
  ['<ol start="-2"><li>Negative</li><li value="0">Zero</li><li>One</li></ol>', [[-2, 1], [0, 2]]],
  ['<ol reversed="" start="0"><li>Zero</li><li value="-2">Negative</li><li>Lower</li></ol>', [[0, 1], [-2, 1], [-3, 1]]],
  ['<ol><li>One</li><li value="2">Two</li><li>Three</li></ol>', [[1, 3]]],
  ['<ol start="4"><li>Four</li><li>Five</li><li>Six</li></ol>', [[4, 3]]],
  ['<ol start="invalid"><li>One</li><li value="invalid">Two</li><li>Three</li></ol>', [[1, 3]]]
] as const)("preserves HTML list numbering as increasing AST runs: %s", async (html, expected) => {
  const document = await read(html);
  expect(document.blocks.map(block => block.t === "OrderedList" ? [block.c[0][0], block.c[1].length] : block.t)).toEqual(expected);
});

it("preserves nested blocks, identifiers and styles when reversing ordered list runs", async () => {
  const document = await read('<ol type="I" reversed="" start="8"><li id="item"><p>Outer</p><ol><li>Inner</li></ol></li><li>Next</li></ol>');
  expect(document.blocks).toEqual([
    {t: "OrderedList", c: [[8, "UpperRoman", "DefaultDelim"], [[para({t: "Span", c: [["item", [], []], []]}, str("Outer")), {t: "OrderedList", c: [[1, "DefaultStyle", "DefaultDelim"], [[plain(str("Inner"))]]]}]]]},
    {t: "OrderedList", c: [[7, "UpperRoman", "DefaultDelim"], [[plain(str("Next"))]]]}
  ]);
  expect((await read('<ul reversed="" start="5"><li value="8">One</li><li>Two</li></ul>')).blocks).toEqual([{t: "BulletList", c: [[plain(str("One"))], [plain(str("Two"))]]}]);
});
