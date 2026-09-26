import { expect, it } from "vitest";
import { snapshotRecords, snapshotWorkbook } from "./model.js";
import { byteStringValue, decodeByteString, joinByteText } from "../encoding/byte-value.js";
import { rendered } from "../formulas/values.js";
import { createEngine } from "../engine.js";
import { createFormattingCapability } from "../formatting/cell-text.js";
import type { Workbook } from "../workbook.js";

const limits = { inputBytes: 1000, outputBytes: 1000, cells: 10, sheets: 3, operations: 10 };
const raw: Workbook = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0, value: { kind: "byte-string", value: "c324" } }] }] };
it("owns immutable canonical raw text through JSON replay and rejects host capabilities", () => {
  const owned = snapshotWorkbook(raw, limits);
  expect(snapshotWorkbook(JSON.parse(JSON.stringify(owned)) as Workbook, limits)).toEqual(owned);
  expect(Object.isFrozen(owned.sheets[0]!.cells[0]!.value)).toBe(true);
  expect(() => snapshotRecords(Uint8Array.of(0xc3), limits)).toThrow("prototype");
  let calls = 0;
  const value = Object.defineProperty({ kind: "byte-string" }, "value", { get() { calls++; return "c324"; } });
  expect(() => snapshotWorkbook({ sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0, value: value as never }] }] }, limits)).toThrow("accessor");
  expect(calls).toBe(0);
});
it.each(["", "C324", "c3z4", "c", "c30024", "61", "c3a4"])("refuses noncanonical opaque payload %s", value => {
  expect(() => snapshotWorkbook({ sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0, value: { kind: "byte-string", value } }] }] }, limits)).toThrow();
});
it("separately bounds logical output and encoded snapshot storage", () => {
  expect(() => byteStringValue(Uint8Array.of(0xc3, 0x24), () => {}, 1)).toThrow("text limit");
  expect(() => snapshotRecords({ payload: "c324" }, { ...limits, workbookTextBytes: 10 })).toThrow("text limit");
  expect(snapshotRecords({ payload: "c324" }, { ...limits, workbookTextBytes: 11 })).toEqual({ payload: "c324" });
  expect(() => decodeByteString("c324", () => {}, 1)).toThrow("byte limit");
  expect(() => joinByteText([Uint8Array.of(0xc3), Uint8Array.of(0x24)], new Uint8Array(), 1, () => {})).toThrow("text limit");
});
it("keeps BOM, C-string boundaries and admitted bytes without borrowed mutation", () => {
  const source = Uint8Array.of(0xc3, 0x24, 0, 65);
  const value = byteStringValue(source, () => {}, 100);
  source.fill(0);
  expect(value).toEqual({ kind: "byte-string", value: "c324" });
  expect(byteStringValue(Uint8Array.of(0xef, 0xbb, 0xbf, 65), () => {}, 100)).toEqual({ kind: "string", value: "\ufeffA" });
});
it("cooperates before byte decoding allocation and during owned joining", () => {
  for (const action of [(tick: () => void) => decodeByteString("c324".repeat(100), tick),
    (tick: () => void) => joinByteText([new Uint8Array(100).fill(65)], new Uint8Array(), 100, tick)]) {
    let work = 0;
    expect(() => action(() => { if (++work === 9) throw new Error("byte cancellation"); })).toThrow("byte cancellation");
    expect(work).toBe(9);
  }
});
it("refuses unqualified writers before opening or modifying a destination", async () => {
  let opened = 0, writes = 0;
  const engine = createEngine({ codecs: [{ id: "owned-raw", description: "Owned raw fixture", extensions: ["raw"], async read() { return raw; } }], environment: { env: {}, locale: "C", timezone: "UTC" }, limits,
    filesystem: { async read() { return []; }, async write() { writes++; }, async openOutput() { opened++; return undefined; } } });
  try {
    const book = await engine.readWorkbook({ kind: "stream", filename: "input.raw", source: [Uint8Array.of(1)] }, { importType: "owned-raw" }, { signal: new AbortController().signal });
    for (const options of [{ exportType: "Gnumeric_Excel:xlsx" }, { exportType: "Gnumeric_XmlIO:sax:0" },
      { exportType: "Gnumeric_stf:stf_assistant", exportOptions: ["charset=ISO-8859-1"] }])
      await expect(engine.writeWorkbook(book, { kind: "resource", uri: "/existing" }, options, { signal: new AbortController().signal })).rejects.toThrow("byte-string export");
    expect(opened).toBe(0); expect(writes).toBe(0);
  } finally { await engine.dispose(); }
});
it("never renders opaque hex as Unicode text", async () => {
  const value = raw.sheets[0]!.cells[0]!.value;
  expect(() => rendered(value)).toThrow("Unicode rendering");
  await expect(createFormattingCapability().format(value, "General", { own() {}, signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" }, limits })).rejects.toThrow("byte-string");
});
