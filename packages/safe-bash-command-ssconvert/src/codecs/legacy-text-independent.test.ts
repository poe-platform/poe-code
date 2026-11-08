import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";

const environment = { env: {}, locale: "C", timezone: "UTC" };
const limits = { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 };

function applixSource(records: string, openCell = "Open Cell: A:A1\n") {
  return '*BEGIN SPREADSHEETS VERSION=430/0 ENCODING=7BIT\nSpreadsheet Dump Rev 4.42 Line Length 200\nPercent Zoom Factor: 100\n' +
    openCell + 'View Start, Name: ~A:~\nView End, Name: ~A:~\nHeaders And Footers\nHeaders And Footers End\n' + records + '*END SPREADSHEETS\n';
}

async function load(text: string, id: string) {
  const diagnostics: string[] = [];
  const engine = createEngine({ codecs: [], limits, environment });
  try {
    const book = await engine.readWorkbook({ kind: "stream", source: [new TextEncoder().encode(text)] },
      { importType: id }, { signal: new AbortController().signal,
        async diagnostic(value) { diagnostics.push(value.message); } });
    return { book, diagnostics };
  } finally { await engine.dispose(); }
}

it("Oleo coordinate-only and ignored-field records preserve an existing cell", async () => {
  const { book } = await load('C;r1;c1;K7\nC;r1;c1\nC;r1;c1;Zignored\n', "Gnumeric_oleo:oleo");
  expect(book.sheets[0]!.cells).toEqual([{ row: 0, column: 0, value: { kind: "number", value: 7 } }]);
});

it.each(["r1x;c2", "c2x;r1"])("Oleo stops at the first unconsumed coordinate byte in %s", async fields => {
  const { book } = await load(`C;${fields};K7\n`, "Gnumeric_oleo:oleo");
  expect(book.sheets[0]!.cells).toEqual([{
    row: 0, column: fields.startsWith("c") ? 1 : 0, value: { kind: "blank" }
  }]);
});

it("Oleo a new default style replaces prior alignment and number format", async () => {
  const { book } = await load('Fr1c1RFF2\nC;K7\nF\nC;K8\n', "Gnumeric_oleo:oleo");
  const cell = book.sheets[0]!.cells[0]!;
  expect(cell.value).toEqual({ kind: "number", value: 8 });
  expect(cell.style?.HAlign).toBeUndefined();
  expect(cell.format).toBeUndefined();
});

it("Oleo retains an explicitly supplied expression cache until recalculation is requested", async () => {
  const source = 'C;r1;c1;K7\nC;c2;K99;ER1C1+2\n';
  const engine = createEngine({ codecs: [], limits, environment });
  try {
    for (const [recalc, expected] of [[false, "7,99\n"], [true, "7,9\n"]] as const) {
      let output = "";
      const result = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode(source)] },
        importType: "Gnumeric_oleo:oleo", exportType: "Gnumeric_stf:stf_csv", recalc,
        destination: { kind: "stream", sink: { async write(bytes) { output += new TextDecoder().decode(bytes); } } } },
      { signal: new AbortController().signal });
      expect(result.exitCode).toBe(0);
      expect(output).toBe(expected);
    }
  } finally { await engine.dispose(); }
});

it("Oleo expression diagnostics use the native A1 cell location", async () => {
  const { book, diagnostics } = await load('C;r3;c2;K7;E1+\n', "Gnumeric_oleo:oleo");
  expect(book.sheets[0]!.cells).toEqual([{ row: 2, column: 1, value: { kind: "number", value: 7 } }]);
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toBe('Invalid expression "1+" at Sheet1!B3.');
});

it("Oleo simple values retain dates, percentages, currency and leading apostrophes as strings", async () => {
  const { book } = await load('C;r1;c1;K2024-02-03\nC;c2;K12%\nC;c3;K$5\nC;c4;K\'literal\nC;c5;K\n', "Gnumeric_oleo:oleo");
  expect(book.sheets[0]!.cells).toEqual(["2024-02-03", "12%", "$5", "'literal", ""].map((value, column) =>
    ({ row: 0, column, value: { kind: "string", value } })));
});

