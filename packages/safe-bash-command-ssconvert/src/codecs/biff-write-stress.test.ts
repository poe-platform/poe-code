import { expect, it } from "vitest";
import assert from "node:assert/strict";
import type { CapabilityContext } from "../contracts.js";
import { snapshotWorkbook, type Workbook } from "../workbook.js";
import { BiffFormulaWriter } from "./biff-write-formulas.js";
import { BiffOutput, writeCfb } from "./biff-write-binary.js";
import { Binary, readCfb, readBiffRecords } from "./biff-binary.js";
import { BiffStyles } from "./biff-write-styles.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { biffNode, readBiffMetadata } from "./biff-metadata.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 12_000_000, outputBytes: 12_000_000, cells: 1000, sheets: 8, operations: 1000 } };

it.each([7, 8] as const)("BIFF%i resolves local names before workbook names and honors qualified scope", revision => {
  const book: Workbook = { sheets: [{ id: "s1", name: "First", cells: [] }, { id: "s2", name: "Second", cells: [] }],
    names: [{ name: "Answer", expression: "=1" }, { name: "Answer", expression: "=2", sheet: "s1" },
      { name: "Answer", expression: "=3", sheet: "s2" }] };
  const writer = new BiffFormulaWriter(snapshotWorkbook(book, context.limits), revision, context);
  const index = (source: string, sheet: string) => {
    const tokens = writer.compile(source, sheet, 0, 0).tokens;
    const qualified = source.includes("!");
    expect(tokens[0]).toBe(qualified ? 0x59 : 0x43);
    expect(tokens.length).toBe(qualified ? revision === 8 ? 7 : 25 : revision === 8 ? 5 : 15);
    return new DataView(tokens.buffer, tokens.byteOffset).getUint16(qualified ? revision === 8 ? 3 : 11 : 1, true);
  };
  expect(index("=Answer", "s1")).toBe(2);
  expect(index("=Answer", "First")).toBe(2);
  expect(index("=Answer", "s2")).toBe(3);
  expect(index("=First!Answer", "s2")).toBe(2);
  expect(index("=Second!Answer", "s1")).toBe(3);
});

it("CFB FAT/DIFAT independently enumerates every sector for both large DSF streams", () => {
  const book = new Uint8Array(3_800_123), workbook = new Uint8Array(3_800_789);
  book.fill(0x35); workbook.fill(0x86);
  const bytes = writeCfb(new Map([["Workbook", workbook], ["Book", book]]), context);
  const view = new DataView(bytes.buffer), fatCount = view.getUint32(44, true);
  expect(fatCount).toBeGreaterThan(109);
  const fatIds: number[] = [];
  for (let i = 0; i < 109; i++) fatIds.push(view.getUint32(76 + i * 4, true));
  let difat = view.getUint32(68, true);
  const difatIds: number[] = [];
  while (difat !== 0xfffffffe) {
    expect(difatIds).not.toContain(difat); difatIds.push(difat);
    const at = (difat + 1) * 512;
    for (let i = 0; i < 127 && fatIds.length < fatCount; i++) fatIds.push(view.getUint32(at + i * 4, true));
    difat = view.getUint32(at + 508, true);
  }
  expect(difatIds).toHaveLength(view.getUint32(72, true));
  expect(new Set(fatIds).size).toBe(fatCount);
  const fat = (id: number) => view.getUint32((fatIds[Math.floor(id / 128)]! + 1) * 512 + id % 128 * 4, true);
  for (const id of fatIds) expect(fat(id)).toBe(0xfffffffd);
  for (const id of difatIds) expect(fat(id)).toBe(0xfffffffc);
  const sectors = bytes.length / 512 - 1, occupied = new Set([...fatIds, ...difatIds]);
  const claim = (start: number) => {
    for (let id = start; id !== 0xfffffffe; id = fat(id)) {
      assert.ok(id < sectors); assert.ok(!occupied.has(id)); occupied.add(id);
    }
  };
  const directory = view.getUint32(48, true); claim(directory);
  for (const entry of [1, 2]) claim(view.getUint32((directory + 1) * 512 + entry * 128 + 116, true));
  expect(occupied.size).toBe(sectors);
  const streams = readCfb(bytes, context);
  assert.deepEqual(streams.get("Book")!.subarray(0, book.length), book);
  assert.deepEqual(streams.get("Workbook")!.subarray(0, workbook.length), workbook);
  expect(streams.get("Book")!.subarray(book.length).every(byte => byte === 0)).toBe(true);
});

