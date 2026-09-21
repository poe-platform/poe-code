import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import { createRegistry } from "./registry.js";
import { readCfb, readBiffRecords } from "./biff-binary.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { biffNode } from "./biff-metadata.js";

export const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 1000, sheets: 8, operations: 1000 } };

it.each([ ["excel_biff7", ["Book"]], ["excel_biff8", ["Workbook"]],
  ["excel_dsf", ["Book", "Workbook"]] ] as const)("writes distinct %s streams through CLI/SDK and memfs", async (profile, names) => {
  const volume = Volume.fromJSON({ "/in.csv": "hello,42\n" });
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); } } });
  const errors: Uint8Array[] = [];
  try {
    const result = await runCommand(["-T", `Gnumeric_Excel:${profile}`, "/in.csv", "/out.xls"], engine,
      { ...context, stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(new Uint8Array(bytes)); } } });
    expect({ exitCode: result.exitCode, stderr: errors.map(bytes => new TextDecoder().decode(bytes)).join("") })
      .toEqual({ exitCode: 0, stderr: "" });
    const streams = readCfb(new Uint8Array(volume.readFileSync("/out.xls") as Uint8Array), context);
    expect([...streams.keys()].filter(name => name === "Book" || name === "Workbook").sort()).toEqual(names);
    for (const name of names) {
      const records = readBiffRecords(streams.get(name)!, context);
      expect(records[0]!.data.u16(0)).toBe(name === "Book" ? 0x500 : 0x600);
      if (name === "Workbook") expect(records.find(record => record.opcode === 0x161)!.data.u16(0))
        .toBe(profile === "excel_dsf" ? 1 : 0);
      const reopened = await engine.readWorkbook({ kind: "stream", source: [streams.get(name)!] },
        { importType: "Gnumeric_Excel:excel" }, context);
      expect(reopened.sheets[0]!.cells.map(cell => cell.value)).toEqual([
        { kind: "string", value: "hello" }, { kind: "number", value: 42 } ]);
    }
  } finally { await engine.dispose(); }
});
it("preserves stable default .xls saver priority", () => {
  expect(createRegistry([]).select("write", undefined, "out.xls")?.id).toBe("Gnumeric_Excel:excel_biff8");
});

it("emits native-required default XF, GUTS and WSBOOL record layouts", async () => {
  const bytes = await createBiffWriter(8)({ sheets: [{ id: "s", name: "S", cells: [] }] }, [], context);
  const records = readBiffRecords(readCfb(bytes, context).get("Workbook")!, context);
  expect(records.filter(record => record.opcode === 0xe0).length).toBeGreaterThanOrEqual(16);
  expect(records.find(record => record.opcode === 0x80)!.data.bytes).toHaveLength(8);
  expect(records.find(record => record.opcode === 0x81)!.data.bytes).toHaveLength(2);
});

it.each([7, 8, "dsf"] as const)("exports %s formula RPN, caches and revision-specific references", async profile => {
  const values = [
    { formula: "=1+2", value: { kind: "number", value: 3 } },
    { formula: '=IF(TRUE,"yes","no")', value: { kind: "string", value: "yes" } },
    { formula: "=$A$1+B1", value: { kind: "number", value: 3 } },
    { formula: "=FALSE", value: { kind: "boolean", value: false } },
    { formula: "=#N/A", value: { kind: "error", value: "#N/A" } }
  ] as const;
  const book: Workbook = { dateSystem: "1904", calculationMode: "manual", sheets: [{ id: "s", name: "S",
    cells: values.map((cell, row) => ({ ...cell, row, column: 0, cachedResult: cell.value })) }] };
  const bytes = await createBiffWriter(profile)(book, [], context);
  for (const [name, stream] of readCfb(bytes, context)) {
    const records = readBiffRecords(stream, context), formulas = records.filter(record => record.opcode === 6);
    expect(formulas[0]!.data.bytes.subarray(22)).toEqual(new Uint8Array([30, 1, 0, 30, 2, 0, 3]));
    expect(formulas[2]!.data.u16(20)).toBe(name === "Book" ? 9 : 11);
    const reopened = await readBiff(stream, context);
    expect(reopened).toMatchObject({ dateSystem: "1904", calculationMode: "manual" });
    expect(reopened.sheets[0]!.cells).toMatchObject(values.map(cell => ({ ...cell, cachedResult: cell.value })));
  }
});

