import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, type Workbook, type FormattingCapability } from "../index.js";

function fixture(book: Workbook, formatting?: FormattingCapability) {
  const volume = Volume.fromJSON({ "/input": "fixture", "/output": "keep" });
  const engine = createEngine({
    codecs: [{ id: "fixture", description: "In-memory workbook", extensions: [],
      probeContent: () => true, async read() { return book; } }],
    environment: { env: {}, locale: "C", timezone: "UTC" },
    ...(formatting === undefined ? {} : { formatting }),
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100, workbookWork: 10000 },
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); } }
  });
  const errors: string[] = [];
  const controller = new AbortController();
  const operation = { signal: controller.signal, stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(new TextDecoder().decode(bytes)); } } };
  return { engine, volume, errors, controller, async cli(id: string, options?: string, extra: readonly string[] = []) {
    return runCommand(["-T", id, ...(options === undefined ? [] : ["-O", options]), ...extra, "/input", "/output"], engine, operation);
  } };
}

const book: Workbook = { activeSheet: "b", sheets: [
  { id: "a", name: "First", cells: [
    { row: 0, column: 0, value: { kind: "string", value: 'a,"b' } },
    { row: 0, column: 1, value: { kind: "string", value: " inside " } },
    { row: 2, column: 0, value: { kind: "string", value: "a\nb" } }
  ] },
  { id: "b", name: "Second", cells: [{ row: 0, column: 0, value: { kind: "number", value: 1.2 }, format: "0.00" }] }
] };

it("installs distinct configurable and plain CSV writers with native sheet defaults", async () => {
  const f = fixture(book);
  try {
    expect(await f.cli("Gnumeric_stf:stf_assistant")).toEqual({ exitCode: 0, diagnostics: [],
      artifacts: [{ uri: "/output", bytes: 32 }], usage: { inputBytes: 7, outputBytes: 32 }, profile: "gnumeric-1.12.61" });
    expect(f.errors).toEqual([]);
    expect(f.volume.readFileSync("/output", "utf8")).toBe('"a,""b"," inside "\n,\n"a\nb",\n1.2\n');
    expect(await f.cli("Gnumeric_stf:stf_csv")).toEqual({ exitCode: 0, diagnostics: [],
      artifacts: [{ uri: "/output", bytes: 4 }], usage: { inputBytes: 7, outputBytes: 4 }, profile: "gnumeric-1.12.61" });
    expect(f.volume.readFileSync("/output", "utf8")).toBe("1.2\n");
  } finally { await f.engine.dispose(); }
});

it("preserves cancellation identity during awaited cell formatting without publication", async () => {
  const reason = { cancelled: true };
  const f = fixture(book, { async format() { f.controller.abort(reason); return "1.2"; } });
  try {
    await expect(f.cli("Gnumeric_stf:stf_assistant")).rejects.toBe(reason);
    expect(f.errors).toEqual([]);
    expect(f.volume.toJSON()).toEqual({ "/input": "fixture", "/output": "keep" });
  } finally { await f.engine.dispose(); }
});

it.each([
  [undefined, "\n"], ["A2:C3", ",,\n,,\n"], ["Empty!B2:C2", ",\n"]
])("writes measured empty-sheet range %s", async (range, output) => {
  const f = fixture({ sheets: [{ id: "a", name: "Empty", cells: [] }] });
  try {
    expect((await f.cli("Gnumeric_stf:stf_assistant", undefined,
      range === undefined ? [] : ["--export-range", range])).exitCode).toBe(0);
    expect(f.errors).toEqual([]);
    expect(f.volume.readFileSync("/output", "utf8")).toBe(output);
  } finally { await f.engine.dispose(); }
});

it("bounds quote expansion and sparse export work without publishing partial success", async () => {
  const f = fixture(book);
  try {
    expect(await f.cli("Gnumeric_stf:stf_assistant", "quote='" + "a".repeat(10000) + "'")).toEqual({ exitCode: 1 });
    expect(f.errors).toEqual(["ssconvert output bytes limit exceeded\n"]);
    expect(f.volume.readFileSync("/output", "utf8")).toBe("keep");
    f.errors.length = 0;
    expect(await f.cli("Gnumeric_stf:stf_assistant", undefined, ["--export-range=A10000:A30000"])).toEqual({ exitCode: 1 });
    expect(f.errors).toEqual(["ssconvert text export work limit exceeded\n"]);
    expect(f.volume.toJSON()).toEqual({ "/input": "fixture", "/output": "keep" });
  } finally { await f.engine.dispose(); }
});