it("Oleo stores supported alignment in Gnumeric style metadata", async () => {
  const { book } = await load('Fr1c1R\nC;K7\n', "Gnumeric_oleo:oleo");
  expect(book.sheets[0]!.cells[0]!.style?.gnumeric).toMatchObject({ name: "Style", attributes: [
    { name: "HAlign", namespace: "", value: "4" }
  ] });
});

it("Oleo format precision requires an initial digit while coordinate scans allow spaces", async () => {
  const { book } = await load('Fr 2c 3FF+2\nC;K7\n', "Gnumeric_oleo:oleo");
  expect(book.sheets[0]!.cells[0]).toMatchObject({ row: 1, column: 2, format: "0", value: { kind: "number", value: 7 } });
});

it("Oleo preserves simple boolean/error values, decimal exponents and hexadecimal text", async () => {
  const { book } = await load('C;r1;c1;Ktrue\nC;c2;K#DIV/0!\nC;c3;K -2.5e+1 \nC;c4;K0x1p2\nC;c5;K1e-320\n', "Gnumeric_oleo:oleo");
  expect(book.sheets[0]!.cells).toEqual([
    { row: 0, column: 0, value: { kind: "boolean", value: true } },
    { row: 0, column: 1, value: { kind: "error", value: "#DIV/0!" } },
    { row: 0, column: 2, value: { kind: "number", value: -25 } },
    { row: 0, column: 3, value: { kind: "string", value: "0x1p2" } },
    { row: 0, column: 4, value: { kind: "number", value: 1e-320 } }
  ]);
});

it("Applix missing active cell retains the released native parse failure", async () => {
  await expect(load(applixSource('(G0||) A!A1: 7\n', ""), "Gnumeric_applix:applix"))
    .rejects.toThrow("E Parse error while reading Applix file.\n  E Invalid sheet name.");
});

it("Applix quoted expression caches preserve released native byte mutation", async () => {
  const records = String.raw`('G0||) A!A1; "a\"b"  ="value"` + '\nFormula: q\n';
  const { book } = await load(applixSource(records), "Gnumeric_applix:applix");
  expect(book.sheets[0]!.cells[0]).toMatchObject({
    cachedResult: { kind: "string", value: 'b\\"b' }, formulaDirty: false
  });
});

it("Applix color map requires the native terminal space", async () => {
  const source = applixSource('(G0||) A!A1: 7\n');
  const colorMap = (space: string) => source.replace("Headers And Footers\n",
    `COLORMAP\nblack 0 0 0 0 0 0${space}\nEND COLORMAP\nHeaders And Footers\n`);
  await expect(load(colorMap(""), "Gnumeric_applix:applix")).rejects.toThrow("E invalid colormap");
  const { book } = await load(colorMap(" "), "Gnumeric_applix:applix");
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});

it("Applix descriptor caching preserves the first native protection flags", async () => {
  const { book } = await load(applixSource('P (G0||) A!A1: 1\n(G0||) A!B1: 2\n'), "Gnumeric_applix:applix");
  expect(book.sheets[0]!.cells.map(c => c.style?.Locked)).toEqual([true, true]);
});

it("SC source directives remain data and native successful imports suppress warnings", async () => {
  const { book, diagnostics } = await load('# original SC fixture\nexec "touch /owned"\nsystem "$(false)"\nlet A0 = 3\n', "Gnumeric_sc:sc");
  expect(book.sheets[0]!.cells).toEqual([{ row: 0, column: 0, value: { kind: "number", value: 3 } }]);
  expect(diagnostics).toEqual([]);
});

it("SC strips backslashes from labels and retains prior values after invalid expressions", async () => {
  const { book, diagnostics } = await load('rightstring A0 = "a\\\\b\\"c"\nlet B0 = 7\nlet B0 = 1+\n', "Gnumeric_sc:sc");
  expect(book.sheets[0]!.cells).toEqual([
    { row: 0, column: 0, value: { kind: "string", value: 'ab"c' }, style: { HAlign: 4,
      gnumeric: { name: "Style", namespace: "http://www.gnumeric.org/v10.dtd", text: "", children: [],
        attributes: [{ name: "HAlign", namespace: "", value: "4" }] } } },
    { row: 0, column: 1, value: { kind: "number", value: 7 } }
  ]);
  expect(diagnostics).toEqual([]);
});