it.each([7, 8] as const)("writes BIFF%i names, arrays and materializes shared formula cells", async revision => {
  const book: Workbook = { names: [{ name: "Answer", expression: "=42" }], sheets: [{ id: "s", name: "S",
    formulaGroups: [ { id: "a", kind: "array", range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 }, expression: "=ROW(A1:A2)" },
      { id: "shared", kind: "shared", range: { startRow: 2, endRow: 3, startColumn: 0, endColumn: 0 }, expression: "=B3+1" } ],
    cells: [ { row: 0, column: 0, formula: "=ROW(A1:A2)", formulaGroup: "a", value: { kind: "number", value: 1 } },
      { row: 1, column: 0, formula: "=ROW(A1:A2)", formulaGroup: "a", value: { kind: "number", value: 2 } },
      { row: 2, column: 0, formula: "=B3+1", formulaGroup: "shared", value: { kind: "number", value: 1 } },
      { row: 3, column: 0, formula: "=B4+1", formulaGroup: "shared", value: { kind: "number", value: 1 } },
      { row: 4, column: 0, formula: "=Answer", value: { kind: "number", value: 42 } } ] }] };
  const bytes = await createBiffWriter(revision)(book, [], context), reopened = await readBiff(bytes, context);
  expect(reopened.names).toContainEqual({ name: "Answer", expression: "=42" });
  expect(reopened.sheets[0]!.formulaGroups).toMatchObject([{ kind: "array", expression: "=ROW(A1:A2)" }]);
  expect(reopened.sheets[0]!.cells.slice(2, 4).map(cell => cell.formula)).toEqual(["=B3+1", "=B4+1"]);
});

it.each([7, 8] as const)("writes BIFF%i literal array tokens and auxiliary values", async revision => {
  const bytes = await createBiffWriter(revision)({ sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula: "=SUM({1,2;3,4})", value: { kind: "number", value: 10 } } ] }] }, [], context);
  const formula = readBiffRecords(readCfb(bytes, context).get(revision === 7 ? "Book" : "Workbook")!, context).find(record => record.opcode === 6)!;
  expect(formula.data.u16(20)).toBe(12);
  expect(formula.data.bytes.subarray(22, 30)).toEqual(new Uint8Array([64, 0, 0, 0, 0, 0, 0, 0]));
  expect(formula.data.bytes.subarray(34, 37)).toEqual(new Uint8Array(revision === 8 ? [1, 1, 0] : [2, 2, 0]));
});

it.each([7, 8] as const)("retains BIFF%i font, alignment, format and palette styles", async revision => {
  const node = { name: "Style", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: [
    { name: "Fore", namespace: "", value: "1234:5656:9A9A" }, { name: "WrapText", namespace: "", value: "1" },
    { name: "HAlign", namespace: "", value: "GNM_HALIGN_RIGHT" } ], children: [{ name: "Font", namespace: "http://www.gnumeric.org/v10.dtd",
      text: "Courier New", attributes: [{ name: "Bold", namespace: "", value: "1" }, { name: "Unit", namespace: "", value: "14" }], children: [] }] };
  const bytes = await createBiffWriter(revision)({ sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 1 }, format: "0.000", style: { gnumeric: node } } ] }] }, [], context);
  const cell = (await readBiff(bytes, context)).sheets[0]!.cells[0]!;
  expect(cell.format).toBe("0.000");
  expect(JSON.stringify(cell.style)).toContain("Courier New");
  expect(JSON.stringify(cell.style)).toContain("1212:5656:9A9A");
  expect(JSON.stringify(cell.style)).toContain('"value":"GNM_HALIGN_RIGHT"');
});

it.each([7, 8] as const)("exports BIFF%i print settings, axis records and comments", async revision => {
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [], rows: [{ index: 2, sizePoints: 24, hidden: true }],
    columns: [{ index: 1, sizePoints: 72, hidden: true }], unsupportedRecords: [
      { source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: biffNode("Objects", {}, "", [
        biffNode("CellComment", { ObjectBound: "B3", Text: "a comment Ω", Author: "writer" }) ]) },
      { source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained", data: biffNode("PrintInformation", {}, "", [
        biffNode("orientation", {}, "landscape"), biffNode("paper", {}, "na_letter"), biffNode("grid", { value: 1 }),
        biffNode("Header", { Left: "Title", Middle: "&[PAGE]" }), biffNode("Margins", {}, "", [biffNode("left", { Points: 36 })]) ]) }
    ] }] };
  const bytes = await createBiffWriter(revision)(book, [], context), sheet = (await readBiff(bytes, context)).sheets[0]!;
  expect(sheet.rows).toMatchObject([{ index: 2, sizePoints: 24, hidden: true }]);
  expect(sheet.columns).toMatchObject([{ index: 1, hidden: true }]);
  const objects = sheet.unsupportedRecords!.find(record => record.source === "Gnumeric_XmlIO:sax" && record.kind === "Objects")!;
  expect(JSON.stringify(objects)).toContain(revision === 8 ? "a comment Ω" : "a comment ?");
  if (revision === 8) expect(JSON.stringify(objects)).toContain("writer");
  const print = sheet.unsupportedRecords!.find(record => record.source === "Gnumeric_XmlIO:sax" && record.kind === "PrintInformation")!;
  expect(JSON.stringify(print)).toContain("landscape"); expect(JSON.stringify(print)).toContain("Title");
  expect(JSON.stringify(print)).toContain('"value":"36"');
});