it.each([
  ["separator='||' quote=':|'", ':|a,"b:|||:| inside :|\n||\n:|a\nb:|||\n1.2\n'],
  ["quoting-mode=always", '"a,""b"," inside "\n"",""\n"a\nb",""\n"1.2"\n'],
  ["quoting-mode=never", 'a,"b, inside \n,\na\nb,\n1.2\n'],
  ["eol=WINDOWS", '"a,""b"," inside "\r\n,\r\n"a\nb",\r\n1.2\r\n'],
  ["sheet=Second sheet=First sheet=Second", '1.2\n"a,""b"," inside "\n,\n"a\nb",\n1.2\n'],
  ["active-sheet=ignored format=preserve", "1.20\n"],
  ["active-sheet=ignored format=GNM_STF_FORMAT_RAW", "1.2\n"],
  ["locale=bogus sheet=Second", "1.2\n"],
  ["quote='' separator=''", 'a,"b inside \n\na\nb\n1.2\n']
])("matches configurable bytes for %s", async (options, output) => {
  const f = fixture(book);
  try {
    expect((await f.cli("Gnumeric_stf:stf_assistant", options)).exitCode).toBe(0);
    expect(f.errors).toEqual([]);
    expect(f.volume.readFileSync("/output", "utf8")).toBe(output);
  } finally { await f.engine.dispose(); }
});

it("does not extend the used range for styled blank cells", async () => {
  const f = fixture({ sheets: [{ id: "a", name: "First", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 1 } },
    { row: 3, column: 2, value: { kind: "blank" }, format: "0.00" }
  ] }] });
  try {
    expect((await f.cli("Gnumeric_stf:stf_assistant")).exitCode).toBe(0);
    expect(f.volume.readFileSync("/output", "utf8")).toBe("1\n");
  } finally { await f.engine.dispose(); }
});

it("publishes UTF-8 fallback bytes but fails when a charset converter cannot be created", async () => {
  const f = fixture(book);
  try {
    expect(await f.cli("Gnumeric_stf:stf_assistant", "charset=bogus")).toEqual({ exitCode: 1 });
    expect(f.volume.readFileSync("/output", "utf8")).toBe('"a,""b"," inside "\n,\n"a\nb",\n1.2\n');
    expect(f.errors.at(-1)).toBe("E Error while trying to export file as text\n");
    expect(f.errors[0]).toContain("Failed to create converter.");
  } finally { await f.engine.dispose(); }
});

it.each([
  ["Gnumeric_stf:stf_assistant", "formulas=true", 'ssconvert: Invalid export option "formulas" for format Gnumeric_stf:stf_assistant\n'],
  ["Gnumeric_stf:stf_csv", "separator=;", 'ssconvert: Invalid export option "separator" for format Gnumeric_stf:stf_csv\n'],
  ["Gnumeric_stf:stf_csv", "sheet=First sheet=Second", 'Selected exporter (Gnumeric_stf:stf_csv) can only export one sheet at a time.\n'],
  ["Gnumeric_stf:stf_assistant", "quoting-mode=0", 'ssconvert: Invalid value for option quoting-mode: "0"\n']
])("preserves destination on rejected %s %s", async (id, options, error) => {
  const f = fixture(book);
  try {
    expect(await f.cli(id, options)).toEqual({ exitCode: 1 });
    expect(f.errors).toEqual([error]);
    expect(f.volume.toJSON()).toEqual({ "/input": "fixture", "/output": "keep" });
  } finally { await f.engine.dispose(); }
});

it.each([
  ["charset=ASCII transliterate-mode=escape", '"\\u00e9 \\u20ac \\u6f22 \\U0001f600"\n'],
  ["charset=ASCII transliterate-mode=transliterate", '"? EUR ? ?"\n'],
  ["charset=ISO-8859-1 transliterate-mode=escape", '"é \\u20ac \\u6f22 \\U0001f600"\n']
])("encodes measured charset output for %s", async (options, output) => {
  const f = fixture({ sheets: [{ id: "a", name: "First", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "é € 漢 😀" } }
  ] }] });
  try {
    expect((await f.cli("Gnumeric_stf:stf_assistant", options)).exitCode).toBe(0);
    expect(f.errors).toEqual([]);
    expect(Array.from(f.volume.readFileSync("/output") as Uint8Array)).toEqual(Array.from(output, c => c.charCodeAt(0)));
  } finally { await f.engine.dispose(); }
});