it("SC rejects column formats when a numeric field stops before the next conversion", async () => {
  const { book, diagnostics } = await load('format A 20x 2 0\nlet A0 = 3\n', "Gnumeric_sc:sc");
  expect(book.sheets[0]!.columns).toEqual([]);
  expect(diagnostics).toEqual([]);
});

it("SC format integer scanning follows native octal and hexadecimal field boundaries", async () => {
  const { book } = await load('format A 08 2 0\nformat B 0x10 01 0\nlet A0 = 3\n', "Gnumeric_sc:sc");
  expect(book.sheets[0]!.columns).toEqual([
    { index: 0, style: { Format: "##0.00000000E+00" } },
    { index: 1, sizePoints: 93.5, style: { Format: "#.0" } }
  ]);
});

it("SC retains reference names, zero-based coordinates and dimension growth", async () => {
  const { book } = await load('define "Target" $A$0\nlet Target = 5\nlet IZ65536 = @pow(A0,2)\n', "Gnumeric_sc:sc");
  expect(book.names).toEqual([{ name: "Target", expression: "=$A$1", sheet: "SC" }]);
  expect(book.sheets[0]).toMatchObject({ size: { rows: 131072, columns: 512 }, cells: [
    { row: 0, column: 0, value: { kind: "number", value: 5 } },
    { row: 65536, column: 259, formula: "=power(A1,2)", formulaDirty: true }
  ] });
});

it("SC preserves native case-sensitive named target lookup", async () => {
  await expect(load('define "Target" $B$1\nlet target = 5\n', "Gnumeric_sc:sc"))
    .rejects.toThrow("W On worksheet SC:\n  W Cannot parse let target = 5\n");
});

it("SC fatal import renders all accumulated warnings in source order exactly once", async () => {
  const diagnostics: string[] = [];
  const engine = createEngine({ codecs: [], limits, environment });
  try {
    await expect(engine.readWorkbook({ kind: "stream", source: [new TextEncoder().encode('exec "touch /owned"\nlet ??? = 3\n')] },
      { importType: "Gnumeric_sc:sc" }, { signal: new AbortController().signal,
        async diagnostic(value) { diagnostics.push(value.message); } }))
      .rejects.toThrow("W On worksheet SC:\n  W Unhandled directive: 'exec'\n  W Cannot parse let ??? = 3\n");
    expect(diagnostics).toEqual([]);
  } finally { await engine.dispose(); }
});

