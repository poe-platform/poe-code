import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { runCommand } from "../index.js";
import { readSylk, writeSylk } from "./sylk.js";
import type { CapabilityContext } from "../contracts.js";

function fixture(text: string | Uint8Array, filename = "/original.csv") {
  const volume = new Volume();
  volume.writeFileSync(filename, text);
  const engine = createEngine({ codecs: [],
    clock: { now: () => Date.UTC(2026, 8, 20) },
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 2, operations: 1000 },
    filesystem: { async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); } } });
  return { engine, volume, read: (options = {}) => engine.readWorkbook({ kind: "resource", uri: filename }, options,
    { signal: new AbortController().signal }) };
}

it.each(["\n", "\r\n", "\r"])("remembers unique input ending %j only for configurable export", async ending => {
  const f = fixture(["a,b", "1,2", "3,4", ""].join(ending));
  try {
    for (const [type, options, separator, outputEnding] of [
      ["stf_assistant", undefined, ",", ending],
      ["stf_assistant", "separator=|", "|", ending],
      ["stf_csv", undefined, ",", "\n"],
      ["stf_assistant", "eol=unix", ",", "\n"],
      ["stf_assistant", "eol=windows", ",", "\r\n"],
      ["stf_assistant", "eol=mac", ",", "\r"]
    ] as const) {
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const result = await runCommand(["-T", `Gnumeric_stf:${type}`,
        ...(options === undefined ? [] : ["-O", options]), "/original.csv", "/output"], f.engine,
      { signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(bytes); } },
        stderr: { async write(bytes) { stderr.push(bytes); } } });
      expect(result.exitCode).toBe(0);
      expect(stdout).toEqual([]);
      expect(stderr).toEqual([]);
      expect(f.volume.readFileSync("/output", "utf8")).toBe(
        ["a" + separator + "b", "1" + separator + "2", "3" + separator + "4", ""].join(outputEnding));
    }
  } finally { await f.engine.dispose(); }
});

it.each(["a,b", "a,b\r\n1,2\n3,4\r\n", "a,b\r1,2\n3,4\r"])(
  "does not remember an absent or mixed input terminator in %j", async input => {
    const f = fixture(input);
    try { expect((await f.read()).textExportEol).toBeUndefined(); }
    finally { await f.engine.dispose(); }
  });

it.each(["12:34:56", "1/2/2025"])("exports value-inferred CSV format as SYLK General for %s while retaining explicit formats", async input => {
  const book = await fixture(input + "\n").read();
  const cell = book.sheets[0]!.cells[0]!;
  expect(cell.format).toBeDefined();
  const context: CapabilityContext = { signal: new AbortController().signal, own() {},
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 2, operations: 1000 } };
  const output = new TextDecoder().decode(await writeSylk(book, [], context));
  expect(output).toContain("P;PGeneral\r\n");
  expect(output).not.toContain(`P;P${cell.format}\r\n`);
  expect((await readSylk(new TextEncoder().encode(output), context)).sheets[0]!.cells[0]!.value).toEqual(cell.value);
  const explicit = { ...book, sheets: [{ ...book.sheets[0]!, cells: [{ ...cell, format: "0.000" }] }] };
  expect(new TextDecoder().decode(await writeSylk(explicit, [], context))).toContain("P;P0.000\r\n");
  const authored = { ...book, sheets: [{ ...book.sheets[0]!, cells: [{ row: 0, column: 0, value: cell.value, format: cell.format! }] }] };
  expect(new TextDecoder().decode(await writeSylk(authored, [], context))).toContain(`P;P${cell.format}\r\n`);
});

it("preserves column-inferred ISO date styles in SYLK", async () => {
  const book = await fixture("2025-01-02\n").read();
  const context: CapabilityContext = { signal: new AbortController().signal, own() {},
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 2, operations: 1000 } };
  expect(new TextDecoder().decode(await writeSylk(book, [], context))).toContain("P;Pyyyy-mm-dd\r\n");
});

it("imports multiline CSV and tolerates garbage after closing quotes and missing quotes", async () => {
  const f = fixture('name,value\r\n"a\r\nb"junk,2\r\n"c""d",3\r\n"unfinished');
  const book = await f.read();
  expect(book.sheets[0]!.cells.map(c => [c.row, c.column, c.value])).toEqual([
    [0, 0, { kind: "string", value: "name" }], [0, 1, { kind: "string", value: "value" }],
    [1, 0, { kind: "string", value: "a\r\nb" }], [1, 1, { kind: "number", value: 2 }],
    [2, 0, { kind: "string", value: 'c"d' }], [2, 1, { kind: "number", value: 3 }],
    [3, 0, { kind: "string", value: "unfinished" }]
  ]);
});

