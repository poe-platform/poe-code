import {expect, it} from "vitest";
import type {CapabilityContext} from "../contracts.js";
import type {Workbook} from "../workbook.js";
import {readBiff} from "./biff.js";
import {writeBiffStream} from "./biff-write.js";
import {readBiffRecords} from "./biff-binary.js";
import {readGnumeric, writeGnumeric} from "./gnumeric.js";
const context: CapabilityContext = {signal: new AbortController().signal, own() {},
  environment: {env: {}, locale: "C", timezone: "UTC"},
  limits: {inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 4, operations: 1000}};
for (const revision of [7, 8] as const) {
  it.each([
    [{referenceMode: "R1C1"}, 0], [{referenceMode: "A1"}, 1],
    [{gnumeric: {ExprConvention: "gnumeric:R1C1"}}, 0],
    [{referenceMode: "A1", gnumeric: {ExprConvention: "gnumeric:R1C1"}}, 1],
    [{referenceMode: "R1C1", gnumeric: {ExprConvention: "gnumeric:A1"}}, 0], [{}, 1]
  ] as const)(`writes BIFF${revision} reference mode %j`, async (view, expected) => {
    const book: Workbook = {sheets: [{id: "s", name: "S", cells: [], view}]};
    const bytes = await writeBiffStream(book, revision, false, context);
    const records = readBiffRecords(bytes, context).filter(r => r.opcode === 0xf);
    expect(records.map(r => r.data.u16(0))).toEqual([expected]);
    expect((await readBiff(bytes, context)).sheets[0]!.view?.referenceMode).toBe(expected ? "A1" : "R1C1");
  });
}
it.each(["A1", "R1C1"])("retains normalized %s view through Gnumeric XML", async referenceMode => {
  const book: Workbook = {sheets: [{id: "s", name: "S", cells: [],
    view: {referenceMode, gnumeric: {ExprConvention: referenceMode === "A1" ? "gnumeric:R1C1" : "gnumeric:A1"}}}]};
  const readback = await readGnumeric(await writeGnumeric(book, [], context), context);
  expect(readback.sheets[0]!.view?.gnumeric).toMatchObject({ExprConvention: "gnumeric:" + referenceMode});
});
