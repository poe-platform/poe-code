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
    { t: "OrderedList", c: [[3, "Decimal", "Period"], [[plain(str("X"))]]] }
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
        [empty, []],
        [
          [
            empty,
            0,
            [],
            [
              [empty, [cell("H", 1, 2)]],
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