it("CFB allocation and records enforce budgets and preserve cancellation reason identity", () => {
  expect(() => writeCfb(new Map([["Book", new Uint8Array(1)]]),
    { ...context, limits: { ...context.limits, outputBytes: 2048 } })).toThrow("CFB output bytes limit");
  const output = new BiffOutput({ ...context, limits: { ...context.limits, outputBytes: 7 } }, 2080);
  output.record(10); expect(() => output.record(10)).toThrow("output bytes limit");
  const controller = new AbortController(), reason = new Error("owned cancellation"); controller.abort(reason);
  const canceled = { ...context, signal: controller.signal };
  for (const run of [() => writeCfb(new Map(), canceled), () => new BiffOutput(canceled, 2080).record(10),
    () => new BiffFormulaWriter({ sheets: [] }, 8, canceled).compile("=1", "s", 0, 0)]) {
    try { run(); expect.fail("Cancellation was ignored"); } catch (error) { expect(error).toBe(reason); }
  }
});

it.each([7, 8] as const)("BIFF%i translates unknown functions to addins and newer functions to macro names", revision => {
  const book: Workbook = { names: [{ name: "Existing", expression: "=1" }],
    sheets: [{ id: "s1", name: "First", cells: [] }, { id: "s2", name: "Second", cells: [] }] };
  const writer = new BiffFormulaWriter(book, revision, context);
  const earlier = writer.compile("=Second!A1", "s1", 0, 0);
  const unknown = writer.compile("=FOO(1)", "s1", 0, 0);
  const macro = writer.compile("=IFERROR(1,2)", "s1", 0, 0);
  writer.compile("=foo(2)", "s1", 0, 0);
  writer.finalize();
  expect(writer.externNames).toEqual(["FOO"]);
  expect(writer.macroNames).toEqual(["_xlfn.IFERROR"]);
  const prefix = new Uint8Array(revision === 8 ? 7 : 25), view = new DataView(prefix.buffer);
  prefix[0] = 0x39;
  view.setUint16(1, revision === 8 ? 0 : 3, true);
  view.setUint16(revision === 8 ? 3 : 11, 1, true);
  expect(unknown.tokens).toEqual(new Uint8Array([...prefix, 30, 1, 0, 0x42, 2, 255, 0]));
  expect(macro.tokens[0]).toBe(0x23);
  expect(new DataView(macro.tokens.buffer).getUint16(1, true)).toBe(2);
  expect(macro.tokens.subarray(macro.tokens.length - 4)).toEqual(new Uint8Array([0x42, 3, 255, 0]));
  if (revision === 8) expect(new DataView(earlier.tokens.buffer).getUint16(1, true)).toBe(1);
  writer.finalize();
  if (revision === 8) expect(new DataView(earlier.tokens.buffer).getUint16(1, true)).toBe(1);
});

it.each([7, 8] as const)("BIFF%i expands whole-axis references within revision bounds", revision => {
  const writer = new BiffFormulaWriter({ sheets: [{ id: "s", name: "S", cells: [] }] }, revision, context);
  const column = writer.compile("=SUM(A:A)", "s", 0, 0).tokens;
  expect(column[0]).toBe(0x45);
  expect(new DataView(column.buffer).getUint16(1, true)).toBe(revision === 8 ? 0 : 0x4000);
  expect(new DataView(column.buffer).getUint16(3, true)).toBe(revision === 8 ? 65535 : 0x7fff);
  const row = writer.compile("=SUM(1:1)", "s", 0, 0).tokens;
  expect(row[0]).toBe(0x45);
  expect(row[revision === 8 ? 7 : 6]).toBe(255);
});

