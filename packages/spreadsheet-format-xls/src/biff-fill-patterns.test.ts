import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { readBiff } from "./biff.js";
import { readBiffRecords } from "./biff-binary.js";
import { biffNode } from "./biff-metadata.js";
import { BiffOutput, words } from "./biff-write-binary.js";
import { BiffStyles } from "./biff-write-styles.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 4, operations: 10000 } };
// Native released BIFF pattern table, independent of the implementation's tables.
const imported = [0, 1, 3, 2, 4, 7, 8, 10, 9, 11, 12, 13, 14, 15, 16, 17, 18, 5, 6];
const exported = [0, 1, 3, 2, 4, 17, 18, 5, 6, 8, 7, 9, 10, 11, 12, 13, 14, 15, 16, 12, 5, 4, 4, 3, 1];
for (const revision of [3, 4, 7, 8]) for (const [wire, shade] of imported.entries()) it(`imports BIFF${revision} pattern${wire} as shade${shade}`, async () => {
  const out = new BiffOutput(context, 2080);out.record(revision < 7 ? revision === 3 ? 0x209 : 0x409 : 0x809, words(revision < 7 ? revision << 8 : revision === 7 ? 0x500 : 0x600, 0x10));
  const xf = new Uint8Array(revision < 7 ? 12 : revision === 7 ? 16 : 20), view = new DataView(xf.buffer);
  if (revision < 7) view.setUint16(6, wire, true);
  else if (revision === 7) view.setUint16(10, wire, true);
  else view.setUint32(14, wire << 26, true);
  out.record(revision < 7 ? revision === 3 ? 0x243 : 0x443 : 0xe0, xf);
  const number = new Uint8Array(14);new DataView(number.buffer).setFloat64(6, 1, true);out.record(0x203, number);out.record(10);
  const style = metadataNode((await readBiff(out.finish(), context)).sheets[0]!.cells[0]!.style!.gnumeric)!;
  expect(Number(style.attributes.Shade)).toBe(shade);
});
for (const revision of [7, 8] as const) for (const [shade, wire] of exported.entries()) it(`exports shade${shade} as BIFF${revision} pattern${wire}`, () => {
  const out = new BiffOutput(context, 8224), styles = new BiffStyles(context);
  styles.register({ style: { gnumeric: biffNode("Style", { Shade: shade, Back: "FFFF:FFFF:0", PatternColor: "FFFF:0:0" }) } });
  styles.serialize(out, revision);
  const xf = readBiffRecords(out.finish(), context).filter(record => record.opcode === 0xe0).at(-1)!;
  expect(revision === 7 ? xf.data.u16(10) & 63 : xf.data.u32(14) >>> 26).toBe(wire);
  expect(xf.data.u16(revision === 7 ? 8 : 18) & 127).toBe(wire === 1 ? 5 : 2);
});
for (const shade of [-1, 25, 26, 1.5, Infinity, NaN]) it(`rejects unrepresentable BIFF fill shade${shade}`, () => {
  const styles = new BiffStyles(context);styles.register({ style: { gnumeric: biffNode("Style", { Shade: shade }) } });
  expect(() => styles.serialize(new BiffOutput(context, 8224), 8)).toThrow("fill pattern");
});
