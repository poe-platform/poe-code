import { expect, it, vi } from "vitest";
import { normalizeDocument, normalizeDocumentCooperatively } from "./ast.js";
import { writeDocument } from "./engine.js";

const empty = { blocks: [], metadata: {}, resources: [] };
it("yields during original AST traversal so cancellation precedes cloning/writing", async () => {
  const controller = new AbortController();
  const write = vi.fn(async () => ({ kind: "text" as const, text: "unreachable" }));
  const doc = {
    ...empty,
    blocks: Array.from({ length: 300 }, () => ({ t: "HorizontalRule" as const }))
  };
  const yieldWork = vi.fn(async () => {
    controller.abort();
  });
  await expect(
    writeDocument(
      doc,
      { to: "plain" },
      { signal: controller.signal, yield: yieldWork, writer: { format: "plain", write } }
    )
  ).rejects.toMatchObject({ code: "E_CANCELLED" });
  expect(yieldWork).toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});
it("uses identical synchronous/cooperative normalization and budget boundaries", async () => {
  const cooperate = vi.fn(async () => {});
  expect(await normalizeDocumentCooperatively(empty, {}, cooperate)).toEqual(
    normalizeDocument(empty)
  );
  // Root plus its three keys/arrays = seven admitted values.
  for (const nodes of [6, 7, 8]) {
    if (nodes < 7)
      await expect(
        normalizeDocumentCooperatively(empty, { nodes }, cooperate)
      ).rejects.toMatchObject({ code: "E_LIMIT" });
    else expect(await normalizeDocumentCooperatively(empty, { nodes }, cooperate)).toEqual(empty);
  }
});
it("preserves empty documents and optional language/direction", () => {
  expect(normalizeDocument(empty)).toEqual(empty);
  expect(normalizeDocument({ ...empty, language: "", direction: "rtl" })).toEqual({
    ...empty,
    language: "",
    direction: "rtl"
  });
});
it("preserves Unicode, nested formatting, whitespace, notes in lists and images in links", () => {
  const expected = {
    ...empty,
    blocks: [
      {
        t: "Plain",
        c: [
          { t: "Str", c: "  雪😀 " },
          { t: "SoftBreak" },
          { t: "LineBreak" },
          { t: "Emph", c: [{ t: "Strong", c: [] }] }
        ]
      },
      {
        t: "BulletList",
        c: [
          [
            {
              t: "Para",
              c: [
                { t: "Note", c: [{ t: "Plain", c: [] }] },
                {
                  t: "Link",
                  c: [
                    [
                      "",
                      [],
                      [
                        ["x", "1"],
                        ["x", "2"]
                      ]
                    ],
                    [{ t: "Image", c: [["fig", [], []], [], ["image.png", ""]] }],
                    ["#fig", ""]
                  ]
                }
              ]
            }
          ]
        ]
      }
    ]
  };
  expect(normalizeDocument(expected)).toEqual(expected);
  expect(normalizeDocument(expected)).not.toBe(expected);
});
it.each([
  [{ blocks: [{ t: "Unknown" }] }, "$.blocks[0].t"],
  [{ blocks: [{ t: "Space", c: [] }] }, "$.blocks[0]"],
  [
    { metadata: { title: { t: "MetaList", c: [{ t: "Str", c: "bad" }] } } },
    "$.metadata.title.c[0].t"
  ],
  [{ blocks: [{ t: "Header", c: [NaN, ["", [], []], []] }] }, "$.blocks[0].c[0]"],
  [{ blocks: [{ t: "Table", c: [] }] }, "$.blocks[0].c"],
  [{ blocks: [{ t: "Str", c: "inline in blocks" }] }, "$.blocks[0].t"]
])("rejects malformed trees with paths", (fields, path) => {
  expect(() => normalizeDocument({ ...empty, ...fields })).toThrow(path);
});
it("rejects cycles and dangerous keys", () => {
  const blocks: unknown[] = [];
  blocks.push(blocks);
  expect(() => normalizeDocument({ ...empty, blocks })).toThrow("$.blocks[0]");
  expect(() =>
    normalizeDocument({ ...empty, metadata: JSON.parse('{"__proto__":{"t":"MetaBool","c":true}}') })
  ).toThrow("$.metadata.__proto__");
});
it.each(["nodes", "depth", "text", "attributes", "tableCells"] as const)(
  "enforces %s budgets",
  (key) => {
    const doc = {
      ...empty,
      blocks: [
        {
          t: "Table",
          c: [
            ["", [], []],
            [null, []],
            [["AlignDefault", { t: "ColWidthDefault" }]],
            [
              ["", [], []],
              [
                [
                  ["", [], []],
                  [
                    [
                      ["", [], []],
                      "AlignDefault",
                      1,
                      1,
                      [{ t: "Plain", c: [{ t: "Str", c: "x" }] }]
                    ]
                  ]
                ]
              ]
            ],
            [],
            [["", [], []], []]
          ]
        }
      ]
    };
    expect(normalizeDocument(doc)).toEqual(doc);
    expect(() => normalizeDocument(doc, { [key]: 0 })).toThrow();
  }
);
it("rejects bad reader data before writer or publication", async () => {
  const write = vi.fn(async () => ({ kind: "text" as const, text: "bad" }));
  const publish = vi.fn(async () => {});
  await expect(
    writeDocument(
      { ...empty, blocks: [{ t: "Unknown" }] } as never,
      { to: "plain" },
      { writer: { format: "plain", write }, output: { publish } }
    )
  ).rejects.toMatchObject({ code: "E_AST" });
  expect(write).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});
