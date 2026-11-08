import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import type { Workbook } from "../workbook.js";

function databaseFixture(book: Workbook, changes: Partial<{ cells: number; outputBytes: number }> = {}) {
  const volume = Volume.fromJSON({ "/keep": "original" });
  const reads: string[] = [];
  const engine = createEngine({ codecs: [{ id: "fixture", description: "fixture", extensions: [], async read() { return book; } }],
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 10000, ...changes },
    environment: { env: {}, locale: "C", timezone: "UTC" },
    filesystem: { async read(uri, signal) { signal.throwIfAborted(); reads.push(uri); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); } } });
  return { volume, reads, engine, operation: { signal: new AbortController().signal } };
}

it("preserves UTF-8 Paradox table and specification names across shared SDK byte I/O", async () => {
  const book: Workbook = { activeSheet: "t", sheets: [{ id: "t", name: "Café", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "Crème,A,8" } },
    { row: 1, column: 0, value: { kind: "string", value: "été" } }
  ] }] };
  const f = databaseFixture(book);
  try {
    const owned = await f.engine.readWorkbook({ kind: "stream", source: [] }, { importType: "fixture" }, f.operation);
    await f.engine.writeWorkbook(owned, { kind: "resource", uri: "/names.db" }, { exportType: "Gnumeric_paradox:paradox" }, f.operation);
    const restored = await f.engine.readWorkbook({ kind: "resource", uri: "/names.db" }, {}, f.operation);
    expect(restored.sheets[0]!.name).toBe("Café");
    expect(restored.sheets[0]!.cells.map(c => c.value)).toEqual([
      { kind: "string", value: "Crème,A,8" }, { kind: "string", value: "été" }
    ]);
    expect(Object.keys(f.volume.toJSON()).sort()).toEqual(["/keep", "/names.db"]);
  } finally { await f.engine.dispose(); }
});

it("retains native invalid BCD nibble character conversion instead of expanding digit count", async () => {
  const book: Workbook = { sheets: [{ id: "t", name: "t", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "Amount,#,2" } },
    { row: 1, column: 0, value: { kind: "string", value: "1.25" } }
  ] }] };
  const f = databaseFixture(book);
  try {
    const owned = await f.engine.readWorkbook({ kind: "stream", source: [] }, { importType: "fixture" }, f.operation);
    await f.engine.writeWorkbook(owned, { kind: "resource", uri: "/bcd.db" }, { exportType: "Gnumeric_paradox:paradox" }, f.operation);
    const bytes = new Uint8Array(f.volume.readFileSync("/bcd.db") as Uint8Array);
    const header = new DataView(bytes.buffer).getUint16(2, true);
    bytes[header + 6 + 16] = 0xa5;
    const imported = await f.engine.readWorkbook({ kind: "stream", source: [bytes] }, { importType: "Gnumeric_paradox:paradox" }, f.operation);
    expect(imported.sheets[0]!.cells[1]!.value).toEqual({ kind: "string", value: "1.:5" });
  } finally { await f.engine.dispose(); }
});

it("does not publish Paradox bytes after an output budget failure", async () => {
  const book: Workbook = { sheets: [{ id: "t", name: "t", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "Name,A,8" } },
    { row: 1, column: 0, value: { kind: "string", value: "value" } }
  ] }] };
  const f = databaseFixture(book, { outputBytes: 2048 });
  f.volume.writeFileSync("/table.db", "keep destination");
  try {
    const owned = await f.engine.readWorkbook({ kind: "stream", source: [] }, { importType: "fixture" }, f.operation);
    await expect(f.engine.writeWorkbook(owned, { kind: "resource", uri: "/table.db" }, { exportType: "Gnumeric_paradox:paradox" }, f.operation)).rejects.toMatchObject({ code: "resource-limit" });
    expect(f.volume.readFileSync("/table.db", "utf8")).toBe("keep destination");
    expect(Object.keys(f.volume.toJSON()).sort()).toEqual(["/keep", "/table.db"]);
  } finally { await f.engine.dispose(); }
});

it("imports an original Paradox primary index with signed trailer fields", async () => {
  const bytes = new Uint8Array(512 + 1024), view = new DataView(bytes.buffer);
  view.setUint16(0, 8, true); view.setUint16(2, 512, true); bytes[4] = 1; bytes[5] = 1; bytes[57] = 4;
  view.setUint32(6, 1, true); view.setUint16(12, 1, true); view.setUint16(14, 1, true); view.setUint16(33, 1, true);
  bytes[88] = 3; bytes[89] = 2; bytes.set(new TextEncoder().encode("Index"), 94); bytes.set(new TextEncoder().encode("Key"), 173);
  for (const [i, value] of [7, -1, 2, 3].entries()) { view.setInt16(518 + i * 2, value); bytes[518 + i * 2] = bytes[518 + i * 2]! ^ 128; }
  const f = databaseFixture({ sheets: [{ id: "t", name: "t", cells: [] }] });
  try {
    const messages: string[] = [];
    const imported = await f.engine.readWorkbook({ kind: "stream", filename: "index.px", source: [bytes] }, {},
      { ...f.operation, async diagnostic(d) { messages.push(d.message); } });
    expect(messages).toEqual(["Target encoding could not be set."]);
    expect(imported.sheets[0]!.cells.map(c => c.value)).toEqual([
      { kind: "string", value: "Key,S,2" }, ...[7, -1, 2, 3, 1].map(value => ({ kind: "number", value }))
    ]);
    expect(Object.keys(f.volume.toJSON())).toEqual(["/keep"]);
  } finally { await f.engine.dispose(); }
});