it.each([7, 8] as const)("BIFF%i saturates its custom palette with loss diagnostics instead of failing the save", revision => {
  const styles = new BiffStyles(context), output = new BiffOutput(context, revision === 8 ? 8224 : 2080);
  for (let i = 1; i <= 57; i++) styles.register({ style: { gnumeric: {
    name: "Style", namespace: "http://www.gnumeric.org/v10.dtd", text: "", children: [],
    attributes: [{ name: "Fore", namespace: "", value: `${i.toString(16).padStart(2, "0").repeat(2)}:0101:0202` }]
  } } });
  styles.serialize(output, revision);
  expect(styles.diagnostics.length).toBeGreaterThan(0);
  expect(styles.diagnostics.every(d => d.severity === "warning" && d.code === "biff-loss-warning")).toBe(true);
  expect(styles.diagnostics.some(d => d.message.includes("converting it to black"))).toBe(true);
  expect(output.finish().length).toBeGreaterThan(0);
});

const commentBook = (anchor: string, text = "comment"): Workbook => ({ sheets: [{ id: "s", name: "S", cells: [],
  unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained",
    data: biffNode("Objects", {}, "", [biffNode("CellComment", { ObjectBound: anchor, Text: text })]) }] }] });

it.each([7, 8, "dsf"] as const)("%s factory admits container bytes and observes cancellation during diagnostic callbacks", async profile => {
  const writer = createBiffWriter(profile), empty: Workbook = { sheets: [{ id: "s", name: "S", cells: [] }] };
  await expect(writer(empty, [], { ...context, limits: { ...context.limits, outputBytes: 2048 } }))
    .rejects.toMatchObject({ code: "resource-limit", exitCode: 1 });
  await expect(writer(empty, [], { ...context, limits: { ...context.limits, workbookNodes: 1 } }))
    .rejects.toMatchObject({ code: "resource-limit", exitCode: 1 });
  const controller = new AbortController(), reason = new Error("diagnostic canceled export");
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 256, value: { kind: "number", value: 1 } }] }] };
  let warnings = 0;
  await expect(writer(book, [], { ...context, signal: controller.signal,
    async diagnostic() { warnings++; controller.abort(reason); } })).rejects.toBe(reason);
  expect(warnings).toBe(1);
});

it.each([7, 8, "dsf"] as const)("%s factory enforces aggregate cells and sheet budgets", async profile => {
  const book: Workbook = { sheets: ["s1", "s2"].map(id => ({ id, name: id,
    cells: [{ row: 0, column: 0, value: { kind: "number", value: 1 } }] })) };
  await expect(createBiffWriter(profile)(book, [], { ...context, limits: { ...context.limits, cells: 1 } }).then(() => undefined))
    .rejects.toMatchObject({ code: "resource-limit", exitCode: 1 });
  await expect(createBiffWriter(profile)(book, [], { ...context, limits: { ...context.limits, sheets: 1 } }).then(() => undefined))
    .rejects.toMatchObject({ code: "resource-limit", exitCode: 1 });
});

it.each([7, 8, "dsf"] as const)("%s factory rejects invalid comment anchors and reports out-of-version comment loss", async profile => {
  await expect(createBiffWriter(profile)(commentBook("not-an-anchor"), [], context))
    .rejects.toMatchObject({ code: "invalid-request", exitCode: 1 });
  const warnings: string[] = [];
  const bytes = await createBiffWriter(profile)(commentBook("IW65537"), [], {
    ...context, async diagnostic(diagnostic) { warnings.push(diagnostic.message); } });
  expect(warnings.length).toBeGreaterThan(0);
  for (const stream of readCfb(bytes, context).values())
    expect(readBiffRecords(stream, context).filter(record => record.opcode === 0x1c)).toHaveLength(0);
});

