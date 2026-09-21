import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, SsconvertError, type Codec, type Engine } from "../index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
function fixture(codecs: readonly Codec[] = [], sinkError?: unknown) {
  const volume = Volume.fromJSON({ "/in.fixture": "original" });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const codec: Codec = {
    id: "fixture", description: "Original fixture", extensions: ["fixture"],
    probeContent: () => true,
    async read() { return { sheets: [{ id: "s", name: "Sheet1", cells: [] }] }; },
    async write() { return new Uint8Array([0, 255, 10]); }
  };
  const engine = createEngine({
    codecs: [codec, ...codecs],
    limits: { inputBytes: 100, outputBytes: 1000, cells: 100, sheets: 10, operations: 10 },
    environment: { env: {}, locale: "C", timezone: "UTC" },
    filesystem: {
      async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); }
    }
  });
  const operation = {
    signal: new AbortController().signal,
    stdout: { async write(bytes: Uint8Array) { if (sinkError) throw sinkError; stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(new Uint8Array(bytes)); } }
  };
  return { engine, volume, operation, stdout, stderr, errors: () => stderr.map(decode).join("") };
}

describe("listing and diagnostic byte channels", () => {
  it("matches the captured image enum order on stderr", async () => {
    const f = fixture();
    expect(await runCommand(["--list-image-formats"], f.engine, f.operation)).toEqual({ exitCode: 0 });
    expect(f.stdout).toEqual([]);
    expect(f.errors()).toBe("ID   | Description\nsvg  | SVG (vector graphics)\npng  | PNG (raster graphics)\njpeg | JPEG (photograph)\npdf  | PDF (portable document format)\nps   | PS (postscript)\nemf  | EMF (extended metafile)\nwmf  | WMF (windows metafile)\neps  | EPS (encapsulated postscript)\n");
  });
  it("sorts UTF-8 ID bytes and excludes interactive entries before computing width", async () => {
    const f = fixture(["\u{10000}", "\ue000", "é", "A"].map<Codec>(id => ({ id, description: id, extensions: [], async write() { return encode(""); } })).concat([
      { id: "interactive-long-name", description: "hidden", extensions: [], interactiveOnly: true, async write() { return encode(""); } }
    ]));
    await runCommand(["--list-exporters"], f.engine, f.operation, { listingEncoding: "utf8" });
    expect(f.errors()).toBe("ID                                | Description\nA                                 | A\nGnumeric_Excel:excel_biff7        | MS Excel™ 5.0/95\nGnumeric_Excel:excel_biff8        | MS Excel™ 97/2000/XP\nGnumeric_Excel:excel_dsf          | MS Excel™ 97/2000/XP & 5.0/95\nGnumeric_Excel:xlsx               | ECMA 376 1st edition (2006); [MS Excel™ 2007]\nGnumeric_Excel:xlsx2              | ISO/IEC 29500:2008 & ECMA 376 2nd edition (2008); [MS Excel™ 2010]\nGnumeric_GnomeGlossary:po         | Gnome Glossary PO file format\nGnumeric_OpenCalc:odf             | ODF 1.2 extended conformance (*.ods)\nGnumeric_OpenCalc:openoffice      | ODF 1.2 strict conformance (*.ods)\nGnumeric_XmlIO:sax                | Gnumeric XML (*.gnumeric)\nGnumeric_XmlIO:sax:0              | Gnumeric XML uncompressed (*.xml)\nGnumeric_dif:dif                  | Data Interchange Format (*.dif)\nGnumeric_glpk:glpk                | GLPK Linear Program Solver\nGnumeric_html:html32              | HTML 3.2 (*.html)\nGnumeric_html:html40              | HTML 4.0 (*.html)\nGnumeric_html:html40frag          | HTML (*.html) fragment\nGnumeric_html:latex               | LaTeX 2e (*.tex)\nGnumeric_html:latex_table         | LaTeX 2e (*.tex) table fragment\nGnumeric_html:latex_table_visible | LaTeX 2e (*.tex) table fragment of visible rows\nGnumeric_html:roff                | TROFF (*.me)\nGnumeric_html:xhtml               | XHTML (*.html)\nGnumeric_html:xhtml_range         | XHTML range - for export to clipboard\nGnumeric_lpsolve:lpsolve          | LPSolve Linear Program Solver\nGnumeric_paradox:paradox          | Paradox database (*.db)\nGnumeric_pdf:pdf_assistant        | PDF export\nGnumeric_stf:stf_assistant        | Text (configurable)\nGnumeric_stf:stf_csv              | Comma separated values (CSV)\nGnumeric_sylk:sylk                | MultiPlan (SYLK)\nfixture                           | Original fixture\né                                | é\n                               | \n𐀀                              | 𐀀\n");
  });
  it("writes inferred verbose selection before importer errors", async () => {
    const f = fixture();
    expect(await runCommand(["-v", "-I", "absent", "/in.fixture", "/out.fixture"], f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.errors()).toBe("Using exporter fixture\nUnknown importer 'absent'.\nTry --list-importers to see a list of possibilities.\n");
  });
  it("keeps stdout binary output byte exact for fd://1 without namespace effects", async () => {
    const f = fixture();
    expect(await runCommand(["-v", "-T", "fixture", "/in.fixture", "fd://1"], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
    expect(f.stdout).toEqual([new Uint8Array([0, 255, 10])]);
    expect(f.errors()).toBe("");
    expect(f.volume.toJSON()).toEqual({ "/in.fixture": "original" });
  });
  it("prints result warnings byte exactly without changing their exit status", async () => {
    const f = fixture();
    const engine: Engine = { ...f.engine, async convert() { return {
      exitCode: 7, diagnostics: [{ code: "fixture", severity: "warning", message: "display", bytes: new Uint8Array([87, 255, 10]) }],
      artifacts: [], usage: { inputBytes: 0, outputBytes: 0 }, profile: "gnumeric-1.12.61"
    }; } };
    expect(await runCommand(["/in.fixture", "/out.fixture"], engine, f.operation)).toMatchObject({ exitCode: 7 });
    expect(f.stderr).toEqual([new Uint8Array([87, 255, 10])]);
    expect(f.stdout).toEqual([]);
  });
  it("handles typed simulated output failure without a subprocess", async () => {
    const f = fixture([], new SsconvertError("io", "ssconvert: simulated sink failure", 3));
    expect(await runCommand(["-T", "fixture", "/in.fixture", "fd://1"], f.engine, f.operation)).toEqual({ exitCode: 3 });
    expect(f.errors()).toBe("ssconvert: simulated sink failure\n");
    expect(f.volume.toJSON()).toEqual({ "/in.fixture": "original" });
  });
  it("retains exporter-before-importer precedence and inference status 2", async () => {
    const f = fixture();
    expect(await runCommand(["-I", "absent", "/missing", "/out.unknown"], f.engine, f.operation)).toEqual({ exitCode: 2 });
    expect(f.errors()).toBe("Unable to guess exporter to use for 'file:///out.unknown'.\nTry --list-exporters to see a list of possibilities.\n");
  });
});

describe("native error stages", () => {
  it.each([
    [["--set=bad", "/in.fixture", "/out.fixture"], "Failed to set cell bad\n"],
    [["--export-range=bad", "/in.fixture", "/out.fixture"], "Invalid range specified.\n"],
    [["--goal-seek=bad", "/in.fixture", "/out.fixture"], "Invalid range specified.\n"],
    [["-S", "/in.fixture", "/out.fixture"], "Selected exporter (fixture) does not have the ability to split a workbook into sheets.\n"],
    [["-O", "sheet=Sheet1", "/in.fixture", "/out.fixture"], "Selected exporter (fixture) does not have the ability to export a subset of sheets.\n"],
    [["-O", "sheet=absent", "/in.fixture", "/out.fixture"], "ssconvert: Unknown sheet \"absent\"\n"],
    [["-O", "unknown=1", "/in.fixture", "/out.fixture"], "ssconvert: Invalid export option \"unknown\" for format fixture\n"],
    [["-O", "bad", "/in.fixture", "/out.fixture"], "ssconvert: Syntax error\n"],
    [["-O", "sheet='open", "/in.fixture", "/out.fixture"], "ssconvert: Quoted string not terminated\n"],
    [["/missing.fixture", "/out.fixture"], "E /missing.fixture: No such file or directory\n"]
  ] as const)("matches status and wording for %j without destination effects", async (argv, message) => {
    const f = fixture();
    expect(await runCommand(argv, f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.errors()).toBe(message);
    expect(f.stdout).toEqual([]);
    expect(f.volume.toJSON()).toEqual({ "/in.fixture": "original" });
  });
  it("reports no matching opener as an import diagnostic", async () => {
    const f = fixture();
    const engine = createEngine({ codecs: [{ id: "writer", description: "Writer", extensions: ["fixture"], async write() { return encode(""); } }],
      environment: { env: {}, locale: "C", timezone: "UTC" },
      limits: { inputBytes: 10, outputBytes: 10, cells: 10, sheets: 2, operations: 10 },
      filesystem: { async read() { return [new Uint8Array([1])]; }, async write() { throw new Error("must not publish"); } }
    });
    expect(await runCommand(["/in.fixture", "/out.fixture"], engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.errors()).toBe('E Unsupported file format for file "in.fixture"\n');
  });
});

describe("merge and diagnostic delivery", () => {
  it("dispatches SDK merge and prints unconditional merge notices on stderr", async () => {
    const f = fixture();
    const engine: Engine = { ...f.engine, async merge(request, operation) {
      expect(request.inputs).toEqual([{ kind: "resource", uri: "/one.fixture" }, { kind: "resource", uri: "/two.fixture" }]);
      expect(request.destination).toEqual({ kind: "stream", sink: f.operation.stdout });
      await operation.diagnostic?.({ code: "merge", severity: "warning", message: "Adding sheets from file:///one.fixture" });
      await operation.diagnostic?.({ code: "merge", severity: "warning", message: "Adding sheets from file:///two.fixture" });
      if (request.destination?.kind === "stream") await request.destination.sink.write(encode("original\n"));
      return { exitCode: 0, diagnostics: [], artifacts: [], usage: { inputBytes: 0, outputBytes: 9 }, profile: "gnumeric-1.12.61" };
    } };
    expect(await runCommand(["-M", "fd://1", "-T", "fixture", "/one.fixture", "/two.fixture"], engine, f.operation)).toMatchObject({ exitCode: 0 });
    expect(f.errors()).toBe("Adding sheets from file:///one.fixture\nAdding sheets from file:///two.fixture\n");
    expect(f.stdout).toEqual([encode("original\n")]);
  });
  it("does not retry a failed stderr sink or convert its failure into a domain status", async () => {
    const f = fixture();
    const failure = new SsconvertError("io", "simulated stderr failure", 8);
    let writes = 0;
    const operation = { ...f.operation, stderr: { async write() { writes++; throw failure; } } };
    await expect(runCommand(["--list-image-formats"], f.engine, operation)).rejects.toBe(failure);
    expect(writes).toBe(1);
  });
});

describe("reference resource identities", () => {
  it("uses a file URI in exporter inference failures with an explicit virtual cwd", async () => {
    const f = fixture();
    const engine = createEngine({ codecs: [], limits: { inputBytes: 10, outputBytes: 10, cells: 1, sheets: 1, operations: 1 },
      environment: { env: { PWD: "/work" }, locale: "C", timezone: "UTC" } });
    expect(await runCommand(["absent", "output.unknown"], engine, f.operation)).toEqual({ exitCode: 2 });
    expect(f.errors()).toBe("Unable to guess exporter to use for 'file:///work/output.unknown'.\nTry --list-exporters to see a list of possibilities.\n");
  });
});

it("bounds retained codec diagnostics before publishing output", async () => {
  const f = fixture([{ id: "warning-reader", description: "Warning reader", extensions: [],
    async read(_bytes, context) {
      await context.diagnostic?.({ code: "original", severity: "warning", message: "original", bytes: new Uint8Array(1001) });
      return { sheets: [{ id: "s", name: "s", cells: [] }] };
    }
  }]);
  expect(await runCommand(["-I", "warning-reader", "/in.fixture", "/out.fixture"], f.engine, f.operation)).toEqual({ exitCode: 1 });
  expect(f.errors()).toBe("ssconvert diagnostic bytes limit exceeded\n");
  expect(f.volume.toJSON()).toEqual({ "/in.fixture": "original" });
});

it("formats file publication errno with the native destination URI", async () => {
  const f = fixture();
  expect(await runCommand(["/in.fixture", "/absent/out.fixture"], f.engine, f.operation)).toEqual({ exitCode: 1 });
  expect(f.errors()).toBe("E Can't open 'file:///absent/out.fixture' for writing: No such file or directory\n");
  expect(f.volume.toJSON()).toEqual({ "/in.fixture": "original" });
});

it("emits unconditional merge notices from the actual shared engine after all inputs load", async () => {
  const observed: string[][] = [];
  const f = fixture([{ id: "merge-writer", description: "Original merge writer", extensions: ["merge"],
    async write(book) { observed.push(book.sheets.map(sheet => sheet.name)); return encode(book.sheets.map(sheet => sheet.name).join(",")); }
  }]);
  f.volume.writeFileSync("/two.fixture", "second");
  expect(await runCommand(["-M", "/out.merge", "/in.fixture", "/two.fixture"], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
  expect(observed).toEqual([["Sheet1", "Sheet1(2)"]]);
  expect(f.errors()).toBe("Adding sheets from file:///in.fixture\nAdding sheets from file:///two.fixture\n");
  expect(f.stdout).toEqual([]);
  expect(f.volume.readFileSync("/out.merge", "utf8")).toBe("Sheet1,Sheet1(2)");
});

it("does not claim sheets were added when a later merge input fails to load", async () => {
  const f = fixture();
  expect(await runCommand(["-M", "/out.fixture", "/in.fixture", "/missing.fixture"], f.engine, f.operation)).toEqual({ exitCode: 1 });
  expect(f.errors()).toBe("E /missing.fixture: No such file or directory\n");
  expect(f.volume.toJSON()).toEqual({ "/in.fixture": "original" });
});

it("admits merge cell storage before retaining another workbook or loading later inputs", async () => {
  let reads = 0;
  const f = fixture([{ id: "storage-reader", description: "Original bounded cells", extensions: [],
    async read() {
      reads++;
      return { sheets: [{ id: "s", name: "Original", cells: Array.from({ length: 80 }, (_, row) =>
        ({ row, column: 0, value: { kind: "number" as const, value: row } })) }] };
    }
  }]);
  f.volume.writeFileSync("/two.fixture", "second");
  f.volume.writeFileSync("/three.fixture", "third");
  expect(await runCommand(["-I", "storage-reader", "-M", "/out.fixture", "/in.fixture", "/two.fixture", "/three.fixture"], f.engine, f.operation)).toEqual({ exitCode: 1 });
  expect(reads).toBe(2);
  expect(f.errors()).toBe("ssconvert workbook storage limit exceeded\n");
  expect(f.volume.existsSync("/out.fixture")).toBe(false);
});