it.each([7, 8, "dsf"] as const)("clips %s at its native dimensions with ordered warnings", async profile => {
  const warnings: string[] = [], book: Workbook = { sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 1 } },
    { row: 16384, column: 0, value: { kind: "number", value: 2 } },
    { row: 65536, column: 0, value: { kind: "number", value: 3 } },
    { row: 0, column: 256, value: { kind: "number", value: 4 } } ] }] };
  const bytes = await createBiffWriter(profile)(book, [], { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(warnings).toEqual([
    "W Some content will be lost when saving.  This format only supports 256 columns, and this workbook has 256" ]);
  for (const stream of readCfb(bytes, context).values()) {
    const cells = (await readBiff(stream, context)).sheets[0]!.cells;
    expect(cells.map(cell => cell.value)).toEqual(profile === 8 ? [{ kind: "number", value: 1 }, { kind: "number", value: 2 }] : [{ kind: "number", value: 1 }]);
  }
});

it.each([7, 8] as const)("splits BIFF%i long strings without losing data", async revision => {
  const text = "aΩ".repeat(5000), bytes = await createBiffWriter(revision)({ sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "string", value: text } } ] }] }, [], context);
  const reopened = await readBiff(bytes, context);
  expect(reopened.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: revision === 8 ? text : "a?".repeat(5000) });
});

it.each([7, 8] as const)("splits BIFF%i formula string caches and orders array records before STRING", async revision => {
  const text = "aΩ".repeat(5000), book: Workbook = { sheets: [{ id: "s", name: "S", formulaGroups: [
    { id: "a", kind: "array", expression: '=IF(TRUE,"yes","no")', range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 0 } } ], cells: [
    { row: 0, column: 0, formula: '=REPT("a",10000)', value: { kind: "string", value: text } },
    { row: 1, column: 0, formula: '=IF(TRUE,"yes","no")', formulaGroup: "a", value: { kind: "string", value: "yes" } } ] }] };
  const reopened = await readBiff(await createBiffWriter(revision)(book, [], context), context);
  expect(reopened.sheets[0]!.cells[0]!.cachedResult).toEqual({ kind: "string", value: revision === 8 ? text : "a?".repeat(5000) });
  expect(reopened.sheets[0]!.cells[1]).toMatchObject({ formula: '=IF(TRUE,"yes","no")', cachedResult: { kind: "string", value: "yes" } });
});

it("writes URL hyperlinks and tooltips with native GUID and length encodings", async () => {
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0,
    value: { kind: "string", value: "link" }, style: { gnumeric: biffNode("Style", {}, "", [
      biffNode("HyperLink", { type: "GnmHLinkURL", target: "https://example.com/Ω", tip: "go" }) ]) } }] }] };
  const stream = readCfb(await createBiffWriter(8)(book, [], context), context).get("Workbook")!;
  const records = readBiffRecords(stream, context), link = records.find(record => record.opcode === 0x1b8)!;
  expect(link).toBeDefined(); expect(link.data.u32(28)).toBe(3);
  expect(link.data.u32(48)).toBe(("https://example.com/Ω".length + 1) * 2);
  expect(new TextDecoder("utf-16le").decode(link.data.bytes.subarray(52))).toBe("https://example.com/Ω\0");
  expect(records.find(record => record.opcode === 0x800)!.data.u16(0)).toBe(0x800);
  expect(records.indexOf(link)).toBeGreaterThan(records.findIndex(record => record.opcode === 0xfd));
});

