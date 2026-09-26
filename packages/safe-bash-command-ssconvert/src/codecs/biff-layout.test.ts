import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { ImportedValue, Workbook } from "../workbook.js";
import { Binary, readBiffRecords } from "./biff-binary.js";
import { biffNode, readBiffMetadata } from "./biff-metadata.js";
import { words } from "./biff-write-binary.js";
import { readBiff } from "./biff.js";
import { writeBiffStream } from "./biff-write.js";
import { metadataNode } from "./xlsx-write-support.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
function book(layout: ImportedValue): Workbook {
  return { sheets: [{ id: "s", name: "Sheet1", cells: [], unsupportedRecords: [
    { source: "Gnumeric_XmlIO:sax", kind: "SheetLayout", disposition: "retained", data: layout }
  ] }] };
}
for (const revision of [7, 8] as const) {
  it(`keeps BIFF${revision} unfrozen splits distinct from frozen panes`, async () => {
    const source = await writeBiffStream(book(biffNode("SheetLayout", { TopLeft: "B3" })), revision, false, context);
    const records = readBiffRecords(source, context);
    const split = { opcode: 0x41, offset: 0, data: new Binary(words(1440, 720, 20, 10, 0)) };
    const parsed = readBiffMetadata([...records, split], revision, 1252, context);
    expect(metadataNode(parsed.records.find(r => r.kind === "SheetLayout")?.data)).toMatchObject({ attributes: { TopLeft: "B3" }, children: [] });
    const warnings: string[] = [];
    const retained: Workbook = { sheets: [{ ...book(biffNode("SheetLayout", { TopLeft: "B3" })).sheets[0]!, unsupportedRecords: [
      ...parsed.records, { source: "biff", kind: "PANE", disposition: "retained", data: { opcode: 0x41, bytes: "a005d00214000a000000" } }
    ] }] };
    await writeBiffStream(retained, revision, false, { ...context, async diagnostic(d) { warnings.push(d.message); } });
    expect(warnings).toContain("Unsupported Excel BIFF export metadata: PANE");
  });
  it(`refuses BIFF${revision} reversed frozen ranges and oversized rows`, async () => {
    const reversed = biffNode("SheetLayout", { TopLeft: "A1" }, "", [biffNode("FreezePanes", { FrozenTopLeft: "B3", UnfrozenTopLeft: "A1" })]);
    await expect(writeBiffStream(book(reversed), revision, false, context)).rejects.toThrow("layout");
    await expect(writeBiffStream(book(biffNode("SheetLayout", { TopLeft: revision === 7 ? "A16385" : "A65537" })), revision, false, context)).rejects.toThrow("layout");
  });
  for (const [x, y, row, column, origin, end] of [[3, 0, 20, 1, "B1", "E1"], [0, 4, 2, 10, "A3", "A7"]] as const) {
    it(`imports BIFF${revision} single-axis panes ${x}/${y} from independent records`, () => {
      const parsed = readBiffMetadata([
        { opcode: 0x23e, offset: 0, data: new Binary(words(0x7be, row, column, 64, 0, 0, 125, 125, 0)) },
        { opcode: 0x41, offset: 22, data: new Binary(words(x, y, y ? 20 : 0, x ? 10 : 0, x ? 1 : 2)) }
      ], revision, 1252, context);
      expect(metadataNode(parsed.records.find(r => r.kind === "SheetLayout")?.data)).toMatchObject({
        attributes: { TopLeft: "K21" }, children: [{ name: "FreezePanes", attributes: { FrozenTopLeft: origin, UnfrozenTopLeft: end } }]
      });
    });
  }
  it(`imports BIFF${revision} scrolled frozen panes from independent records`, () => {
    const records = [
      { opcode: 0x23e, offset: 0, data: new Binary(words(0x7be, 2, 1, 64, 0, 0, 125, 125, 0)) },
      { opcode: 0x41, offset: 22, data: new Binary(words(3, 4, 20, 10, 0)) }
    ];
    const parsed = readBiffMetadata(records, revision, 1252, context);
    expect(metadataNode(parsed.records.find(r => r.kind === "SheetLayout")?.data)).toMatchObject({
      attributes: { TopLeft: "K21" }, children: [{ name: "FreezePanes", attributes: { FrozenTopLeft: "B3", UnfrozenTopLeft: "E7" } }]
    });
  });
  for (const [x, y, pane] of [[3, 4, 0], [3, 0, 1], [0, 4, 2]] as const) {
    it(`exports BIFF${revision} frozen panes ${x}/${y} with the correct active pane`, async () => {
      const origin = x ? y ? "B3" : "B1" : "A3", end = x ? y ? "E7" : "E1" : "A7";
      const source = biffNode("SheetLayout", { TopLeft: "K21" }, "", [
        biffNode("FreezePanes", { FrozenTopLeft: origin, UnfrozenTopLeft: end })
      ]);
      const warnings: string[] = [];
      const bytes = await writeBiffStream(book(source), revision, false, { ...context, async diagnostic(d) { warnings.push(d.message); } });
      const records = readBiffRecords(bytes, context), window = records.find(r => r.opcode === 0x23e)!.data;
      expect([window.u16(0) & 0x108, window.u16(2), window.u16(4)]).toEqual([0x108, y ? 2 : 20, x ? 1 : 10]);
      const split = records.find(r => r.opcode === 0x41)!.data;
      expect([split.u16(0), split.u16(2), split.u16(4), split.u16(6), split.u8(8)]).toEqual([x, y, 20, 10, pane]);
      const restored = await readBiff(bytes, context);
      expect(restored.sheets[0]!.unsupportedRecords?.find(r => r.kind === "SheetLayout")?.data).toEqual(source);
      expect(warnings).toEqual([]);
    });
  }
  it(`preserves BIFF${revision} scrolling without inventing panes`, async () => {
    const source = biffNode("SheetLayout", { TopLeft: "G12" });
    const bytes = await writeBiffStream(book(source), revision, false, context), records = readBiffRecords(bytes, context);
    const window = records.find(r => r.opcode === 0x23e)!.data;
    expect([window.u16(2), window.u16(4), window.u16(0) & 8]).toEqual([11, 6, 0]);
    expect(records.some(r => r.opcode === 0x41)).toBe(false);
    expect((await readBiff(bytes, context)).sheets[0]!.unsupportedRecords?.find(r => r.kind === "SheetLayout")?.data).toEqual(source);
  });
  it(`keeps BIFF${revision} unknown layout warnings`, async () => {
    const warnings: string[] = [];
    await writeBiffStream(book(biffNode("SheetLayout", { TopLeft: "A1" }, "", [biffNode("Unknown", {})])), revision, false,
      { ...context, async diagnostic(d) { warnings.push(d.message); } });
    expect(warnings).toContain("Unsupported Excel BIFF export metadata: SheetLayout");
  });
  it(`refuses BIFF${revision} unrepresentable layout coordinates`, async () => {
    await expect(writeBiffStream(book(biffNode("SheetLayout", { TopLeft: "IW1" })), revision, false, context)).rejects.toThrow("layout");
  });
}
