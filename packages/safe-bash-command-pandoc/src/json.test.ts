import { expect, it, vi } from "vitest";
import { convert, readDocument, writeDocument } from "./index.js";
import type { Document } from "./types.js";

const attr = [
  "識😀",
  ["first", "second"],
  [
    ["x", "1"],
    ["x", "2"]
  ]
];
const text = [{ t: "Str", c: " 雪😀é é " }];
const para = { t: "Para", c: text };
const empty = { blocks: [], metadata: {}, resources: [] };
const envelope = (blocks: unknown[], meta: unknown = {}) => ({
  "pandoc-api-version": [1, 23, 1, 2],
  meta,
  blocks
});
const input = (value: unknown) => ({ bytes: new TextEncoder().encode(JSON.stringify(value)) });
// Independent expected wire enum objects; never derive expectations using the codec.
const inlineCases: [unknown, unknown][] = [
  ...["Str", "Space", "SoftBreak", "LineBreak"].map((t): [unknown, unknown] => {
    const node = t === "Str" ? { t, c: " 雪😀é é " } : { t };
    return [node, node];
  }),
  ...["Emph", "Underline", "Strong", "Strikeout", "Superscript", "Subscript", "SmallCaps"].map(
    (t): [unknown, unknown] => [
      { t, c: text },
      { t, c: text }
    ]
  ),
  ...["SingleQuote", "DoubleQuote"].map((t): [unknown, unknown] => [
    { t: "Quoted", c: [t, text] },
    { t: "Quoted", c: [{ t }, text] }
  ]),
  ...["InlineMath", "DisplayMath"].map((t): [unknown, unknown] => [
    { t: "Math", c: [t, " α\\beta "] },
    { t: "Math", c: [{ t }, " α\\beta "] }
  ]),
  [
    { t: "Code", c: [attr, "\nλ"] },
    { t: "Code", c: [attr, "\nλ"] }
  ],
  [
    { t: "RawInline", c: ["html", "<i>雪</i>"] },
    { t: "RawInline", c: ["html", "<i>雪</i>"] }
  ],
  ...["Link", "Image"].map((t): [unknown, unknown] => [
    { t, c: [attr, text, ["a?b=1", "title"]] },
    { t, c: [attr, text, ["a?b=1", "title"]] }
  ]),
  [
    { t: "Note", c: [para] },
    { t: "Note", c: [para] }
  ],
  [
    { t: "Span", c: [attr, text] },
    { t: "Span", c: [attr, text] }
  ],
  ...["AuthorInText", "SuppressAuthor", "NormalCitation"].map((t): [unknown, unknown] => {
    const citation = {
      citationId: "雪",
      citationPrefix: text,
      citationSuffix: [],
      citationMode: t,
      citationNoteNum: -3,
      citationHash: 42
    };
    return [
      { t: "Cite", c: [[citation], text] },
      { t: "Cite", c: [[{ ...citation, citationMode: { t } }], text] }
    ];
  })
];
const blockCases: [unknown, unknown][] = [
  ...["Plain", "Para"].map((t): [unknown, unknown] => [
    { t, c: text },
    { t, c: text }
  ]),
  [
    { t: "LineBlock", c: [text, []] },
    { t: "LineBlock", c: [text, []] }
  ],
  [
    { t: "CodeBlock", c: [attr, "α\n"] },
    { t: "CodeBlock", c: [attr, "α\n"] }
  ],
  [
    { t: "RawBlock", c: ["tex", "\\raw"] },
    { t: "RawBlock", c: ["tex", "\\raw"] }
  ],
  [
    { t: "BlockQuote", c: [para] },
    { t: "BlockQuote", c: [para] }
  ],
  [
    { t: "BulletList", c: [[para], []] },
    { t: "BulletList", c: [[para], []] }
  ],
  [
    { t: "DefinitionList", c: [[text, [[para], []]]] },
    { t: "DefinitionList", c: [[text, [[para], []]]] }
  ],
  [
    { t: "Header", c: [2, attr, text] },
    { t: "Header", c: [2, attr, text] }
  ],
  [{ t: "HorizontalRule" }, { t: "HorizontalRule" }],
  [
    { t: "Div", c: [attr, [para]] },
    { t: "Div", c: [attr, [para]] }
  ],
  ...[null, [], text].map((short): [unknown, unknown] => [
    { t: "Figure", c: [attr, [short, [para]], [para]] },
    { t: "Figure", c: [attr, [short, [para]], [para]] }
  ]),
  ...[
    "DefaultStyle",
    "Example",
    "Decimal",
    "LowerRoman",
    "UpperRoman",
    "LowerAlpha",
    "UpperAlpha"
  ].flatMap((style) =>
    ["DefaultDelim", "Period", "OneParen", "TwoParens"].map((delim): [unknown, unknown] => [
      {
        t: "OrderedList",
        c: [
          [-2, style, delim],
          [[para], []]
        ]
      },
      {
        t: "OrderedList",
        c: [
          [-2, { t: style }, { t: delim }],
          [[para], []]
        ]
      }
    ])
  )
];
const metadata = {
  emptyMap: { t: "MetaMap", c: {} },
  emptyList: { t: "MetaList", c: [] },
  flag: { t: "MetaBool", c: false },
  string: { t: "MetaString", c: "雪😀" },
  inlines: { t: "MetaInlines", c: text },
  blocks: { t: "MetaBlocks", c: [para] },
  nested: { t: "MetaMap", c: { list: { t: "MetaList", c: [{ t: "MetaBool", c: true }] } } }
};
it.each(inlineCases)(
  "round-trips original inline %# against independent JSON",
  async (ast, json) => {
    const doc = { ...empty, blocks: [{ t: "Para", c: [ast] }] } as Document;
    const expected = envelope([{ t: "Para", c: [json] }]);
    expect(await readDocument(input(expected), { from: "json" }, {})).toEqual(doc);
    const result = await writeDocument(doc, { to: "json" }, {});
    expect(result.kind).toBe("text");
    expect(JSON.parse((result as { text: string }).text)).toEqual(expected);
  }
);
it.each(blockCases)("round-trips original block %# against independent JSON", async (ast, json) => {
  const doc = { ...empty, blocks: [ast], metadata } as Document;
  const expected = envelope([json], metadata);
  expect(await readDocument(input(expected), { from: "json" }, {})).toEqual(doc);
  const result = await writeDocument(doc, { to: "json" }, {});
  expect(JSON.parse((result as { text: string }).text)).toEqual(expected);
});
function table(align: unknown, width: unknown, cellAlign: unknown) {
  return {
    t: "Table",
    c: [
      attr,
      [[], [para]],
      [
        [align, width],
        [align, { t: "ColWidthDefault" }]
      ],
      [attr, [[attr, [[attr, cellAlign, 1, 2, [para]]]]]],
      [
        [
          attr,
          1,
          [],
          [
            [
              attr,
              [
                [attr, cellAlign, 2, 1, []],
                [attr, cellAlign, 1, 1, [para]]
              ]
            ],
            [attr, [[attr, cellAlign, 1, 1, []]]]
          ]
        ]
      ],
      [
        attr,
        [
          [
            attr,
            [
              [attr, cellAlign, 1, 1, []],
              [attr, cellAlign, 1, 1, []]
            ]
          ]
        ]
      ]
    ]
  };
}
it.each(["AlignDefault", "AlignLeft", "AlignCenter", "AlignRight"])(
  "preserves modern table geometry and %s",
  async (t) => {
    const ast = table(t, { t: "ColWidth", c: 0.4 }, t);
    const json = table({ t }, { t: "ColWidth", c: 0.4 }, { t });
    const doc = { ...empty, blocks: [ast] } as Document;
    const expected = envelope([json]);
    expect(await readDocument(input(expected), { from: "json" }, {})).toEqual(doc);
    expect(
      JSON.parse(((await writeDocument(doc, { to: "json" }, {})) as { text: string }).text)
    ).toEqual(expected);
  }
);
it("converts chunked Unicode JSON without native capabilities", async () => {
  const expected = envelope([], metadata);
  const bytes = input(expected).bytes;
  const result = await convert(
    [{ chunks: Array.from(bytes, (b) => Uint8Array.of(b)) }],
    { from: "json", to: "json" },
    {}
  );
  expect(JSON.parse((result as { text: string }).text)).toEqual(expected);
});
it.each([
  envelope([{ t: "FutureBlock" }]),
  envelope([{ t: "Null" }]),
  envelope([{ t: "HorizontalRule", c: [] }]),
  envelope([{ t: "Header", c: [1, attr] }]),
  envelope([{ t: "Header", c: [1.5, attr, []] }]),
  envelope([{ t: "Header", c: [9007199254740992, attr, []] }]),
  envelope([{ t: "Div", c: [["", [], [["x"]]], []] }]),
  envelope([{ t: "Para", c: [{ t: "Math", c: ["InlineMath", "x"] }] }]),
  envelope([{ t: "Para", c: [{ t: "Math", c: [{ t: "FutureMath" }, "x"] }] }]),
  envelope([{ t: "Para", c: [{ t: "Quoted", c: [{ t: "SingleQuote", c: [] }, []] }] }]),
  envelope([], { x: { t: "MetaList", c: [{}] } }),
  { ...envelope([]), "pandoc-api-version": [1, 23] },
  { ...envelope([]), "pandoc-api-version": [1, 23, 1, 3] },
  { ...envelope([]), "pandoc-api-version": [1, 22, 2, 1] },
  { meta: {}, blocks: [] },
  { ...envelope([]), extra: 1 }
])("rejects invalid wire AST %# before publication", async (value) => {
  const publish = vi.fn(async () => {});
  await expect(
    convert([input(value)], { from: "json", to: "json" }, { output: { publish } })
  ).rejects.toMatchObject({ code: "E_AST" });
  expect(publish).not.toHaveBeenCalled();
});
it.each([
  '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[],"blocks":[]}',
  '{"pandoc-api-version":[1,23,1,2],"meta":{"x":{"t":"MetaMap","c":{"a":{"t":"MetaBool","c":true},"\\u0061":{"t":"MetaBool","c":false}}}},"blocks":[]}',
  '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[],}',
  '{/*comment*/"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[]}',
  '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[]} true',
  '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Header","c":[9007199254740990.1,["",[],[]],[]]}]}'
])("rejects duplicate keys/invalid JSON/rounded integers %#", async (text) => {
  await expect(
    readDocument({ bytes: new TextEncoder().encode(text) }, { from: "json" }, {})
  ).rejects.toMatchObject({ code: "E_AST" });
});
it("rejects invalid writer trees and unrepresentable document fields before output", async () => {
  for (const doc of [
    { ...empty, blocks: [{ t: "FutureBlock" }] },
    { ...empty, resources: [{ id: "image", bytes: Uint8Array.of(1) }] },
    { ...empty, language: "ar" },
    { ...empty, direction: "rtl" }
  ]) {
    const publish = vi.fn(async () => {});
    await expect(
      writeDocument(doc as Document, { to: "json" }, { output: { publish } })
    ).rejects.toBeDefined();
    expect(publish).not.toHaveBeenCalled();
  }
});
it("round-trips empty document and deeply nested typed content", async () => {
  const expected = envelope(
    [
      {
        t: "Div",
        c: [
          attr,
          [
            {
              t: "Para",
              c: [
                {
                  t: "Note",
                  c: [
                    {
                      t: "Figure",
                      c: [
                        attr,
                        [null, []],
                        [
                          {
                            t: "Para",
                            c: [
                              {
                                t: "Span",
                                c: [attr, [{ t: "Math", c: [{ t: "DisplayMath" }, "α"] }]]
                              }
                            ]
                          }
                        ]
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        ]
      }
    ],
    {
      list: {
        t: "MetaList",
        c: [{ t: "MetaInlines", c: [{ t: "Quoted", c: [{ t: "DoubleQuote" }, text] }] }]
      }
    }
  );
  for (const value of [envelope([]), expected]) {
    const doc = await readDocument(input(value), { from: "json" }, {});
    expect(
      JSON.parse(((await writeDocument(doc, { to: "json" }, {})) as { text: string }).text)
    ).toEqual(value);
  }
});
it.each([
  "spanZero",
  "spanFraction",
  "rowOverflow",
  "columnOverflow",
  "rowHeadOverflow",
  "overlap",
  "cellArity",
  "tableArity",
  "captionArity",
  "width",
  "alignment",
  "nested"
])("rejects malformed modern table %s before writer or publication", async (kind) => {
  const json = table({ t: "AlignLeft" }, { t: "ColWidth", c: 0.4 }, { t: "AlignDefault" }) as {
    c: unknown[];
  };
  const at = (value: unknown, ...indices: number[]): unknown[] => {
    for (const i of indices) value = (value as unknown[])[i];
    return value as unknown[];
  };
  const headCell = at(json.c, 3, 1, 0, 1, 0);
  if (kind === "spanZero") headCell[2] = 0;
  if (kind === "spanFraction") headCell[3] = 1.5;
  if (kind === "rowOverflow") headCell[2] = 2;
  if (kind === "columnOverflow") headCell[3] = 3;
  if (kind === "rowHeadOverflow") at(json.c, 4, 0)[1] = 3;
  if (kind === "overlap") {
    at(json.c, 4, 0, 3, 0)[1] = [
      [attr, { t: "AlignDefault" }, 1, 1, []],
      [attr, { t: "AlignDefault" }, 2, 1, []]
    ];
    at(json.c, 4, 0, 3, 1, 1, 0)[3] = 2;
  }
  if (kind === "cellArity") headCell.pop();
  if (kind === "tableArity") json.c.pop();
  if (kind === "captionArity") at(json.c, 1).push([]);
  if (kind === "width") (at(json.c, 2, 0)[1] as { c: number }).c = -0.5;
  if (kind === "alignment") headCell[1] = { t: "FutureAlignment" };
  if (kind === "nested") headCell[4] = [{ t: "Para", c: [{ t: "FutureInline" }] }];
  const write = vi.fn(async () => ({ kind: "text" as const, text: "should not run" }));
  const publish = vi.fn(async () => {});
  await expect(
    convert(
      [input(envelope([json]))],
      { from: "json", to: "json" },
      {
        writer: { format: "json", math: "source", write },
        output: { publish }
      }
    )
  ).rejects.toMatchObject({ code: "E_AST" });
  expect(write).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});
it("bounds and cancels JSON token parsing before publication", async () => {
  const publish = vi.fn(async () => {});
  const deep =
    '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":' +
    "[".repeat(200) +
    "]".repeat(200) +
    "}";
  await expect(
    readDocument(
      { bytes: new TextEncoder().encode(deep) },
      { from: "json" },
      {
        limits: { depth: 16 }
      }
    )
  ).rejects.toMatchObject({ code: "E_LIMIT" });
  const controller = new AbortController();
  await expect(
    convert(
      [input(envelope([para]))],
      { from: "json", to: "json" },
      {
        signal: controller.signal,
        output: { publish },
        yield: async () => {
          controller.abort();
        }
      }
    )
  ).rejects.toMatchObject({ code: "E_CANCELLED" });
  expect(publish).not.toHaveBeenCalled();
});
it.each([Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])(
  "preserves exact citation integer boundary %s",
  async (n) => {
    const expected = envelope([
      {
        t: "Para",
        c: [
          {
            t: "Cite",
            c: [
              [
                {
                  citationId: "id",
                  citationPrefix: [],
                  citationSuffix: [],
                  citationMode: { t: "AuthorInText" },
                  citationNoteNum: n,
                  citationHash: n
                }
              ],
              []
            ]
          }
        ]
      }
    ]);
    const doc = await readDocument(input(expected), { from: "json" }, {});
    expect(
      JSON.parse(((await writeDocument(doc, { to: "json" }, {})) as { text: string }).text)
    ).toEqual(expected);
  }
);
it.each([
  { t: "Para", c: [{ t: "Str", c: "\ud800" }] },
  { t: "CodeBlock", c: [["", [false], []], "text"] },
  { t: "Figure", c: [attr, [false, []], []] },
  {
    t: "Para",
    c: [
      {
        t: "Cite",
        c: [
          [
            {
              citationId: "id",
              citationPrefix: [],
              citationSuffix: [],
              citationMode: { t: "NormalCitation" },
              citationNoteNum: 1.5,
              citationHash: 0
            }
          ],
          []
        ]
      }
    ]
  },
  {
    t: "Para",
    c: [
      {
        t: "Cite",
        c: [
          [
            {
              citationId: "id",
              citationPrefix: [],
              citationSuffix: [],
              citationMode: { t: "NormalCitation" },
              citationNoteNum: 1,
              citationHash: -9007199254740992
            }
          ],
          []
        ]
      }
    ]
  }
])("rejects malformed nested text/attrs/captions/citations %#", async (node) => {
  await expect(readDocument(input(envelope([node])), { from: "json" }, {})).rejects.toMatchObject({
    code: "E_AST"
  });
});