it("emits BIFF7 externsheet/addin tables in every worksheet scope", async () => {
  const bytes = await createBiffWriter(7)({ sheets: [ { id: "s", name: "S", cells: [
    { row: 0, column: 0, formula: "=FOO(1)", value: { kind: "error", value: "#NAME?" } } ] },
    { id: "t", name: "T", cells: [] } ] }, [], context);
  const records = readBiffRecords(readCfb(bytes, context).get("Book")!, context);
  const starts = records.map((record, index) => record.opcode === 0x809 && record.data.u16(2) === 16 ? index : -1).filter(index => index >= 0);
  for (const start of starts) {
    const end = records.findIndex((record, index) => index > start && record.opcode === 10), scope = records.slice(start, end);
    expect(scope.filter(record => record.opcode === 0x17)).toHaveLength(4);
    expect(scope.filter(record => record.opcode === 0x23)).toHaveLength(1);
  }
});

it.each([7, 8] as const)("exports BIFF%i native merges, active sheet and zoom", async revision => {
  const range = { startRow: 1, endRow: 2, startColumn: 0, endColumn: 1 };
  const bytes = await createBiffWriter(revision)({ activeSheet: "s", sheets: [
    { id: "s", name: "S", cells: [], merges: [range], view: { zoom: 1.5 } }, { id: "t", name: "T", cells: [] } ] }, [], context);
  const reopened = await readBiff(bytes, context);
  expect(reopened.activeSheet).toBe(reopened.sheets[0]!.id);
  expect(reopened.sheets[0]!.merges).toEqual([range]);
  expect(reopened.sheets[0]!.view?.zoom).toBe(1.5);
});

it("matches native default print margins and Normal Sans column-width encoding", async () => {
  const bytes = await createBiffWriter(8)({ sheets: [{ id: "s", name: "S", cells: [], columns: [{ index: 1, sizePoints: 72 }] }] }, [], context);
  const records = readBiffRecords(readCfb(bytes, context).get("Workbook")!, context);
  expect(records.find(record => record.opcode === 0x28)!.data.f64(0)).toBe(120 / 72);
  expect(records.find(record => record.opcode === 0x29)!.data.f64(0)).toBe(120 / 72);
  expect(records.find(record => record.opcode === 0x7d)!.data.u16(4)).toBe(3508);
});

it("does not publish on cancellation, budget failure or sink failure and preserves memfs bytes", async () => {
  const volume = Volume.fromJSON({ "/in.csv": "hello\n", "/out.xls": "keep" }); let writes = 0;
  const engine = createEngine({ codecs: [], environment: context.environment, limits: { ...context.limits, outputBytes: 4000 },
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { writes++; volume.writeFileSync(uri, bytes); } } });
  try {
    await expect(engine.convert({ input: { kind: "resource", uri: "/in.csv" }, destination: { kind: "resource", uri: "/out.xls" } }, context))
      .rejects.toMatchObject({ code: "resource-limit" });
    expect(writes).toBe(0); expect(volume.readFileSync("/out.xls", "utf8")).toBe("keep");
    const controller = new AbortController(), reason = { cancelled: true }; controller.abort(reason);
    await expect(createBiffWriter(8)({ sheets: [] }, [], { ...context, signal: controller.signal })).rejects.toBe(reason);
  } finally { await engine.dispose(); }
  const writer = createEngine({ codecs: [], environment: context.environment, limits: context.limits });
  const reason = new Error("refused sink");
  try {
    await expect(writer.convert({ input: { kind: "stream", filename: "in.csv", source: [new TextEncoder().encode("x\n")] },
      exportType: "Gnumeric_Excel:excel_biff8", destination: { kind: "stream", sink: { async write() { throw reason; } } } }, context))
      .rejects.toThrow("refused sink");
  } finally { await writer.dispose(); }
});

it.each([7, 8] as const)("exports BIFF%i zoom using SCL rather than malformed PANE", async revision => {
  const bytes = await createBiffWriter(revision)({ sheets: [{ id: 's', name: 'S', cells: [], view: { zoom: 1.5 } }] }, [], context);
  const records = readBiffRecords(readCfb(bytes, context).values().next().value!, context);
  expect(records.filter(record => record.opcode === 0x41)).toHaveLength(0);
  const scale = records.find(record => record.opcode === 0xa0)!;
  expect([scale.data.u16(0), scale.data.u16(2)]).toEqual([150, 100]);
});

it("matches native BIFF7 oversized LABEL truncation and diagnostic", async () => {
  const warnings: string[] = [];
  const bytes = await createBiffWriter(7)({ sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "x".repeat(65536) } }
  ] }] }, [], { ...context, async diagnostic(diagnostic) { warnings.push(diagnostic.message); } });
  expect(warnings).toEqual(["Truncating string of 65536 bytes"]);
  const reopened = await readBiff(bytes, context);
  expect(reopened.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "x".repeat(65535) });
});
