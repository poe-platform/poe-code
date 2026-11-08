import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { readDif, writeDif } from "./dif.js";
import { readSylk, writeSylk, probeSylk } from "./sylk.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { renderCellText } from "../formatting.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 } };
const bytes = (text: string) => new TextEncoder().encode(text);

function fixture(text: string, filename: string) {
  const volume = Volume.fromJSON({ [filename]: text, "/keep": "original" });
  const engine = createEngine({ codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 },
    filesystem: { async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); } } });
  return { engine, volume, input: { kind: "resource" as const, uri: filename }, operation: { signal: new AbortController().signal } };
}
it("imports DIF typed records and writes the current sheet through injected SDK I/O", async () => {
  const f = fixture('TABLE\n0,1\n"Ignored name"\nVECTORS\n0,99\n""\nDATA\n0,0\n""\n-1,0\nBOT\n0,2.5\nV\n0,1\nTRUE\n0,0\nNA\n1,0\n"a""b"\n-1,0\nEOD\nignored trailer\n', "/book.dif");
  try {
    const book = await f.engine.readWorkbook(f.input, {}, f.operation);
    expect(book.sheets[0]).toMatchObject({ name: "Sheet1", cells: [
      { row: 0, column: 0, value: { kind: "number", value: 2.5 } },
      { row: 0, column: 1, value: { kind: "boolean", value: true } },
      { row: 0, column: 2, value: { kind: "error", value: "#N/A" } },
      { row: 0, column: 3, value: { kind: "string", value: 'a""b' } }
    ] });
    const result = await f.engine.convert({ input: f.input, destination: { kind: "resource", uri: "/output.dif" } }, f.operation);
    expect(result.exitCode).toBe(0);
    expect(f.volume.readFileSync("/output.dif", "utf8")).toBe('TABLE\n0,1\n"GNUMERIC"\nVECTORS\n0,4\n""\nTUPLES\n0,1\n""\nDATA\n0,0\n""\n-1,0\nBOT\n0,2.5\nV\n0,1\nTRUE\n0,0\nNA\n1,0\n"a""b"\n-1,0\nEOD\n');
    expect(f.volume.readFileSync("/keep", "utf8")).toBe("original");
  } finally { await f.engine.dispose(); }
});
it("matches DIF malformed line numbering, ignored headers/types and mandatory EOD", async () => {
  const messages: string[] = [];
  const book = await readDif(bytes('COMMENT\n0,0\n"x"\nDATA\n0,0\n""\n-1,0\nBOT\n0\n0,0\nERROR\n2,0\nignored\n0,9\nunknown\n0,7junk\nV\n-1,0\nEOD\n'), { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(book.sheets[0]!.cells).toEqual([{ row: 0, column: 2, value: { kind: "number", value: 7 } }]);
  expect(messages).toEqual(["Syntax error at line 10. Ignoring.", "Unknown value type 'ERROR' at line 12. Ignoring.", "Unknown value type 2 at line 13. Ignoring."]);
  await expect(readDif(bytes('DATA\n0,0\n""\n-1,0\nBOT\n'), context)).rejects.toThrow("Unexpected end of file at line 6 while reading data.");
  await expect(readDif(bytes('TABLE\n0,1\n'), context)).rejects.toThrow("Unexpected end of file at line 3 while reading header.");
});
it("matches SYLK default B2 position, invalid coordinates, quoted values and ordered warnings", async () => {
  const messages: string[] = [];
  const book = await readSylk(bytes('ID;POriginal\nC;KTRUE\nC;X0;Y65537;K1;K2;E1+;E3\nC;X256junk;Y65536;K#DIV/0!\nC;X3;Y2;K"unclosed\n'), { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(book.sheets[0]!.cells).toMatchObject([
    { row: 1, column: 1, value: { kind: "number", value: 2 }, formula: "=3" },
    { row: 1, column: 2, value: { kind: "string", value: "unclosed" } },
    { row: 65535, column: 255, value: { kind: "error", value: "#DIV/0!" } }
  ]);
  expect(messages).toEqual(["1:Unknown directive 'ID;POriginal'", "3:Multiple values in the same cell", "5:Missing closing 'E'"]);
  expect(await probeSylk(bytes("ID;"), context)).toBe(true);
  expect(await probeSylk(bytes("ID"), context)).toBe(false);
  expect(await probeSylk(bytes(" ID;"), context)).toBe(false);
});
it("uses Latin-1 even when an import encoding is supplied and decodes SYLK escape accents", async () => {
  const book = await readSylk(Uint8Array.from([...bytes('ID\nC;X1;Y1;K"'), 0x80, 0xe9, ...bytes('\x1bNBe;;x"\nE\n')]), context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "\u0080éé;x" });
  const f = fixture('ID;POriginal\nC;X1;Y1;K"é"\nE\n', "/book.slk");
  f.volume.writeFileSync("/book.slk", Uint8Array.from([...bytes('ID;POriginal\nC;X1;Y1;K"'), 0xe9, ...bytes('"\nE\n')]));
  try { expect((await f.engine.readWorkbook(f.input, { importEncoding: "UTF-8" }, f.operation)).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "é" }); }
  finally { await f.engine.dispose(); }
});
it("retains SYLK styles, axes, matrix scope and workbook options without expanding whole axes", async () => {
  const book = await readSylk(bytes('ID\nP;P0.00\nP;EArial;M240;SIB\nF;P0;SM1;SDITBLR;C2;M300\nF;R3;M400\nO;M;V4;A12 0.02;L;P;Z\nC;Y3;X2;K7;R4;C3;MR1C1+1\nE\n'), context);
  expect(book).toMatchObject({ calculationMode: "manual", dateSystem: "1904", iteration: { enabled: true, maximum: 12, tolerance: 0.02 }, sheets: [{
    columns: [{ index: 1, sizePoints: 15 }], rows: [{ index: 2, sizePoints: 20 }], view: { referenceMode: "A1", isProtected: true, hideZero: true },
    cells: [
      { row: 2, column: 1, formula: "=$A$1+1", format: "0.00", style: { Font: { Name: "Arial", Unit: 12, Bold: 1, Italic: 1 }, StyleBorder: { Top: true, Bottom: true, Left: true, Right: true } } },
      { row: 2, column: 2, formula: "=$A$1+1", formulaGroup: "array-7" },
      { row: 3, column: 1, formula: "=$A$1+1", formulaGroup: "array-7", format: "0.00" },
      { row: 3, column: 2, formula: "=$A$1+1", formulaGroup: "array-7" }
    ],
    formulaGroups: [{ kind: "array", range: { startRow: 2, startColumn: 1, endRow: 3, endColumn: 2 } }]
  }] });
});
it("writes only the active sheet, preserves native sparse DIF shifting and lossy SYLK quoting", async () => {
  const book: Workbook = { sheets: [{ id: "other", name: "Other", cells: [{ row: 0, column: 0, value: { kind: "number", value: 99 } }] },
    { id: "chosen", name: "Chosen", cells: [{ row: 2, column: 2, value: { kind: "string", value: 'é;"x' } }] }], activeSheet: "chosen" };
  const dif = await writeDif(book, [], context);
  expect(new TextDecoder().decode(dif)).toContain('TUPLES\n0,3\n');
  expect((await readDif(dif, context)).sheets[0]!.cells[0]).toMatchObject({ row: 0, column: 0, value: { kind: "string", value: 'Ã©;"x' } });
  const sylk = await writeSylk(book, [], context);
  expect(new TextDecoder().decode(sylk)).toContain('C;Y3;X3;K"?;;"x"\r\n');
  expect((await readSylk(sylk, context)).sheets[0]!.cells[0]).toMatchObject({ row: 2, column: 2, value: { kind: "string", value: '?;"x' } });
});
it("enforces input, output, cell budgets and cancellation before publication", async () => {
  await expect(readSylk(bytes("ID;\nE\n"), { ...context, limits: { ...context.limits, inputBytes: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
  await expect(readSylk(bytes("ID\nC;X1;Y1;K1\nC;X2;K2\nE\n"), { ...context, limits: { ...context.limits, cells: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [] }] };
  await expect(writeDif(book, [], { ...context, limits: { ...context.limits, outputBytes: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
  await expect(writeSylk(book, [], { ...context, signal: AbortSignal.abort() })).rejects.toThrow();
});
it("retains DIF unqueued formulas and value-only inferred formats, and counts empty SYLK strings on DIF save", async () => {
  const f = fixture('DATA\n0,0\n""\n-1,0\nBOT\n1,0\n"=1+2"\n1,0\n"12%"\n1,0\n"2000-01-01"\n-1,0\nEOD\n', "/book.dif");
  try {
    const book = await f.engine.readWorkbook(f.input, {}, f.operation);
    expect(book.sheets[0]!.cells).toEqual([
      { row: 0, column: 0, formula: "=1+2", value: { kind: "blank" }, cachedResult: { kind: "blank" }, formulaDirty: false },
      { row: 0, column: 1, value: { kind: "number", value: 0.12 }, style: { gnumericValueFormat: "0.00%" } },
      { row: 0, column: 2, value: { kind: "number", value: 36526 }, style: { gnumericValueFormat: "yyyy-mmm-dd" } }
    ]);
    await f.engine.convert({ input: f.input, destination: { kind: "resource", uri: "/default.csv" } }, f.operation);
    expect(f.volume.readFileSync("/default.csv", "utf8")).toBe(",0.12,2000/01/01\n");
    await f.engine.convert({ input: f.input, destination: { kind: "resource", uri: "/recalc.csv" }, recalc: true }, f.operation);
    expect(f.volume.readFileSync("/recalc.csv", "utf8")).toBe("3,0.12,2000/01/01\n");
  } finally { await f.engine.dispose(); }
  const sylk = await readSylk(bytes('ID\nC;Y1;X1;K""\nE\n'), context);
  const dif = new TextDecoder().decode(await writeDif(sylk, [], context));
  expect(dif).toContain('-1,0\nBOT\n1,0\n""\n-1,0\nEOD\n');
  const trailing: Workbook = { sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 1 } }, { row: 0, column: 2, value: { kind: "string", value: "" } }
  ] }] };
  expect(new TextDecoder().decode(await writeDif(trailing, [], context))).toContain('VECTORS\n0,3\n');
});
it("matches DIF C-locale numeric prefixes, nonfinite errors and ASCII-only whitespace", async () => {
  const values = ["NaN", "Infinity", "inf", "-inf", "0x10", "1e-999", "1e999", "\u00a02", "2\u00a0", " 2 "];
  const book = await readDif(Uint8Array.from('DATA\n0,0\n""\n-1,0\nBOT\n' + values.map(v => `0,${v}\nV\n`).join("") + '-1,0\nEOD\n', c => c.charCodeAt(0)), context);
  expect(book.sheets[0]!.cells.map(c => c.value)).toEqual([
    { kind: "error", value: "#NUM!" }, { kind: "error", value: "#NUM!" }, { kind: "error", value: "#NUM!" }, { kind: "error", value: "#NUM!" },
    { kind: "number", value: 0 }, { kind: "number", value: 0 }, { kind: "error", value: "#NUM!" },
    { kind: "number", value: 0 }, { kind: "number", value: 2 }, { kind: "number", value: 2 }
  ]);
});
it("preserves native SYLK formula caches until forced recalc and rejects unknown sheets", async () => {
  const f = fixture('ID;POriginal\nC;Y1;X1;K7\nC;X2;K99;ER1C1+1\nC;X3;K1;EUnknown!R1C1\nC;X4;K5;E2\nC;X5;E3\nC;X6;K3;EMissingName+1\nE\n', "/book.slk");
  try {
    const book = await f.engine.readWorkbook(f.input, {}, f.operation);
    expect(book.sheets[0]!.cells).toMatchObject([
      { row: 0, column: 0, value: { kind: "number", value: 7 } },
      { row: 0, column: 1, formula: "=$A$1+1", formulaDirty: false, cachedResult: { kind: "number", value: 99 } },
      { row: 0, column: 2, value: { kind: "number", value: 1 } },
      { row: 0, column: 3, formula: "=2", cachedResult: { kind: "number", value: 5 }, formulaDirty: false },
      { row: 0, column: 4, formula: "=3", cachedResult: { kind: "blank" }, formulaDirty: false },
      { row: 0, column: 5, formula: "=MissingName+1", cachedResult: { kind: "number", value: 3 }, formulaDirty: false }
    ]);
    expect(book.sheets[0]!.cells[2]!.formula).toBeUndefined();
    expect(book.names).toEqual([{ name: "MissingName", expression: "=#NAME?", position: { sheet: "Sheet1", row: 0, column: 5 } }]);
    await f.engine.convert({ input: f.input, destination: { kind: "resource", uri: "/default.csv" } }, f.operation);
    expect(f.volume.readFileSync("/default.csv", "utf8")).toBe("7,99,1,5,,3\n");
    await f.engine.convert({ input: f.input, destination: { kind: "resource", uri: "/recalc.csv" }, recalc: true }, f.operation);
    expect(f.volume.readFileSync("/recalc.csv", "utf8")).toBe("7,8,1,2,3,#NAME?\n");
  } finally { await f.engine.dispose(); }
});
it("uses native built-in formula spellings with R1C1 output", async () => {
  const book = await readSylk(bytes('ID\nC;Y1;X1;K2;ESUM(R1C2:R1C3)\nE\n'), context);
  expect(new TextDecoder().decode(await writeSylk(book, [], context))).toContain('C;Y1;X1;K2;Esum(R1C2:R1C3)\r\n');
});
it("retains native name creation from malformed and overwritten SYLK formulas", async () => {
  const book = await readSylk(bytes('ID\nC;Y1;X1;K7;EFailedName+\nC;X2;K8;EFirstName+1;ESecondName+\nE\n'), context);
  expect(book.names).toEqual([
    { name: "FailedName", expression: "=#NAME?", position: { sheet: "Sheet1", row: 0, column: 0 } },
    { name: "FirstName", expression: "=#NAME?", position: { sheet: "Sheet1", row: 0, column: 1 } },
    { name: "SecondName", expression: "=#NAME?", position: { sheet: "Sheet1", row: 0, column: 1 } }
  ]);
  expect(book.sheets[0]!.cells.map(c => c.formula)).toEqual([undefined, undefined]);
});
it("deduplicates SYLK qualified names across sheet-name case before workbook admission", async () => {
  const f = fixture('ID;POriginal\nC;X1;Y1;K1;ESheet1!foo+sheet1!foo\nE\n', "/book.slk");
  try {
    const book = await f.engine.readWorkbook(f.input, {}, f.operation);
    expect(book.names).toEqual([{ name: "foo", sheet: "Sheet1", expression: "=#NAME?", position: { sheet: "Sheet1", row: 0, column: 0 } }]);
  } finally { await f.engine.dispose(); }
});
it("uses value-only formats when the cell style is General, preserving explicit style overrides", async () => {
  const book: Workbook = { sheets: [] };
  const cell = { row: 0, column: 0, value: { kind: "number" as const, value: 0.12 }, format: "General", style: { gnumericValueFormat: "0.00%" } };
  expect(await renderCellText(cell, book, context, "preserve")).toBe("12.00%");
  expect(await renderCellText({ ...cell, format: "0.0" }, book, context, "preserve")).toBe("0.1");
});
it("writes array follower I records from SDK group metadata even without cell formulas", async () => {
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 1 }, formula: "={1,2}", formulaGroup: "array" },
    { row: 0, column: 1, value: { kind: "number", value: 2 }, formulaGroup: "array" }
  ], formulaGroups: [{ id: "array", kind: "array", expression: "={1,2}", range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 } }] }] };
  expect(new TextDecoder().decode(await writeSylk(book, [], context))).toContain('C;Y1;X1;K1;R1;C2;M{1,2}\r\nC;X2;K2;I\r\n');
});
it("keeps ID-prefixed SYLK out of automatic CSV fallback even with a misleading CSV suffix", async () => {
  const f = fixture('ID;POriginal\nC;X1;Y1;K7\nE\n', "/book.csv");
  try {
    expect((await f.engine.readWorkbook(f.input, {}, f.operation)).sheets[0]!.cells).toEqual([{ row: 0, column: 0, value: { kind: "number", value: 7 } }]);
    const forced = await f.engine.readWorkbook(f.input, { importType: "Gnumeric_stf:stf_csvtab" }, f.operation);
    expect(forced.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "ID;POriginal" });
  } finally { await f.engine.dispose(); }
});
it("probes ID SYLK ahead of CSV, preserves sparse coordinates and R1C1 formulas", async () => {
  const f = fixture('ID;POriginal\nP;P0.00\nF;P0;Y3;X2\nC;Y3;X2;K4\nC;X3;K5;ERC[-1]+1\nC;X4;K"a;;b"\nNN;Nignored;ER3C2\nE\nC;X5;K99\n', "/book.bin");
  try {
    const book = await f.engine.readWorkbook(f.input, {}, f.operation);
    expect(book.sheets[0]).toMatchObject({ name: "Sheet1", size: { columns: 256, rows: 65536 }, cells: [
      { row: 2, column: 1, value: { kind: "number", value: 4 }, format: "0.00" },
      { row: 2, column: 2, formula: "=B3+1", cachedResult: { kind: "number", value: 5 } },
      { row: 2, column: 3, value: { kind: "string", value: "a;b" } }
    ] });
    expect(book.names).toBeUndefined();
    const result = await f.engine.convert({ input: f.input, destination: { kind: "resource", uri: "/output.slk" } }, f.operation);
    expect(result.exitCode).toBe(0);
    expect(f.volume.readFileSync("/output.slk", "utf8")).toContain('C;Y3;X2;K4\r\nC;X3;K5;ERC[-1]+1\r\nC;X4;K"a;;b"\r\nE\r\n');
  } finally { await f.engine.dispose(); }
});