it.each([7, 8, "dsf"] as const)("%s factory reports unsupported workbook and retained raw chart metadata", async profile => {
  const warnings: string[] = [];
  const book: Workbook = { unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "UnimplementedWorkbookMetadata", disposition: "retained" }],
    sheets: [{ id: "s", name: "S", cells: [], unsupportedRecords: [{ source: "biff", kind: "CHART", disposition: "retained",
      data: { opcode: 0x1002, offset: 0, bytes: "0100" } }] }] };
  await createBiffWriter(profile)(book, [], { ...context, async diagnostic(diagnostic) { warnings.push(diagnostic.message); } });
  expect(warnings.some(message => message.includes("UnimplementedWorkbookMetadata"))).toBe(true);
  expect(warnings.some(message => message.includes("CHART"))).toBe(true);
});

it.each([7, 8, "dsf"] as const)("%s factory bounds oversized metadata with typed failures", async profile => {
  await expect(createBiffWriter(profile)(commentBook("A1", "x".repeat(1000)), [],
    { ...context, limits: { ...context.limits, workbookWork: 100 } }))
    .rejects.toMatchObject({ code: "resource-limit", exitCode: 1 });
});

it("DSF finalizes late addins and macro names consistently across both streams", async () => {
  const book: Workbook = { sheets: [{ id: "s1", name: "First", cells: [
    { row: 0, column: 0, formula: "=Second!A1", value: { kind: "number", value: 1 } },
    { row: 1, column: 0, formula: "=FOO(1)", value: { kind: "number", value: 1 } },
    { row: 2, column: 0, formula: "=IFERROR(1,2)", value: { kind: "number", value: 1 } } ] },
    { id: "s2", name: "Second", cells: [{ row: 0, column: 0, value: { kind: "number", value: 1 } }] }] };
  const streams = readCfb(await createBiffWriter("dsf")(book, [], context), context);
  expect([...streams.keys()].sort()).toEqual(["Book", "Workbook"]);
  for (const [name, stream] of streams) {
    const records = readBiffRecords(stream, context), formulas = records.filter(record => record.opcode === 6);
    expect(formulas).toHaveLength(3);
    const macroNames = records.filter(record => record.opcode === 0x18);
    expect(macroNames).toHaveLength(1);
    expect(macroNames[0]!.data.u16(0) & 0xe).toBe(0xe);
    expect(formulas[1]!.data.u8(22)).toBe(0x39);
    expect(formulas[2]!.data.u8(22)).toBe(0x23);
    expect(formulas[2]!.data.u16(23)).toBe(1);
    if (name === "Workbook") {
      expect(formulas[0]!.data.u16(23)).toBe(1);
      expect(records.filter(record => record.opcode === 0x1ae)).toHaveLength(2);
      const links = records.find(record => record.opcode === 0x17)!;
      expect(links.data.u16(0)).toBe(2);
      expect(links.data.u16(2)).toBe(0);
      expect(links.data.u16(4)).toBe(0xfffe);
      expect(links.data.u16(8)).toBe(1);
      expect(links.data.u16(10)).toBe(1);
      expect(links.data.u16(12)).toBe(1);
    } else expect(formulas[1]!.data.u16(23)).toBe(3);
  }
});

it.each([7, 8, "dsf"] as const)("%s factory surfaces native function truncation diagnostics in defined names", async profile => {
  const warnings: string[] = [];
  const book: Workbook = { names: [{ name: "TruncatedIf", expression: "=IF(1,2,3,4)" }],
    sheets: [{ id: "s", name: "S", cells: [] }] };
  await createBiffWriter(profile)(book, [], { ...context, async diagnostic(diagnostic) { warnings.push(diagnostic.message); } });
  expect(warnings.some(message => message.includes("Too many arguments for function 'IF'"))).toBe(true);
});

