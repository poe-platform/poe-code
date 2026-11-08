import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { BiffStyles } from "./biff-write-styles.js";
import { BiffOutput, writeCfb } from "./biff-write-binary.js";
import { readBiffRecords, readCfb } from "./biff-binary.js";
import { biffNode } from "./biff-metadata.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { metadataNode } from "./xlsx-write-support.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100_000, outputBytes: 100_000, cells: 100, sheets: 4, operations: 100 } };

// Independent expected values from released Gnumeric rotation_to_excel_v7/v8,
// not from a reader roundtrip or the serializer's arithmetic.
it.each([
  [7, -1, 1], [7, 0, 0], [7, 45, 0], [7, 46, 2], [7, 135, 2],
  [7, 136, 0], [7, 225, 0], [7, 226, 3], [7, 315, 3], [7, 316, 0],
  [8, -1, 255], [8, 0, 0], [8, 90, 90], [8, 270, 180], [8, 315, 135], [8, 360, 0]
] as const)("BIFF%i preserves native rotation %i as XF value %i", (revision, rotation, expected) => {
  const styles = new BiffStyles(context), output = new BiffOutput(context, revision === 8 ? 8224 : 2080);
  const style = Object.freeze({ gnumeric: biffNode("Style", { Rotation: String(rotation) }) });
  const id = styles.register({ style });
  styles.serialize(output, revision);
  const xfs = readBiffRecords(output.finish(), context).filter(record => record.opcode === 0xe0);
  const xf = xfs[id]!.data;
  expect(revision === 8 ? xf.u8(7) : xf.u8(7) & 3).toBe(expected);
  expect(styles.diagnostics).toEqual([]);
  expect(style.gnumeric).toEqual(biffNode("Style", { Rotation: String(rotation) }));
});

it.each([7, 8, "dsf"] as const)("%s row-only loss warns once without requiring an overflowing column", async profile => {
  const maximum = profile === 8 ? 65536 : 16384, messages: string[] = [];
  const result = await createBiffWriter(profile)({ sheets: [{ id: "s", name: "S", cells: [
    { row: maximum - 1, column: 0, value: { kind: "number", value: 42 } },
    { row: maximum, column: 0, value: { kind: "number", value: 99 } }
  ] }] }, [], { ...context, async diagnostic(diagnostic) { messages.push(diagnostic.message); } });
  expect(messages).toEqual([`W Some content will be lost when saving.  This format only supports ${maximum} rows, and this workbook has ${maximum}`]);
  for (const stream of readCfb(result, context).values()) {
    const numbers = readBiffRecords(stream, context).filter(record => record.opcode === 0x203);
    expect(numbers).toHaveLength(1);
    expect(numbers[0]!.data.u16(0)).toBe(maximum - 1);
  }
});

it.each([7, 8, "dsf"] as const)("%s in-bounds earlier sheets cannot suppress a later extent warning", async profile => {
  const maximum = profile === 8 ? 65536 : 16384, messages: string[] = [];
  await createBiffWriter(profile)({ sheets: [
    { id: "valid", name: "Valid", cells: [{ row: 0, column: 0, value: { kind: "number", value: 42 } }] },
    { id: "invalid", name: "Invalid", cells: [{ row: maximum + 7, column: 0, value: { kind: "number", value: 99 } }] }
  ] }, [], { ...context, async diagnostic(diagnostic) { messages.push(diagnostic.message); } });
  expect(messages).toEqual([`W Some content will be lost when saving.  This format only supports ${maximum} rows, and this workbook has ${maximum + 7}`]);
});

it.each([[90, 90], [91, 359], [180, 270], [255, -1]] as const)(
  "reads independently supplied BIFF8 XF rotation byte %i as %i", async (encoded, expected) => {
    const bytes = await createBiffWriter(8)({ sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0,
      value: { kind: "number", value: 42 } }] }] }, [], context);
    const streams = readCfb(bytes, context), stream = new Uint8Array(streams.get("Workbook")!);
    const xf = readBiffRecords(stream, context).filter(record => record.opcode === 0xe0)[15]!;
    stream[xf.offset + 4 + 7] = encoded;
    const result = await readBiff(writeCfb(new Map([["Workbook", stream]]), context), context);
    const cell = result.sheets[0]!.cells[0]!;
    expect(metadataNode(cell.style?.gnumeric)?.attributes.Rotation).toBe(String(expected));
    expect(cell.value).toEqual({ kind: "number", value: 42 });
  });

it.each([7, 8] as const)("reads BIFF%i ordinary and accounting underline bytes as distinct enum values", async revision => {
  for (const [encoded, expected] of [[1, 1], [2, 2], [33, 3], [34, 4]] as const) {
    const bytes = await createBiffWriter(revision)({ sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0,
      value: { kind: "number", value: 42 } }] }] }, [], context);
    const name = revision === 8 ? "Workbook" : "Book";
    const stream = new Uint8Array(readCfb(bytes, context).get(name)!);
    const font = readBiffRecords(stream, context).find(record => record.opcode === 0x31)!;
    stream[font.offset + 4 + 10] = encoded;
    const result = await readBiff(writeCfb(new Map([[name, stream]]), context), context);
    const cell = result.sheets[0]!.cells[0]!;
    expect(metadataNode(cell.style?.gnumeric)?.children.find(child => child.name === "Font")?.attributes.Underline).toBe(String(expected));
    expect(cell.value).toEqual({ kind: "number", value: 42 });
  }
});

it.each([7, 8] as const)("BIFF%i encodes accounting underlines and the native bold FONT flag", revision => {
  const styles = new BiffStyles(context), output = new BiffOutput(context, revision === 8 ? 8224 : 2080);
  for (const underline of [0, 1, 2, 3, 4]) styles.register({ style: { gnumeric: biffNode("Style", {}, "", [
    biffNode("Font", { Underline: String(underline), Bold: "1" }, "Serif")
  ]) } });
  styles.serialize(output, revision);
  const fonts = readBiffRecords(output.finish(), context).filter(record => record.opcode === 0x31).slice(1);
  expect(fonts.map(record => record.data.u8(10))).toEqual([0, 1, 2, 0x21, 0x22]);
  expect(fonts.map(record => record.data.u16(6))).toEqual([700, 700, 700, 700, 700]);
  expect(fonts.map(record => record.data.u16(2) & 1)).toEqual([1, 1, 1, 1, 1]);
});