const table = (cells: unknown[], columns = 1) => ({
  ...empty,
  blocks: [
    {
      t: "Table",
      c: [
        ["", [], []],
        [null, []],
        Array.from({ length: columns }, () => ["AlignDefault", { t: "ColWidthDefault" }]),
        [["", [], []], [[["", [], []], cells]]],
        [],
        [["", [], []], []]
      ]
    }
  ]
});
it("preserves modern tables and absent versus empty short captions", () => {
  const expected = table([[["cell", [], []], "AlignDefault", 1, 1, []]]);
  expect(normalizeDocument(expected)).toEqual(expected);
});
it("bounds logical cells and table reference indexes before span-map growth", () => {
  const expected = table([[["", [], []], "AlignDefault", 1, 2, []]], 2);
  for (const tableCells of [1, 2, 3]) {
    if (tableCells < 2) expect(() => normalizeDocument(expected, { tableCells })).toThrow();
    else expect(normalizeDocument(expected, { tableCells })).toEqual(expected);
  }
  for (const references of [1, 2, 3]) {
    if (references < 2)
      expect(() => normalizeDocument(expected, { references })).toThrowError(/AST budget exceeded/);
    else expect(normalizeDocument(expected, { references })).toEqual(expected);
  }
});
it("checks depth and resource byte limits at their exact boundaries", () => {
  for (const depth of [0, 1, 2]) {
    if (depth < 1) expect(() => normalizeDocument(empty, { depth })).toThrow();
    else expect(normalizeDocument(empty, { depth })).toEqual(empty);
  }
  const doc = { ...empty, resources: [{ id: "original", bytes: Uint8Array.of(1, 2) }] };
  for (const resourceBytes of [1, 2, 3]) {
    if (resourceBytes < 2) expect(() => normalizeDocument(doc, { resourceBytes })).toThrow();
    else expect(normalizeDocument(doc, { resourceBytes })).toEqual(doc);
  }
});
it.each([0, -1, 1.5, 2, Infinity])("rejects invalid row spans %s", (span) => {
  expect(() => normalizeDocument(table([[["", [], []], "AlignDefault", span, 1, []]]))).toThrow(
    "$.blocks[0].c[3]"
  );
});
it("rejects column overflow", () => {
  expect(() => normalizeDocument(table([[["", [], []], "AlignDefault", 1, 2, []]]))).toThrow(
    "$.blocks[0].c[3]"
  );
});
it("preserves definition lists, typed math, captions and metadata", () => {
  const expected = {
    ...empty,
    language: "ar",
    direction: "rtl",
    metadata: {
      title: { t: "MetaInlines", c: [] },
      nested: {
        t: "MetaMap",
        c: { flag: { t: "MetaBool", c: false }, items: { t: "MetaList", c: [] } }
      }
    },
    blocks: [
      {
        t: "DefinitionList",
        c: [[[{ t: "Math", c: ["InlineMath", " x + y "] }], [[{ t: "Plain", c: [] }]]]]
      },
      { t: "Figure", c: [["id", [], []], [[], [{ t: "Para", c: [] }]], []] }
    ]
  };
  expect(normalizeDocument(expected)).toEqual(expected);
});
it("fails strictly when a writer cannot preserve math source", async () => {
  const write = vi.fn(async () => ({ kind: "text" as const, text: "lost" }));
  const doc = normalizeDocument({
    ...empty,
    blocks: [{ t: "Para", c: [{ t: "Math", c: ["DisplayMath", "x^2"] }] }]
  });
  await expect(
    writeDocument(doc, { to: "plain" }, { writer: { format: "plain", write } })
  ).rejects.toMatchObject({ code: "E_CAPABILITY" });
  expect(write).not.toHaveBeenCalled();
});
it("bounds resource bytes before cloning", () => {
  expect(() =>
    normalizeDocument(
      { ...empty, resources: [{ id: "x", bytes: new Uint8Array(2) }] },
      { resourceBytes: 1 }
    )
  ).toThrow("$.resources[0].bytes");
});
it("rejects accessors without invoking them", () => {
  const get = vi.fn(() => "danger");
  const values: unknown[] = ["", [], []];
  Object.defineProperty(values, "0", { get, enumerable: true });
  expect(() => normalizeDocument({ ...empty, blocks: [{ t: "Div", c: [values, []] }] })).toThrow();
  expect(get).not.toHaveBeenCalled();
});
it("preserves document language and direction through conversion", async () => {
  const { convert } = await import("./engine.js");
  const write = vi.fn(async (_document: import("./types.js").Document) => ({
    kind: "text" as const,
    text: "ok"
  }));
  await convert(
    [{ bytes: new Uint8Array() }],
    { from: "commonmark", to: "plain" },
    {
      reader: {
        format: "commonmark",
        read: async () => ({ ...empty, language: "ar", direction: "rtl" })
      },
      writer: { format: "plain", write }
    }
  );
  expect(write.mock.calls[0]?.[0]).toMatchObject({ language: "ar", direction: "rtl" });
});
it("rejects raised AST ceilings", () => {
  expect(() => normalizeDocument(empty, { depth: 1000000 })).toThrow("$.limits.depth");
});
it("bounds metadata key text", () => {
  expect(() =>
    normalizeDocument(
      { ...empty, metadata: { ["k".repeat(2000)]: { t: "MetaBool", c: true } } },
      { text: 1000 }
    )
  ).toThrow("$.metadata");
});
it("rejects deep nesting and malformed note metadata", () => {
  let node: unknown = { t: "Str", c: "x" };
  for (let i = 0; i < 130; i++) node = { t: "Emph", c: [node] };
  expect(() => normalizeDocument({ ...empty, blocks: [{ t: "Para", c: [node] }] })).toThrow(
    "AST budget exceeded"
  );
  expect(() =>
    normalizeDocument({
      ...empty,
      metadata: { note: { t: "MetaInlines", c: [{ t: "Note", c: [{ t: "MetaBool", c: false }] }] } }
    })
  ).toThrow("$.metadata.note.c[0].c[0].t");
});
it("accepts explicitly supported math without changing its source", async () => {
  const doc = normalizeDocument({
    ...empty,
    blocks: [{ t: "Para", c: [{ t: "Math", c: ["InlineMath", "  α\\beta  "] }] }]
  });
  const write = vi.fn(async (_doc: import("./types.js").Document) => ({
    kind: "text" as const,
    text: "ok"
  }));
  await writeDocument(doc, { to: "plain" }, { writer: { format: "plain", math: "source", write } });
  expect(write.mock.calls[0]?.[0]).toEqual(doc);
});