it("SC command diagnostics and failure status match native without creating output", async () => {
  const volume = Volume.fromJSON({ "/in.sc": "let ??? = 3\n", "/keep": "untouched" });
  const engine = createEngine({ codecs: [], limits, environment, filesystem: {
    async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
    async write(uri, bytes) { volume.writeFileSync(uri, bytes); }
  } });
  let stderr = "";
  try {
    expect(await runCommand(["-I", "Gnumeric_sc:sc", "-T", "Gnumeric_stf:stf_csv", "/in.sc", "/out.csv"], engine,
      { signal: new AbortController().signal, stdout: { async write() { throw new Error("unexpected stdout"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } })).toEqual({ exitCode: 1 });
    expect(stderr).toBe("W On worksheet SC:\n  W Cannot parse let ??? = 3\n\n");
    expect(volume.toJSON()).toEqual({ "/in.sc": "let ??? = 3\n", "/keep": "untouched" });
  } finally { await engine.dispose(); }
});

it("SC treats precision minus one as native missing precision when formatting", async () => {
  await expect(load('format A 10 -1 0\nlet ??? = 3\n', "Gnumeric_sc:sc"))
    .rejects.toThrow("W On worksheet SC:\n  W Encountered precision-dependent format without set precision.\n  W Cannot parse let ??? = 3\n");
});

it.each(["Gnumeric_oleo:oleo", "Gnumeric_sc:sc", "Gnumeric_applix:applix"])("%s rejects an already cancelled import", async id => {
  const controller = new AbortController(); controller.abort(new Error("cancelled before source read"));
  const engine = createEngine({ codecs: [], limits, environment });
  try {
    await expect(engine.readWorkbook({ kind: "stream", source: [new Uint8Array()] }, { importType: id },
      { signal: controller.signal })).rejects.toThrow("cancelled before source read");
  } finally { await engine.dispose(); }
});

it("SC bounds precision expansion before allocation", async () => {
  const engine = createEngine({ codecs: [], limits: { ...limits, inputBytes: 100 }, environment });
  try {
    await expect(engine.readWorkbook({ kind: "stream", source: [new TextEncoder().encode('format A 10 101 0\n')] },
      { importType: "Gnumeric_sc:sc" }, { signal: new AbortController().signal }))
      .rejects.toThrow("ssconvert SC precision limit exceeded");
  } finally { await engine.dispose(); }
});

it("SC column formats affect preserved text output and survive workbook style metadata", async () => {
  const text = 'format A 10 2 0\nlet A0 = 1.5\nrightstring B0 = "text"\n';
  const engine = createEngine({ codecs: [], limits, environment });
  try {
    let output = "";
    const result = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode(text)] },
      importType: "Gnumeric_sc:sc", exportType: "Gnumeric_stf:stf_assistant", exportOptions: ["format=preserve"],
      destination: { kind: "stream", sink: { async write(bytes) { output += new TextDecoder().decode(bytes); } } } },
    { signal: new AbortController().signal });
    expect(result.exitCode).toBe(0);
    expect(output).toBe("1.50,text\n");
    const { book } = await load(text, "Gnumeric_sc:sc");
    expect(book.sheets[0]!.cells[1]!.style?.gnumeric).toMatchObject({ attributes: [
      { name: "HAlign", namespace: "", value: "4" }
    ] });
  } finally { await engine.dispose(); }
});

it("SC widths use the frozen native Sans font pixel metrics", async () => {
  const { book } = await load('format A 1 2 0\nformat B 10 2 0\nformat C 20 2 0\n', "Gnumeric_sc:sc");
  expect(book.sheets[0]!.columns!.map(c => c.sizePoints)).toEqual([8.5, 59.5, (20 * 8 + 4) * 17 / 24]);
});

it("SC retains full column styles, hard widths and cursor selection with dimension growth", async () => {
  const { book } = await load('format ZZ 10 2 0\ngoto B2\n', "Gnumeric_sc:sc");
  expect(book.sheets[0]!.size).toEqual({ rows: 65536, columns: 1024 });
  expect(book.sheets[0]!.unsupportedRecords).toMatchObject([
    { source: "Gnumeric_XmlIO:sax", kind: "Styles", data: { children: [{ name: "StyleRegion", attributes: [
      { name: "startRow", namespace: "", value: "0" }, { name: "endRow", namespace: "", value: "65535" },
      { name: "startCol", namespace: "", value: "701" }, { name: "endCol", namespace: "", value: "701" }
    ] }] } },
    { source: "Gnumeric_XmlIO:sax", kind: "Cols", data: { children: [{ name: "ColInfo", attributes: [
      { name: "No", namespace: "", value: "701" }, { name: "HardSize", namespace: "", value: "1" }
    ] }] } },
    { source: "Gnumeric_XmlIO:sax", kind: "Selections", data: { attributes: [
      { name: "CursorCol", namespace: "", value: "1" }, { name: "CursorRow", namespace: "", value: "2" }
    ] } }
  ]);
});

it("SC zero width does not enlarge the sheet or retain out-of-bounds column styles", async () => {
  const { book } = await load('format ZZ 0 2 0\nlet A0 = 1.5\n', "Gnumeric_sc:sc");
  expect(book.sheets[0]!.size).toEqual({ rows: 65536, columns: 256 });
  expect(book.sheets[0]!.columns).toEqual([]);
  expect(book.sheets[0]!.cells).toEqual([{ row: 0, column: 0, value: { kind: "number", value: 1.5 } }]);
});