it("accepts empty text names but rejects unnamed empty streams", async () => {
  const f = fixture("");
  expect((await f.read()).sheets[0]!.cells).toEqual([]);
  await expect(f.engine.readWorkbook({ kind: "stream", source: [] }, {},
    { signal: new AbortController().signal })).rejects.toThrow("Unsupported file format");
});

it("uses general TSV trimming while preserving CSV whitespace and blank row positions", async () => {
  expect((await fixture('  a \t 2 \n\n b\t3\n', "/original.tsv").read()).sheets[0]!.cells.map(c => [c.row, c.value]))
    .toEqual([[0, { kind: "string", value: "a" }], [0, { kind: "number", value: 2 }],
      [2, { kind: "string", value: "b" }], [2, { kind: "number", value: 3 }]]);
  expect((await fixture(' a ,\n').read()).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: " a " });
});

it("infers dates across a column and decimal precision excluding the header", async () => {
  const book = await fixture('date,amount\n31/12/2020,1.20\n1/2/2020,2.30\n').read();
  expect(book.sheets[0]!.cells.slice(2)).toMatchObject([
    { value: { kind: "number", value: 44196 }, format: "d-mmm-yyyy" },
    { value: { kind: "number", value: 1.2 }, format: "0.00" },
    { value: { kind: "number", value: 43862 }, format: "d-mmm-yyyy" },
    { value: { kind: "number", value: 2.3 }, format: "0.00" }
  ]);
});

it("keeps literal introducers and invalid names while calculating accepted formulas", async () => {
  const cells = (await fixture("h\n'=1\n=1+2\n=unknown\n+1+2\n@SUM(1)\n true \nTRUE\n").read()).sheets[0]!.cells;
  expect(cells.map(c => c.value)).toEqual([
    { kind: "string", value: "h" }, { kind: "string", value: "=1" }, { kind: "number", value: 3 },
    { kind: "string", value: "=unknown" }, { kind: "string", value: "+1+2" },
    { kind: "string", value: "@SUM(1)" }, { kind: "string", value: " true " }, { kind: "boolean", value: true }
  ]);
});

it("rejects explicit assistant import with the native GUI-only diagnostic", async () => {
  const f = fixture("1,2");
  await expect(f.read({ importType: "Gnumeric_stf:stf_assistant" })).rejects.toThrow("E This importer can only be used with a GUI.");
  expect(f.engine.listServices("read").map(s => s.id)).toEqual(["Gnumeric_Excel:excel", "Gnumeric_Excel:excel_enc", "Gnumeric_Excel:excel_xml", "Gnumeric_Excel:xlsx", "Gnumeric_OpenCalc:openoffice", "Gnumeric_QPro:qpro", "Gnumeric_XmlIO:sax", "Gnumeric_applix:applix", "Gnumeric_dif:dif", "Gnumeric_html:html", "Gnumeric_lotus:lotus", "Gnumeric_mps:mps", "Gnumeric_oleo:oleo", "Gnumeric_paradox:paradox", "Gnumeric_plan_perfect:pln", "Gnumeric_psiconv:psiconv", "Gnumeric_sc:sc", "Gnumeric_stf:stf_csvtab", "Gnumeric_sylk:sylk", "Gnumeric_xbase:xbase"]);
});

it.each([
  ["1,2", 1.2], ["0,123", .123], ["1.234,56", 1234.56], ["(12)", -12], ["12-", -12],
  ["1/2/20", 43832], ["31-Dec-2020", 44196], ["January 2, 2020", 43832],
  ["12:30", 12.5 / 24], ["25:30:00", 1.0625], ["1 1/2", 1.5], ["١٢", 12], ["−12", -12], ["1.2.3", 37623], ["1/2", 46024]
] as const)("matches measured native scalar %s", async (text, number) => {
  const cells = (await fixture('h\n"' + text + '"\n').read()).sheets[0]!.cells;
  expect(cells[1]!.value).toEqual({ kind: "number", value: number });
});

it.each(["#N/A", "#DIV/0!"])("imports measured native error %s", async text => {
  expect((await fixture("h\n" + text + "\n").read()).sheets[0]!.cells[1]!.value).toEqual({ kind: "error", value: text });
});

it("preserves invalid grouped numbers as strings", async () => {
  expect((await fixture('h\n"1,2,3"\n').read()).sheets[0]!.cells[1]!.value).toEqual({ kind: "string", value: "1,2,3" });
});

it("evaluates references in long rows after expanding the native sheet size", async () => {
  const text = ["=KN1", ...Array<string>(298).fill(""), "7"].join(",");
  expect((await fixture(text).read()).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});
