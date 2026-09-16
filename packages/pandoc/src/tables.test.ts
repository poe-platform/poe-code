import { expect, it, vi } from "vitest";
import { normalizeDocument } from "./ast.js";
import { writeDocument } from "./engine.js";
import type { Attr, Block, Cell, Row, TableBody } from "./ast-types.js";
import type { Document } from "./types.js";

export const attr: Attr = ["", [], []];
export const cell = (text: string, rs = 1, cs = 1): Cell =>
  [attr, "AlignDefault", rs, cs, [{ t: "Plain", c: [{ t: "Str", c: text }] }]];
export const row = (...cells: Cell[]): Row => [attr, cells];
export function table(columns: number, rows: readonly Row[], head: readonly Row[] = [], bodies?: readonly TableBody[]): Document {
  return { blocks: [{ t: "Table", c: [attr, [null, []],
    Array.from({ length: columns }, () => ["AlignDefault", { t: "ColWidthDefault" }] as const),
    [attr, head], bodies ?? [[attr, 0, [], rows]], [attr, []]] }], metadata: {}, resources: [] };
}

it.each([row(), row(cell("short")), row(cell("too"), cell("many"), cell("cells"))].map(r => ({r})))(
  "rejects incomplete or overflowing rows instead of padding/truncation", ({r}) => {
    expect(() => normalizeDocument(table(2, [r]))).toThrow("$.blocks[0].c[4][0][3][0]");
  }
);
it("rejects cells straddling row-header columns", () => {
  expect(() => normalizeDocument(table(2, [], [], [[attr, 1, [], [row(cell("cross", 1, 2))]]])))
    .toThrow("Row header boundary");
});
it("accepts empty rows completely occupied by prior row spans", () => {
  const doc = table(2, [row(cell("A", 2, 2)), row()]);
  expect(normalizeDocument(doc)).toEqual(doc);
});
it("rejects overlapping occupancy after the first free column", () => {
  expect(() => normalizeDocument(table(3, [row(cell("a"), cell("b", 2), cell("c")), row(cell("over", 1, 2))])))
    .toThrow("Overlapping spans");
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER])("rejects invalid spans %s without grid allocation", span => {
  for (const c of [cell("a", span), cell("b", 1, span)])
    expect(() => normalizeDocument(table(1, [row(c)]))).toThrow();
});
it("rejects spans across head, body head, body and footer boundaries", () => {
  for (const doc of [table(1, [row(cell("body"))], [row(cell("head", 2))]),
    table(1, [], [], [[attr, 0, [row(cell("bodyhead", 2))], [row(cell("body"))]]]),
    table(1, [], [], [[attr, 0, [], [row(cell("body", 2))]], [attr, 0, [], [row(cell("next"))]]])])
    expect(() => normalizeDocument(doc)).toThrow("Span exceeds table section");
});
it("validates before trusted writers and output publication", async () => {
  const write = vi.fn(async () => ({ kind: "text" as const, text: "bad" }));
  const publish = vi.fn(async () => {});
  await expect(writeDocument(table(2, [row(cell("short"))]), { to: "plain" },
    { writer: { format: "plain", write }, output: { publish } })).rejects.toMatchObject({ code: "E_AST" });
  expect(write).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
});
it("preserves captions, colspecs, all sections and cell order with bounded generated tables", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const columns = seed % 5 + 1;
    const rows = Array.from({ length: seed % 7 + 1 }, (_, r) => row(...Array.from({ length: columns }, (_, c) => cell(`${seed}:${r}:${c} 雪`))));
    const doc = table(columns, rows, [row(...Array.from({ length: columns }, (_, c) => cell(`h${c}`)))]);
    const normalized = normalizeDocument(doc);
    expect(normalized).toEqual(doc);
    expect(normalizeDocument(normalized)).toEqual(normalized);
  }
  const t = table(2, [], [row(cell("head", 1, 2))], [[attr, 1, [row(cell("bh"), cell("bh2"))], [row(cell("rh"), cell("data"))]], [attr, 0, [], [row(cell("next", 1, 2))]]]);
  const original = t.blocks[0] as Extract<Block, { t: "Table" }>;
  const doc: Document = { ...t, blocks: [{ ...original, c: [attr, [[], [{ t: "Para", c: [{ t: "Str", c: "caption" }] }]], [["AlignLeft", { t: "ColWidth", c: 0.4 }], ["AlignRight", { t: "ColWidthDefault" }]], original.c[3], original.c[4], [attr, [row(cell("foot", 1, 2))]]] }] };
  expect(normalizeDocument(doc)).toEqual(doc);
});