it("round trips inline memo and precision-32 BCD without companion reads", async () => {
  const decimal = "-0.12345678901234567890123456789012";
  const book: Workbook = { sheets: [{ id: "t", name: "t", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "Memo,M,14" } },
    { row: 0, column: 1, value: { kind: "string", value: "Amount,#,32" } },
    { row: 1, column: 0, value: { kind: "string", value: "note" } },
    { row: 1, column: 1, value: { kind: "string", value: decimal } }
  ] }] };
  const f = databaseFixture(book);
  try {
    const owned = await f.engine.readWorkbook({ kind: "stream", source: [] }, { importType: "fixture" }, f.operation);
    await f.engine.writeWorkbook(owned, { kind: "resource", uri: "/memo.db" }, { exportType: "Gnumeric_paradox:paradox" }, f.operation);
    const imported = await f.engine.readWorkbook({ kind: "resource", uri: "/memo.db" }, {}, f.operation);
    expect(imported.sheets[0]!.cells.filter(c => c.row === 1).map(c => c.value)).toEqual([
      { kind: "string", value: "note" }, { kind: "string", value: decimal }
    ]);
    expect(Object.keys(f.volume.toJSON()).sort()).toEqual(["/keep", "/memo.db"]);
    expect(f.reads).toEqual(["/memo.db"]);
  } finally { await f.engine.dispose(); }
});

it("rejects a cancelled database operation before reading injected resources", async () => {
  const f = databaseFixture({ sheets: [{ id: "t", name: "t", cells: [] }] });
  const controller = new AbortController(), reason = new Error("cancel database"); controller.abort(reason);
  try {
    await expect(f.engine.readWorkbook({ kind: "resource", uri: "/missing.db" }, {}, { signal: controller.signal })).rejects.toBe(reason);
    expect(Object.keys(f.volume.toJSON())).toEqual(["/keep"]);
    expect(f.reads).toEqual([]);
  } finally { await f.engine.dispose(); }
});

function cyclicDatabase(blocks: number, records: number) {
  const bytes = new Uint8Array(1536), view = new DataView(bytes.buffer);
  view.setUint16(0, 2, true); view.setUint16(2, 512, true); bytes[4] = 2; bytes[5] = 1; bytes[57] = 11;
  view.setUint32(6, records, true); view.setUint16(12, blocks, true); view.setUint16(14, 1, true); view.setUint16(33, 1, true);
  view.setUint16(106, 1252, true); bytes[120] = 3; bytes[121] = 2;
  bytes.set(new TextEncoder().encode("Cycle"), 130); bytes.set(new TextEncoder().encode("Key"), 209);
  view.setUint16(512, 1, true); bytes[518] = 128; bytes[519] = 7;
  return bytes;
}

it("bounds cyclic Paradox links and retains the first readable record with a warning", async () => {
  const f = databaseFixture({ sheets: [{ id: "t", name: "t", cells: [] }] }), messages: string[] = [];
  try {
    const book = await f.engine.readWorkbook({ kind: "stream", filename: "cycle.db", source: [cyclicDatabase(3, 3)] }, {},
      { ...f.operation, async diagnostic(d) { messages.push(d.message); } });
    expect(book.sheets[0]!.cells.map(c => c.value)).toEqual([{ kind: "string", value: "Key,S,2" }, { kind: "number", value: 7 }]);
    expect(messages).toEqual(["Could not get head of data block nr. 1."]);
  } finally { await f.engine.dispose(); }
});

it("yields for cancellation during the bounded Paradox block-count scan", async () => {
  const f = databaseFixture({ sheets: [{ id: "t", name: "t", cells: [] }] });
  const controller = new AbortController(), reason = new Error("cancel block scan");
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await expect(f.engine.readWorkbook({ kind: "stream", filename: "cycle.db", source: [cyclicDatabase(65535, 1)] }, {},
      { signal: controller.signal })).rejects.toBe(reason);
    expect(Object.keys(f.volume.toJSON())).toEqual(["/keep"]);
  } finally { clearTimeout(timer); await f.engine.dispose(); }
});
