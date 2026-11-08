import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import type { Workbook } from "../workbook.js";
import { databaseText } from "./database-support.js";

const limits = { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 10000 };
it("preserves ordered native Paradox header failure diagnostics before refusing publication", async () => {
  const f = databaseFixture(), messages: string[] = [];
  try {
    await expect(f.engine.readWorkbook({ kind: "stream", filename: "bad.db", source: [new Uint8Array(2)] }, {},
      { ...f.operation, async diagnostic(d) { messages.push(d.message); } })).rejects.toThrow("E Error while opening Paradox file.");
    expect(messages).toEqual(["Could not read header from paradox file.", "Unable to get header."]);
    expect(f.volume.toJSON()).toEqual({ "/keep": "original" });
  } finally { await f.engine.dispose(); }
});
it("matches native xBase binary F conversion after its NUL-terminated field copy", async () => {
  const f = databaseFixture(), bytes = new Uint8Array(75), view = new DataView(bytes.buffer);
  bytes[0] = 3; bytes[29] = 3; view.setUint32(4, 1, true); view.setUint16(8, 66, true); view.setUint16(10, 9, true);
  bytes.set(new TextEncoder().encode("Float"),32); bytes[43] = 70; bytes[48] = 8; bytes[64] = 13; bytes[66] = 32; view.setFloat64(67,1.5,true);
  try {
    const book = await f.engine.readWorkbook({ kind: "stream", filename: "float.dbf", source: [bytes] }, {}, f.operation);
    expect(book.sheets[0]!.cells[1]!.value).toEqual({ kind: "number", value: 0 });
  } finally { await f.engine.dispose(); }
});
it("uses the reference database DBCS and Macintosh converters without text charset guessing", () => {
  expect(databaseText(new Uint8Array([0x82, 0xa0]), 932)).toBe("あ");
  expect(databaseText(new Uint8Array([0x8e]), 10000)).toBe("é");
  expect(databaseText(new Uint8Array([0x82]), 737)).toBe("Γ");
  expect(databaseText(new Uint8Array([0xa1]), 874)).toBe("ก");
  expect(() => databaseText(new Uint8Array([0x82]), 932)).toThrow("Invalid encoded byte");
});
it.each([0x68,0x69,0x97,0x98])("matches unavailable native DBF converter fallback and ordered diagnostics for language %i", async language => {
  const f = databaseFixture(), bytes = new Uint8Array(68), view = new DataView(bytes.buffer), messages: string[] = [];
  bytes[0]=3; bytes[29]=language; view.setUint32(4,1,true); view.setUint16(8,66,true); view.setUint16(10,2,true);
  bytes.set(new TextEncoder().encode("Text"),32); bytes[43]=67; bytes[48]=1; bytes[64]=13; bytes[66]=32; bytes[67]=0x82;
  try {
    const book=await f.engine.readWorkbook({ kind: "stream", filename: "text.dbf", source: [bytes] }, {}, { ...f.operation, async diagnostic(d) { messages.push(d.message); } });
    expect(book.sheets[0]!.cells[1]!.value).toEqual({ kind: "string", value: "\u0082" });
    expect(messages).toEqual([`Unable to open an iconv handle from codepage ${{104:895,105:620,151:10029,152:10006}[language]} -> UTF-8`, `File has unknown or missing code page information (${language.toString(16)})`]);
  } finally { await f.engine.dispose(); }
});
it.each([3,4,5,6,7,8,9,10,11,12,13,14,15])("parses original Paradox database version ID %i using the released header layout", async version => {
  const f = databaseFixture(), bytes = new Uint8Array(512 + 1024), view = new DataView(bytes.buffer);
  view.setUint16(0,2,true); view.setUint16(2,512,true); bytes[4]=2; bytes[5]=1; bytes[57]=version;
  view.setUint32(6,1,true); view.setUint16(12,1,true); view.setUint16(14,1,true); view.setUint16(33,1,true);
  const hasData = version >= 5 && version <= 12, fields = hasData ? 120 : 88;
  if (hasData) view.setUint16(106,1252,true);
  bytes[fields]=3; bytes[fields+1]=2; const name=fields+10;
  bytes.set(new TextEncoder().encode("Original"),name); bytes.set(new TextEncoder().encode("Value"),name+(version===12?261:79));
  bytes[518]=128; bytes[519]=7;
  try {
    const book = await f.engine.readWorkbook({ kind: "stream", filename: "original.db", source: [bytes] }, {}, f.operation);
    expect(book.sheets[0]!.name).toBe("Original");
    expect(book.sheets[0]!.cells.map(c=>c.value)).toEqual([{kind:"string",value:"Value,S,2"},{kind:"number",value:7}]);
  } finally { await f.engine.dispose(); }
});
it("retains readable Paradox records and warns when an oversized block count disagrees with the database header", async () => {
  const f = databaseFixture(), bytes = new Uint8Array(1536), view = new DataView(bytes.buffer), messages: string[] = [];
  view.setUint16(0,2,true); view.setUint16(2,512,true); bytes[4]=2; bytes[5]=1; bytes[57]=11;
  view.setUint32(6,1,true); view.setUint16(12,1,true); view.setUint16(14,1,true); view.setUint16(33,1,true); view.setUint16(106,1252,true);
  bytes[120]=3; bytes[121]=2; bytes.set(new TextEncoder().encode("Original"),130); bytes.set(new TextEncoder().encode("Value"),209);
  view.setUint16(516,32767,true); bytes[518]=128; bytes[519]=7;
  try {
    const book = await f.engine.readWorkbook({kind:"stream",filename:"original.db",source:[bytes]}, {}, { ...f.operation, async diagnostic(d){messages.push(d.message);} });
    expect(book.sheets[0]!.cells[1]!.value).toEqual({kind:"number",value:7});
    expect(messages).toEqual(["Number of records counted in blocks does not match number of records in header (16384 != 1)"]);
  } finally { await f.engine.dispose(); }
});
export function databaseFixture(book?: Workbook) {
  const volume = Volume.fromJSON({ "/keep": "original" });
  const engine = createEngine({ codecs: book ? [{ id: "fixture", description: "fixture", extensions: [], async read() { return book; } }] : [], limits, environment: { env: {}, locale: "C", timezone: "UTC" },
    filesystem: { async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); } } });
  return { volume, engine, operation: { signal: new AbortController().signal } };
}
it("imports original DBF character/numeric/logical records, skips deletions and keeps memo placeholders", async () => {
  const f = databaseFixture();
  const data = new Uint8Array(162 + 3 * 16), view = new DataView(data.buffer);
  data[0] = 0x83; data[29] = 3; view.setUint32(4, 3, true); view.setUint16(8, 162, true); view.setUint16(10, 16, true);
  for (const [i, name, type, size] of [[0, "Name", "C", 5], [1, "Amount", "N", 5], [2, "Active", "L", 1], [3, "Memo", "M", 4]] as const) {
    const at = 32 + i * 32; data.set(new TextEncoder().encode(name), at); data[at + 11] = type.charCodeAt(0); data[at + 16] = size;
  }
  data[160] = 13;
  data.set(new TextEncoder().encode(" Alice 12.5T   1*Gone     9F   2 Bob      ?    "), 162);
  f.volume.writeFileSync("/input.dbf", data);
  try {
    const book = await f.engine.readWorkbook({ kind: "resource", uri: "/input.dbf" }, {}, f.operation);
    expect(book.sheets[0]!.cells[0]!.style).toMatchObject({ bold: true });
    expect(book.sheets[0]!.cells.filter(c => c.row === 1).map(c => c.value)).toEqual([
      { kind: "string", value: "Alice" }, { kind: "number", value: 12.5 }, { kind: "boolean", value: true },
      { kind: "string", value: "Field type '0x4d' unsupported" }
    ]);
    expect(book.sheets[0]!.cells.some(c => c.value.kind === "string" && c.value.value === "Gone")).toBe(false);
    expect(f.engine.listServices("write").some(s => s.id === "Gnumeric_xbase:xbase")).toBe(false);
  } finally { await f.engine.dispose(); }
});
it("writes genuine Paradox blocks through SDK byte I/O and reimports typed database specifications", async () => {
  const book: Workbook = { activeSheet: "table", sheets: [{ id: "table", name: "Accounts", cells: [
    ...["Name,A,8", "Balance,N", "Open,L", "Count,I"].map((value, column) => ({ row: 0, column, value: { kind: "string" as const, value } })),
    { row: 1, column: 0, value: { kind: "string", value: "Café" } },
    { row: 1, column: 1, value: { kind: "number", value: -12.5 } },
    { row: 1, column: 2, value: { kind: "boolean", value: false } },
    { row: 1, column: 3, value: { kind: "number", value: -3 } }
  ] }] };
  const f = databaseFixture(book);
  try {
    const owned = await f.engine.readWorkbook({ kind: "stream", source: [] }, { importType: "fixture" }, f.operation);
    const result = await f.engine.writeWorkbook(owned, { kind: "resource", uri: "/table.db" }, { exportType: "Gnumeric_paradox:paradox" }, f.operation);
    expect(result.exitCode).toBe(0);
    const data = new Uint8Array(f.volume.readFileSync("/table.db") as Uint8Array), view = new DataView(data.buffer);
    expect(data[4]).toBe(2); expect(view.getUint32(6, true)).toBe(1); expect(view.getUint16(0, true)).toBe(21);
    const imported = await f.engine.readWorkbook({ kind: "resource", uri: "/table.db" }, {}, f.operation);
    expect(imported.sheets[0]!.name).toBe("Accounts");
    expect(imported.sheets[0]!.cells[0]!.style).toMatchObject({ bold: true });
    expect(imported.sheets[0]!.cells.map(c => c.value)).toEqual([
      ...["Name,A,8", "Balance,N,8", "Open,L,1", "Count,I,4"].map(value => ({ kind: "string", value })),
      { kind: "string", value: "Café" }, { kind: "number", value: -12.5 }, { kind: "boolean", value: false }, { kind: "number", value: -3 }
    ]);
    expect(f.volume.readFileSync("/keep", "utf8")).toBe("original");
  } finally { await f.engine.dispose(); }
});
