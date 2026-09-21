import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { readBiff } from "./biff.js";
import { Binary, readBiffRecords, readCfb } from "./biff-binary.js";
import { BiffStrings, biffOverrideCodepage } from "./biff-strings.js";
import { translateBiffFormula } from "./biff-formulas.js";
import { originalMiniCfb } from "./biff-fixtures.test-support.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 100 } };
function record(opcode: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const bytes = new Uint8Array(payload.length + 4), view = new DataView(bytes.buffer);
  view.setUint16(0, opcode, true); view.setUint16(2, payload.length, true); bytes.set(payload, 4); return bytes;
}
function join(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
}
function stringFormula(): Uint8Array {
  const bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
  view.setUint16(12, 0xffff, true); view.setUint16(20, 2, true); bytes.set([0x17, 0], 22);
  // An empty compressed token still contains its width flag.
  const result = new Uint8Array(25); result.set(bytes); new DataView(result.buffer).setUint16(20, 3, true);
  return record(6, result);
}

it.each([new Uint8Array(), new Uint8Array([0, 0])])("accepts native's historical empty STRING cache payload %j", async payload => {
  const book = await readBiff(join(record(0x809, new Uint8Array([0, 6, 16, 0])), stringFormula(), record(0x207, payload), record(10)), context);
  expect(book.sheets[0]!.cells[0]).toMatchObject({ formula: '=""', cachedResult: { kind: "string", value: "" } });
});
it("preserves native's MISSING STRING error rather than silently replacing it with a blank", async () => {
  const diagnostics: string[] = [];
  const book = await readBiff(join(record(0x809, new Uint8Array([0, 6, 16, 0])), stringFormula(), record(10)),
    { ...context, async diagnostic(diagnostic) { diagnostics.push(diagnostic.message); } });
  expect(book.sheets[0]!.cells[0]).toMatchObject({ formula: '=""', cachedResult: { kind: "error", value: "MISSING STRING" } });
  expect(diagnostics).toEqual(["EXCEL: missing STRING record for A1"]);
});
it("uses only positive exact -E mappings in native gnm_xl_get_codepage", () => {
  for (const name of ["windows-1253", "windows-874", "Shift_JIS", "GB2312", "Big5", "EUC-KR", "Johab", "CP932", "WINDOWS-1252"])
    expect(biffOverrideCodepage(name)).toBeUndefined();
  expect(biffOverrideCodepage("windows-936")).toBe(936);
  for (const codepage of [1250, 1251, 1252, 1254, 1255, 1256, 1257, 1258])
    expect(biffOverrideCodepage(`windows-${codepage}`)).toBe(codepage);
});

