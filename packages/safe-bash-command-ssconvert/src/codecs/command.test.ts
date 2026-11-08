import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, type Codec } from "../index.js";

function fixture(codecs: readonly Codec[]) {
  const volume = Volume.fromJSON({ "/misleading.xlsx": "ODF", "/destination.xlsx": "keep" });
  const signal = new AbortController().signal;
  const engine = createEngine({ codecs,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 50, outputBytes: 50, sheets: 1, cells: 1, operations: 10 },
    filesystem: {
      async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); }
    }
  });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const operation = { signal, stdout: { async write(bytes: Uint8Array) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(new Uint8Array(bytes)); } } };
  return { engine, volume, operation, stdout, stderr };
}
const text = (chunks: Uint8Array[]) => chunks.map((bytes) => new TextDecoder().decode(bytes)).join("");
const read: NonNullable<Codec["read"]> = async () => ({ sheets: [{ id: "s", name: "s", cells: [] }] });
const write: NonNullable<Codec["write"]> = async () => new TextEncoder().encode("converted");

it.each([
  [["-T", "missing", "-I", "missing", "/absent", "/destination.xlsx"], 1, "Unknown exporter 'missing'.\nTry --list-exporters to see a list of possibilities.\n"],
  [["-I", "missing", "/absent", "/destination.xlsx"], 1, "Unknown importer 'missing'.\nTry --list-importers to see a list of possibilities.\n"],
  [["/absent", "/destination.unknown"], 2, "Unable to guess exporter to use for 'file:///destination.unknown'.\nTry --list-exporters to see a list of possibilities.\n"]
] as const)("rejects selection %j with native status before reading input", async (argv, exitCode, message) => {
  const { engine, operation, volume, stdout, stderr } = fixture([
    { id: "fixture", description: "Fixture", extensions: ["xlsx"], read, write }
  ]);
  try {
    expect(await runCommand(argv, engine, operation)).toEqual({ exitCode });
    expect(text(stderr)).toBe(message);
    expect(stdout).toEqual([]);
    expect(volume.readFileSync("/destination.xlsx", "utf8")).toBe("keep");
    expect(Object.keys(volume.toJSON()).sort()).toEqual(["/destination.xlsx", "/misleading.xlsx"]);
  } finally { await engine.dispose(); }
});

it("prints sorted installed noninteractive importer/saver IDs to stderr with native widths", async () => {
  const { engine, operation, stdout, stderr, volume } = fixture([
    { id: "z", description: "Z", extensions: [], read },
    { id: "alpha", description: "Alpha", extensions: [], write },
    { id: "hidden", description: "Hidden", extensions: [], read, interactiveOnly: true }
  ]);
  try {
    expect(await runCommand(["--list-importers"], engine, operation)).toEqual({ exitCode: 0 });
    expect(text(stderr)).toBe("ID                           | Description\nGnumeric_Excel:excel         | MS Excel? (*.xls)\nGnumeric_Excel:excel_enc     | MS Excel? (*.xls) requiring encoding specification\nGnumeric_Excel:excel_xml     | MS Excel? 2003 SpreadsheetML\nGnumeric_Excel:xlsx          | ECMA 376 / Office Open XML [MS Excel? 2007/2010] (*.xlsx)\nGnumeric_OpenCalc:openoffice | Open Document Format (*.sxc, *.ods)\nGnumeric_QPro:qpro           | Quattro Pro (*.wb1, *.wb2, *.wb3)\nGnumeric_XmlIO:sax           | Gnumeric XML (*.gnumeric)\nGnumeric_applix:applix       | Applix (*.as)\nGnumeric_dif:dif             | Data Interchange Format (*.dif)\nGnumeric_html:html           | HTML (*.html, *.htm)\nGnumeric_lotus:lotus         | Lotus 123 (*.wk1, *.wks, *.123)\nGnumeric_mps:mps             | Linear and integer program (*.mps) file format\nGnumeric_oleo:oleo           | GNU Oleo (*.oleo)\nGnumeric_paradox:paradox     | Paradox database or primary index file (*.db, *.px)\nGnumeric_plan_perfect:pln    | Plan Perfect Format (PLN) import\nGnumeric_psiconv:psiconv     | Psion (*.psisheet)\nGnumeric_sc:sc               | SC/xspread\nGnumeric_stf:stf_csvtab      | Comma or tab separated values (CSV/TSV)\nGnumeric_sylk:sylk           | MultiPlan (SYLK)\nGnumeric_xbase:xbase         | Xbase (*.dbf) file format\nz                            | Z\n");
    stderr.length = 0;
    expect(await runCommand(["--list-exporters"], engine, operation)).toEqual({ exitCode: 0 });
    expect(text(stderr)).toBe("ID                                | Description\nGnumeric_Excel:excel_biff7        | MS Excel? 5.0/95\nGnumeric_Excel:excel_biff8        | MS Excel? 97/2000/XP\nGnumeric_Excel:excel_dsf          | MS Excel? 97/2000/XP & 5.0/95\nGnumeric_Excel:xlsx               | ECMA 376 1st edition (2006); [MS Excel? 2007]\nGnumeric_Excel:xlsx2              | ISO/IEC 29500:2008 & ECMA 376 2nd edition (2008); [MS Excel? 2010]\nGnumeric_GnomeGlossary:po         | Gnome Glossary PO file format\nGnumeric_OpenCalc:odf             | ODF 1.2 extended conformance (*.ods)\nGnumeric_OpenCalc:openoffice      | ODF 1.2 strict conformance (*.ods)\nGnumeric_XmlIO:sax                | Gnumeric XML (*.gnumeric)\nGnumeric_XmlIO:sax:0              | Gnumeric XML uncompressed (*.xml)\nGnumeric_dif:dif                  | Data Interchange Format (*.dif)\nGnumeric_glpk:glpk                | GLPK Linear Program Solver\nGnumeric_html:html32              | HTML 3.2 (*.html)\nGnumeric_html:html40              | HTML 4.0 (*.html)\nGnumeric_html:html40frag          | HTML (*.html) fragment\nGnumeric_html:latex               | LaTeX 2e (*.tex)\nGnumeric_html:latex_table         | LaTeX 2e (*.tex) table fragment\nGnumeric_html:latex_table_visible | LaTeX 2e (*.tex) table fragment of visible rows\nGnumeric_html:roff                | TROFF (*.me)\nGnumeric_html:xhtml               | XHTML (*.html)\nGnumeric_html:xhtml_range         | XHTML range - for export to clipboard\nGnumeric_lpsolve:lpsolve          | LPSolve Linear Program Solver\nGnumeric_paradox:paradox          | Paradox database (*.db)\nGnumeric_pdf:pdf_assistant        | PDF export\nGnumeric_stf:stf_assistant        | Text (configurable)\nGnumeric_stf:stf_csv              | Comma separated values (CSV)\nGnumeric_sylk:sylk                | MultiPlan (SYLK)\nalpha                             | Alpha\n");
    expect(stdout).toEqual([]);
    expect(Object.keys(volume.toJSON()).sort()).toEqual(["/destination.xlsx", "/misleading.xlsx"]);
  } finally { await engine.dispose(); }
});