it.each([7, 8] as const)("BIFF%i default workbook roundtrip avoids false unsupported-metadata diagnostics", async revision => {
  const original: Workbook = { sheets: [{ id: "s", name: "S", cells: [] }] };
  const reopened = await readBiff(await createBiffWriter(revision)(original, [], context), context);
  const warnings: string[] = [];
  await createBiffWriter(revision)(reopened, [], { ...context, async diagnostic(diagnostic) { warnings.push(diagnostic.message); } });
  expect(warnings).toEqual([]);
});

it.each([7, 8] as const)("BIFF%i treats a genuine PANE record independently of SCL zoom", revision => {
  const pane = { opcode: 0x41, offset: 0, data: new Binary(new Uint8Array(10)) };
  expect(readBiffMetadata([pane], revision, 1252, context).view).toEqual({});
  const scale = { opcode: 0xa0, offset: 14, data: new Binary(new Uint8Array([150, 0, 100, 0])) };
  expect(readBiffMetadata([pane, scale], revision, 1252, context).view).toEqual({ zoom: 1.5 });
});

it("BIFF7 awaits long-cell truncation warnings and preserves the borrowed cancellation reason and input", async () => {
  const source = "x".repeat(65535) + "Z", value = Object.freeze({ kind: "string" as const, value: source });
  const cell = Object.freeze({ row: 0, column: 0, value });
  const sheet = Object.freeze({ id: "s", name: "S", cells: Object.freeze([cell]) });
  const book: Workbook = Object.freeze({ sheets: Object.freeze([sheet]) });
  const controller = new AbortController(), reason = new Error("cancel during LABEL loss warning");
  const diagnostics: string[] = [];
  await expect(createBiffWriter(7)(book, [], { ...context, signal: controller.signal,
    async diagnostic(diagnostic) {
      diagnostics.push(diagnostic.message);
      await Promise.resolve(); controller.abort(reason);
    } })).rejects.toBe(reason);
  expect(diagnostics).toEqual(["Truncating string of 65536 bytes"]);
  expect(book.sheets[0]!.cells[0]).toBe(cell);
  expect(cell.value).toBe(value);
  expect(value.value).toBe(source);
  expect(value.value.length).toBe(65536);
  expect(value.value.at(-1)).toBe("Z");
});

it("BIFF7 writes exactly the truncated LABEL bytes across CONTINUE records without mutating frozen source", async () => {
  const source = "x".repeat(65535) + "Z", cell = Object.freeze({ row: 0, column: 0,
    value: Object.freeze({ kind: "string" as const, value: source }) });
  const book: Workbook = Object.freeze({ sheets: Object.freeze([Object.freeze({ id: "s", name: "S", cells: Object.freeze([cell]) })]) });
  const diagnostics: string[] = [];
  const bytes = await createBiffWriter(7)(book, [], { ...context,
    async diagnostic(diagnostic) { diagnostics.push(diagnostic.message); await Promise.resolve(); } });
  expect(diagnostics).toEqual(["Truncating string of 65536 bytes"]);
  const records = readBiffRecords(readCfb(bytes, context).get("Book")!, context);
  const at = records.findIndex(record => record.opcode === 0x204), label = records[at]!;
  expect(label.data.u16(6)).toBe(65535);
  let length = label.data.bytes.length - 8;
  expect(label.data.bytes.subarray(8).every(byte => byte === 120)).toBe(true);
  for (let index = at + 1; records[index]?.opcode === 0x3c; index++) {
    const continuation = records[index]!.data.bytes; length += continuation.length;
    expect(continuation.every(byte => byte === 120)).toBe(true);
  }
  expect(length).toBe(65535);
  expect(cell.value.value).toBe(source);
  expect(cell.value.value.length).toBe(65536);
  expect(cell.value.value.at(-1)).toBe("Z");
});