it("bounds every binary primitive before DataView access", () => {
  const bytes = new Binary(new Uint8Array(8));
  for (const operation of [() => bytes.u8(-1), () => bytes.u16(7), () => bytes.u32(5),
    () => bytes.f64(1), () => bytes.slice(0, Number.MAX_SAFE_INTEGER), () => bytes.slice(Number.NaN, 1)])
    expect(operation).toThrow("Invalid Excel BIFF");
});
it("rejects truncated record headers/payloads and applies the record budget", () => {
  expect(() => readBiffRecords(new Uint8Array([9, 8, 4]), context)).toThrow("truncated");
  expect(() => readBiffRecords(new Uint8Array([9, 8, 4, 0, 0]), context)).toThrow("truncated");
  expect(() => readBiffRecords(join(record(9), record(10)), { ...context,
    limits: { ...context.limits, workbookNodes: 1 } })).toThrow("record limit");
});
it("switches Unicode CONTINUE width without consuming rich-run bytes as flags", () => {
  const cursor = new BiffStrings([new Binary(new Uint8Array([8, 1, 0, 65])),
    new Binary(new Uint8Array([1, 0xa9, 3, 0, 0, 2, 0]))], context, 1252);
  expect(cursor.unicode(2)).toEqual({ text: "AΩ", richText: [{ start: 0, end: 2, attributes: { "biff-font-index": 2 } }] });
});
it("rejects a wide character split mid-code-unit and oversized extension before reading it", () => {
  expect(() => new BiffStrings([new Binary(new Uint8Array([1, 65])), new Binary(new Uint8Array([1, 0]))], context, 1252).unicode(1)).toThrow("truncated");
  expect(() => new BiffStrings([new Binary(new Uint8Array([4, 255, 255, 255, 255]))], context, 1252).unicode(0)).toThrow("string limit");
});
it("checks formula stacks, payloads, names, and work budget", () => {
  const formulaContext = { revision: 8, codepage: 1252, row: 0, column: 0, names: [], externalSheets: [], limit: 100 };
  for (const bytes of [new Uint8Array([3]), new Uint8Array([0x1f, 0]), new Uint8Array([0x24, 0, 0]),
    new Uint8Array([0x23, 1, 0, 0, 0])])
    expect(() => translateBiffFormula(bytes, formulaContext)).toThrow("Invalid Excel BIFF");
  expect(() => translateBiffFormula(new Uint8Array([0x1e, 123, 0]), { ...formulaContext, limit: 1 })).toThrow("work limit");
});
it.each([2, 3, 4])("reads the source-defined ten-byte Name token payload in BIFF revision %i", revision => {
  const bytes = new Uint8Array(11); bytes[0] = 0x23; bytes[1] = 1;
  expect(translateBiffFormula(bytes, { revision, codepage: 1252, row: 0, column: 0,
    names: ["NamedValue"], externalSheets: [], limit: 100 })).toBe("=NamedValue");
});
it.each([2, 3, 4, 7, 8])("preserves formula boolean/error caches in BIFF revision %i", async revision => {
  const opcode = revision === 2 ? 9 : revision === 3 ? 0x209 : revision === 4 ? 0x409 : 0x809;
  const tokenStart = revision >= 7 ? 22 : revision >= 3 ? 18 : 17, cacheStart = revision === 2 ? 7 : 6;
  for (const [tag, cache, value] of [[1, 1, { kind: "boolean", value: true }], [2, 7, { kind: "error", value: "#DIV/0!" }]] as const) {
    const payload = new Uint8Array(tokenStart + 3), view = new DataView(payload.buffer);
    payload[cacheStart] = tag; payload[cacheStart + 2] = cache; view.setUint16(cacheStart + 6, 0xffff, true);
    if (revision === 2) payload[16] = 3; else view.setUint16(tokenStart - 2, 3, true);
    payload.set([0x1e, 1, 0], tokenStart);
    const book = await readBiff(join(record(opcode, new Uint8Array([0, revision >= 7 ? revision === 8 ? 6 : 5 : 0, 16, 0])),
      record(6, payload), record(10)), context);
    expect(book.sheets[0]!.cells[0]).toMatchObject({ formula: "=1", cachedResult: value });
  }
});
it("rejects corrupt input through injected memfs I/O without writing an output", async () => {
  const volume = new Volume(); volume.writeFileSync("/bad.xls", join(record(0x209, new Uint8Array([0, 3, 16, 0])),
    new Uint8Array([3, 2, 14, 0, 0])));
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); } } });
  try {
    await expect(engine.convert({ input: { kind: "resource", uri: "/bad.xls" },
      destination: { kind: "resource", uri: "/result.csv" }, exportType: "Gnumeric_stf:stf_csv" }, context))
      .rejects.toMatchObject({ code: "io", exitCode: 1, message: "E Invalid Excel BIFF: truncated binary data" });
    expect(volume.existsSync("/result.csv")).toBe(false);
  } finally { await engine.dispose(); }
});