it("matches captured C-locale listing bytes while preserving Unicode SDK descriptions", async () => {
  const { engine, operation, stderr } = fixture([
    { id: "Gnumeric_Excel:xlsx", description: "Injected fixture", extensions: [], read }
  ]);
  try {
    expect(engine.listServices("read")[3]!.description).toBe("ECMA 376 / Office Open XML [MS Excel™ 2007/2010] (*.xlsx)");
    expect(await runCommand(["--list-importers"], engine, operation)).toEqual({ exitCode: 0 });
    expect(text(stderr)).toBe("ID                           | Description\nGnumeric_Excel:excel         | MS Excel? (*.xls)\nGnumeric_Excel:excel_enc     | MS Excel? (*.xls) requiring encoding specification\nGnumeric_Excel:excel_xml     | MS Excel? 2003 SpreadsheetML\nGnumeric_Excel:xlsx          | ECMA 376 / Office Open XML [MS Excel? 2007/2010] (*.xlsx)\nGnumeric_OpenCalc:openoffice | Open Document Format (*.sxc, *.ods)\nGnumeric_QPro:qpro           | Quattro Pro (*.wb1, *.wb2, *.wb3)\nGnumeric_XmlIO:sax           | Gnumeric XML (*.gnumeric)\nGnumeric_applix:applix       | Applix (*.as)\nGnumeric_dif:dif             | Data Interchange Format (*.dif)\nGnumeric_html:html           | HTML (*.html, *.htm)\nGnumeric_lotus:lotus         | Lotus 123 (*.wk1, *.wks, *.123)\nGnumeric_mps:mps             | Linear and integer program (*.mps) file format\nGnumeric_oleo:oleo           | GNU Oleo (*.oleo)\nGnumeric_paradox:paradox     | Paradox database or primary index file (*.db, *.px)\nGnumeric_plan_perfect:pln    | Plan Perfect Format (PLN) import\nGnumeric_psiconv:psiconv     | Psion (*.psisheet)\nGnumeric_sc:sc               | SC/xspread\nGnumeric_stf:stf_csvtab      | Comma or tab separated values (CSV/TSV)\nGnumeric_sylk:sylk           | MultiPlan (SYLK)\nGnumeric_xbase:xbase         | Xbase (*.dbf) file format\n");
    stderr.length = 0;
    expect(await runCommand(["--list-importers"], engine, operation,
      { help: "", version: "", listingEncoding: "utf8" })).toEqual({ exitCode: 0 });
    expect(text(stderr)).toBe("ID                           | Description\nGnumeric_Excel:excel         | MS Excel™ (*.xls)\nGnumeric_Excel:excel_enc     | MS Excel™ (*.xls) requiring encoding specification\nGnumeric_Excel:excel_xml     | MS Excel™ 2003 SpreadsheetML\nGnumeric_Excel:xlsx          | ECMA 376 / Office Open XML [MS Excel™ 2007/2010] (*.xlsx)\nGnumeric_OpenCalc:openoffice | Open Document Format (*.sxc, *.ods)\nGnumeric_QPro:qpro           | Quattro Pro (*.wb1, *.wb2, *.wb3)\nGnumeric_XmlIO:sax           | Gnumeric XML (*.gnumeric)\nGnumeric_applix:applix       | Applix (*.as)\nGnumeric_dif:dif             | Data Interchange Format (*.dif)\nGnumeric_html:html           | HTML (*.html, *.htm)\nGnumeric_lotus:lotus         | Lotus 123 (*.wk1, *.wks, *.123)\nGnumeric_mps:mps             | Linear and integer program (*.mps) file format\nGnumeric_oleo:oleo           | GNU Oleo (*.oleo)\nGnumeric_paradox:paradox     | Paradox database or primary index file (*.db, *.px)\nGnumeric_plan_perfect:pln    | Plan Perfect Format (PLN) import\nGnumeric_psiconv:psiconv     | Psion (*.psisheet)\nGnumeric_sc:sc               | SC/xspread\nGnumeric_stf:stf_csvtab      | Comma or tab separated values (CSV/TSV)\nGnumeric_sylk:sylk           | MultiPlan (SYLK)\nGnumeric_xbase:xbase         | Xbase (*.dbf) file format\n");
  } finally { await engine.dispose(); }
});

