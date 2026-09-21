import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import type { Workbook } from "../workbook.js";

function databaseFixture(book: Workbook) {
  const volume = Volume.fromJSON({ "/keep": "original" });
  const engine = createEngine({ codecs: [{ id: "fixture", description: "fixture", extensions: [], async read() { return book; } }],
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 10000 },
    environment: { env: {}, locale: "C", timezone: "UTC" }, filesystem: {
      async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); }
    } });
  return { volume, engine, operation: { signal: new AbortController().signal } };
}

it("exports Paradox strings with released logical, atoi and go_strtod coercions", async () => {
  // Source-derived expectations: value.c coercions and GOFFICE go_strtod's hex rejection.
  // These strings deliberately bypass text-import type inference.
  const specifications = ["Truth,L", "NumericText,L", "PaddedTruth,L", "Count,I", "Short,S", "Date,D", "Amount,N", "Hex,N", "NBSP,I", "ASCII,I"];
  const values = ["tRuE", "1", " TRUE", "12tail", "-7.9tail", "59.9tail", "1.25tail", "0x1.8p+2tail", "\u00a07", "\v\t+7tail"];
  const book: Workbook = { sheets: [{ id: "t", name: "Coercions", cells: [
    ...specifications.map((value, column) => ({ row: 0, column, value: { kind: "string" as const, value } })),
    ...values.map((value, column) => ({ row: 1, column, value: { kind: "string" as const, value } }))
  ] }] };
  const f = databaseFixture(book);
  try {
    const owned = await f.engine.readWorkbook({ kind: "stream", source: [] }, { importType: "fixture" }, f.operation);
    await f.engine.writeWorkbook(owned, { kind: "resource", uri: "/coercions.db" }, { exportType: "Gnumeric_paradox:paradox" }, f.operation);
    const bytes = new Uint8Array(f.volume.readFileSync("/coercions.db") as Uint8Array);
    const view = new DataView(bytes.buffer), record = view.getUint16(2, true) + 6;
    // Independent raw byte controls distinguish false from native null (all zero).
    expect([...bytes.subarray(record, record + 3)]).toEqual([0x81, 0x80, 0x80]);
    expect(view.getInt32(record + 3)).toBe(-2147483636);
    expect(view.getUint16(record + 7)).toBe(0x7ff9);
    expect(view.getUint32(record + 9)).toBe(0x800a9596);
    expect([...bytes.subarray(record + 13, record + 21)]).toEqual([0xbf, 0xf4, 0, 0, 0, 0, 0, 0]);
    expect.soft([...bytes.subarray(record + 21, record + 29)]).toEqual([0x80, 0, 0, 0, 0, 0, 0, 0]);
    expect.soft(view.getUint32(record + 29)).toBe(0x80000000);
    expect(view.getUint32(record + 33)).toBe(0x80000007);
    expect(Object.keys(f.volume.toJSON()).sort()).toEqual(["/coercions.db", "/keep"]);
  } finally { await f.engine.dispose(); }
});

it("cancels from an exporter warning without replacing the injected destination", async () => {
  const book: Workbook = { sheets: [{ id: "t", name: "t", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "Text,A,1" } },
    { row: 0, column: 1, value: { kind: "string", value: "Count,I" } },
    { row: 1, column: 0, value: { kind: "string", value: "long" } },
    { row: 1, column: 1, value: { kind: "number", value: 7 } }
  ] }] };
  const f = databaseFixture(book), controller = new AbortController(), reason = new Error("cancel warning");
  const warnings: string[] = [];
  f.volume.writeFileSync("/destination.db", "sentinel");
  try {
    const owned = await f.engine.readWorkbook({ kind: "stream", source: [] }, { importType: "fixture" }, f.operation);
    await expect(f.engine.writeWorkbook(owned, { kind: "resource", uri: "/destination.db" }, { exportType: "Gnumeric_paradox:paradox" }, {
      signal: controller.signal, async diagnostic(d) { warnings.push(d.message); controller.abort(reason); }
    })).rejects.toBe(reason);
    expect(warnings).toEqual(["Field 1 in line 2 has possibly been cut off. Data has 4 characters."]);
    expect(f.volume.toJSON()).toEqual({ "/keep": "original", "/destination.db": "sentinel" });
  } finally { await f.engine.dispose(); }
});

it("rejects original encrypted Paradox bytes without consulting companion resources", async () => {
  const f = databaseFixture({ sheets: [{ id: "t", name: "t", cells: [] }] });
  const bytes = new Uint8Array(512), view = new DataView(bytes.buffer), messages: string[] = [];
  view.setUint16(0, 2, true); view.setUint16(2, 512, true); bytes[4] = 2; bytes[5] = 1; bytes[57] = 11;
  view.setUint32(37, 1, true);
  try {
    await expect(f.engine.readWorkbook({ kind: "stream", filename: "private.db", source: [bytes] }, {}, {
      ...f.operation, async diagnostic(d) { messages.push(d.message); }
    })).rejects.toMatchObject({ code: "unsupported-feature", message: "Unsupported ssconvert feature: encrypted Paradox table" });
    expect(messages).toEqual([]);
    expect(f.volume.toJSON()).toEqual({ "/keep": "original" });
  } finally { await f.engine.dispose(); }
});