function cfb(): Uint8Array {
  const bytes = new Uint8Array(1536), view = new DataView(bytes.buffer);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  view.setUint16(26, 3, true); view.setUint16(28, 0xfffe, true); view.setUint16(30, 9, true); view.setUint16(32, 6, true);
  view.setUint32(44, 1, true); view.setUint32(48, 0, true); view.setUint32(56, 4096, true);
  view.setUint32(60, 0xfffffffe, true); view.setUint32(68, 0xfffffffe, true);
  for (let offset = 76; offset < 512; offset += 4) view.setUint32(offset, 0xffffffff, true);
  view.setUint32(76, 1, true);
  for (let offset = 1024; offset < 1536; offset += 4) view.setUint32(offset, 0xffffffff, true);
  view.setUint32(1024, 0xfffffffe, true); view.setUint32(1028, 0xfffffffd, true);
  const name = "Root Entry"; for (let i = 0; i < name.length; i++) view.setUint16(512 + i * 2, name.charCodeAt(i), true);
  view.setUint16(576, (name.length + 1) * 2, true); bytes[578] = 5;
  for (const offset of [580, 584, 588]) view.setUint32(offset, 0xffffffff, true);
  view.setUint32(628, 0xfffffffe, true);
  return bytes;
}
function directoryEntry(bytes: Uint8Array, id: number, name: string, start: number, size: number, right = 0xffffffff): void {
  const offset = 512 + id * 128, view = new DataView(bytes.buffer);
  for (let i = 0; i < name.length; i++) view.setUint16(offset + i * 2, name.charCodeAt(i), true);
  view.setUint16(offset + 64, (name.length + 1) * 2, true); bytes[offset + 66] = 2;
  view.setUint32(offset + 68, 0xffffffff, true); view.setUint32(offset + 72, right, true);
  view.setUint32(offset + 76, 0xffffffff, true); view.setUint32(offset + 116, start, true); view.setUint32(offset + 120, size, true);
}
function miniCfb(): Uint8Array {
  const workbook = join(record(0x209, new Uint8Array([0, 3, 16, 0])), record(10));
  return originalMiniCfb(workbook);
}
it("admits a tiny empty CFB and rejects FAT/directory cycles and out-of-file sectors", () => {
  expect(readCfb(cfb(), context).size).toBe(0);
  const fatCycle = cfb(); new DataView(fatCycle.buffer).setUint32(1024, 0, true);
  expect(() => readCfb(fatCycle, context)).toThrow("cycle");
  const badDirectory = cfb(); new DataView(badDirectory.buffer).setUint32(588, 100, true);
  expect(() => readCfb(badDirectory, context)).toThrow("directory reference");
  const badSector = cfb(); new DataView(badSector.buffer).setUint32(48, 1234, true);
  expect(() => readCfb(badSector, context)).toThrow("outside");
});
it("imports an original mini-stream workbook and bounds miniFAT/root chain references", async () => {
  expect(readCfb(miniCfb(), context).get("Workbook")).toEqual(join(record(0x209, new Uint8Array([0, 3, 16, 0])), record(10)));
  expect((await readBiff(miniCfb(), context)).sheets).toHaveLength(1);
  const miniCycle = miniCfb(); new DataView(miniCycle.buffer).setUint32(1536, 0, true);
  expect(() => readCfb(miniCycle, context)).toThrow("cycle");
  const rootCycle = miniCfb(); new DataView(rootCycle.buffer).setUint32(1036, 3, true);
  expect(() => readCfb(rootCycle, context)).toThrow("cycle");
  const outsideMini = miniCfb(); new DataView(outsideMini.buffer).setUint32(756, 12, true);
  expect(() => readCfb(outsideMini, context)).toThrow("outside");
  const oversizedMini = miniCfb(); new DataView(oversizedMini.buffer).setUint32(760, 128, true);
  expect(() => readCfb(oversizedMini, context)).toThrow("size mismatch");
});
it("bounds decoded bytes when multiple directory entries alias a large stream", () => {
  const bytes = new Uint8Array(5632); bytes.set(cfb()); const view = new DataView(bytes.buffer);
  view.setUint32(588, 1, true);
  directoryEntry(bytes, 1, "Workbook", 2, 4096, 2); directoryEntry(bytes, 2, "Book", 2, 4096);
  for (let id = 2; id <= 9; id++) view.setUint32(1024 + id * 4, id === 9 ? 0xfffffffe : id + 1, true);
  expect(() => readCfb(bytes, { ...context, limits: { ...context.limits, inputBytes: bytes.length } }))
    .toThrow("decoded bytes limit");
});
it("rejects invalid CFB header layouts, counts, names, tree cycles, and short sectors", () => {
  for (const [offset, value] of [[44, 9999], [64, 9999], [72, 9999], [56, 1024]]) {
    const bytes = cfb(); new DataView(bytes.buffer).setUint32(offset!, value!, true);
    expect(() => readCfb(bytes, context)).toThrow("Invalid Excel BIFF");
  }
  const oddName = cfb(); new DataView(oddName.buffer).setUint16(576, 3, true);
  expect(() => readCfb(oddName, context)).toThrow("directory name");
  const treeCycle = miniCfb(); new DataView(treeCycle.buffer).setUint32(712, 1, true);
  expect(() => readCfb(treeCycle, context)).toThrow("directory cycle");
  expect(() => readCfb(cfb().subarray(0, 1535), context)).toThrow("CFB size");
  const layout = cfb(); new DataView(layout.buffer).setUint16(30, 12, true);
  expect(() => readCfb(layout, context)).toThrow("sector layout");
});
it("bounds DIFAT cycles independently from FAT cycles", () => {
  const bytes = new Uint8Array(2048); bytes.set(cfb()); const view = new DataView(bytes.buffer);
  view.setUint32(68, 2, true); view.setUint32(72, 2, true);
  for (let offset = 1536; offset < 2048; offset += 4) view.setUint32(offset, 0xffffffff, true);
  view.setUint32(2044, 2, true);
  expect(() => readCfb(bytes, context)).toThrow("DIFAT cycle");
});
it("admits an original CFB v4 empty root and validates its directory count", () => {
  const seed = cfb(), bytes = new Uint8Array(12288), view = new DataView(bytes.buffer);
  bytes.set(seed.subarray(0, 512)); bytes.set(seed.subarray(512, 1024), 4096);
  view.setUint16(26, 4, true); view.setUint16(30, 12, true); view.setUint32(40, 1, true);
  for (let offset = 8192; offset < 12288; offset += 4) view.setUint32(offset, 0xffffffff, true);
  view.setUint32(8192, 0xfffffffe, true); view.setUint32(8196, 0xfffffffd, true);
  expect(readCfb(bytes, context).size).toBe(0);
  view.setUint32(40, 2, true);
  expect(() => readCfb(bytes, context)).toThrow("directory count mismatch");
});