it("shares content discovery and forced overrides between CLI and SDK", async () => {
  const events: string[] = [];
  const codecs: Codec[] = [
    { id: "xlsx", description: "XLSX fixture", extensions: ["xlsx"], read,
      probeName: () => true, probeContent: () => false },
    { id: "ods", description: "ODS fixture", extensions: ["ods"],
      probeContent: (bytes) => new TextDecoder().decode(bytes) === "ODF",
      async read(bytes) { events.push(`ods:${new TextDecoder().decode(bytes)}`); return read(bytes, {} as never); } },
    { id: "xlsx-saver", description: "XLSX saver", extensions: ["xlsx"], write },
    { id: "forced-saver", description: "Forced saver", extensions: ["other"],
      async exportOptions(options) { events.push(...options); return ["handled"]; },
      async write(_book, options) { events.push(...options); return new TextEncoder().encode("forced"); } }
  ];
  const { engine, operation, volume } = fixture(codecs);
  try {
    expect((await runCommand(["/misleading.xlsx", "/destination.xlsx"], engine, operation)).exitCode).toBe(0);
    expect(events).toEqual(["ods:ODF"]);
    expect(volume.readFileSync("/destination.xlsx", "utf8")).toBe("converted");
    events.length = 0;
    const sdk = await engine.convert({ input: { kind: "resource", uri: "/misleading.xlsx" },
      destination: { kind: "resource", uri: "/destination.xlsx" } }, operation);
    expect(sdk.exitCode).toBe(0);
    expect(events).toEqual(["ods:ODF"]);
    events.length = 0;
    expect((await runCommand(["-I", "xlsx", "-T", "forced-saver", "-O", "raw", "/misleading.xlsx", "/destination.xlsx"], engine, operation)).exitCode).toBe(0);
    expect(events).toEqual(["raw", "handled"]);
    expect(volume.readFileSync("/destination.xlsx", "utf8")).toBe("forced");
  } finally { await engine.dispose(); }
});

it("keeps destination and namespace unchanged when no content probe validates", async () => {
  const { engine, operation, volume, stderr } = fixture([
    { id: "xlsx", description: "Fixture", extensions: ["xlsx"], read, write, probeContent: () => false }
  ]);
  volume.writeFileSync("/misleading.xlsx", new Uint8Array([1]));
  try {
    expect(await runCommand(["/misleading.xlsx", "/destination.xlsx"], engine, operation)).toEqual({ exitCode: 1 });
    expect(text(stderr)).toBe('E Unsupported file format for file "misleading.xlsx"\n');
    expect(volume.readFileSync("/destination.xlsx", "utf8")).toBe("keep");
    expect(Object.keys(volume.toJSON()).sort()).toEqual(["/destination.xlsx", "/misleading.xlsx"]);
  } finally { await engine.dispose(); }
});
