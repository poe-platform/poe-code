import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, createResourceIO, runCommand, type Codec, type ConversionRequest, type Workbook } from "../index.js";
import { exportRangeForSheet } from "../workbook/expressions.js";

const book: Workbook = { activeSheet: "b", names: [{ name: "Local", expression: "$A$1:$B$2" }], sheets: [
  { id: "a", name: "First", cells: [{ row: 0, column: 0, value: { kind: "number", value: 1 } }], size: { rows: 128, columns: 128 } },
  { id: "b", name: "A= B", cells: [{ row: 0, column: 0, value: { kind: "number", value: 2 } }], size: { rows: 128, columns: 128 } },
  { id: "c", name: "Last", cells: [{ row: 0, column: 0, value: { kind: "number", value: 3 } }], size: { rows: 128, columns: 128 } }
] };
function fixture(id = "Gnumeric_stf:stf_csv", metadata: Partial<Codec> = {}) {
  const volume = Volume.fromJSON({ "/input": "original", "/keep": "keep" });
  const selections: unknown[] = [], events: string[] = [];
  const codec: Codec = { id, description: "Original small fixture", extensions: ["data"], ...metadata,
    async write(value, _options, _context, selection) {
      events.push("save"); selections.push(selection);
      expect(value.sheets.map(sheet => sheet.id).sort()).toEqual(["a", "b", "c"]);
      const selected = selection?.sheets ?? value.sheets.map(sheet => sheet.id);
      let output = "";
      for (const sheet of selected) {
        const range = selection?.range;
        if (range && !exportRangeForSheet(range, value, sheet)) continue;
        output += `${value.sheets.find(candidate => candidate.id === sheet)!.cells[0]!.value.kind === "number" ?
          (value.sheets.find(candidate => candidate.id === sheet)!.cells[0]!.value as { value: number }).value : ""}\n`;
      }
      return new TextEncoder().encode(output);
    }
  };
  const engine = createEngine({ codecs: [{ id: "input", description: "Original input", extensions: [],
    probeContent: () => true, async read() { events.push("load"); return book; } }, codec],
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000, outputBytes: 10000, cells: 100, sheets: 30, operations: 40 },
    filesystem: createResourceIO({ cwd: "/", filesystem: {
      async read(path) { events.push("read"); return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
      async write(path, bytes) { events.push("publish"); volume.writeFileSync(path, bytes); }
    } })
  });
  const request = { input: { kind: "resource" as const, uri: "/input" },
    destination: { kind: "resource" as const, uri: "/keep" }, exportType: id };
  async function cli(extra: readonly string[] = []) {
    const stderr: string[] = [], stdout: Uint8Array[] = [];
    const result = await runCommand(["-T", id, ...extra, "/input", "/keep"], engine, {
      signal: new AbortController().signal, stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
      stderr: { async write(bytes) { stderr.push(new TextDecoder().decode(bytes)); } }
    });
    return { result, stderr, stdout };
  }
  return { volume, engine, request, selections, events, cli };
}
const operation = () => ({ signal: new AbortController().signal });

it.each(["", "false", "ignored", "0"])("ignores active-sheet=%s and requires equals", async value => {
  const f = fixture();
  expect((await f.cli(["-O", `active-sheet=${value}`])).result.exitCode).toBe(0);
  expect(f.volume.readFileSync("/keep", "utf8")).toBe("2\n");
  expect(f.selections).toEqual([{ sheets: ["b"] }]);
});

it.each(["sheet", "active-sheet"])("rejects %s without equals before publication", async key => {
  const f = fixture();
  expect(await f.cli(["-O", key])).toEqual({ result: { exitCode: 1 }, stderr: ["ssconvert: Syntax error\n"], stdout: [] });
  expect(f.volume.toJSON()).toEqual({ "/input": "original", "/keep": "keep" });
});

it("keeps selections in order including duplicates and the active view", async () => {
  const f = fixture("Gnumeric_stf:stf_assistant");
  await f.engine.convert({ ...f.request, exportOptions: ["sheet=Last sheet=first active-sheet=0 sheet=First"] }, operation());
  expect(f.selections).toEqual([{ sheets: ["c", "a", "b", "a"] }]);
  expect(f.volume.readFileSync("/keep", "utf8")).toBe("3\n1\n2\n1\n");
});

it("defaults sheet savers to the active view and workbook savers to all sheets", async () => {
  const sheet = fixture(); await sheet.cli();
  expect(sheet.volume.readFileSync("/keep", "utf8")).toBe("2\n");
  const workbook = fixture("Gnumeric_stf:stf_assistant"); await workbook.cli();
  expect(workbook.selections).toEqual([undefined]);
  expect(workbook.volume.readFileSync("/keep", "utf8")).toBe("1\n2\n3\n");
});

it.each([
  ["Gnumeric_XmlIO:sax", ["-O", "sheet=First"], "does not have the ability to export a subset of sheets."],
  ["Gnumeric_XmlIO:sax", ["-S"], "does not have the ability to split a workbook into sheets."],
  ["Gnumeric_html:xhtml_range", ["-S"], "does not have the ability to split a workbook into sheets."],
  ["Gnumeric_html:xhtml_range", ["-O", "sheet=First"], "does not have the ability to export a subset of sheets."],
  ["Gnumeric_stf:stf_csv", ["-O", "sheet=First sheet=First"], "can only export one sheet at a time."],
  ["Gnumeric_stf:stf_csv", ["-O", "sheet=Unknown", "--export-range=Last!A1"], "unknown"]
] as const)("validates %s capabilities before ranges", async (id, options, diagnostic) => {
  const f = fixture(id);
  const message = diagnostic === "unknown" ? 'ssconvert: Unknown sheet "Unknown"\n' : `Selected exporter (${id}) ${diagnostic}\n`;
  expect(await f.cli(options)).toEqual({ result: { exitCode: 1 }, stderr: [message], stdout: [] });
  expect(f.events).toEqual(["read", "load"]);
  expect(f.volume.toJSON()).toEqual({ "/input": "original", "/keep": "keep" });
});

it.each([
  ["Gnumeric_XmlIO:sax", undefined],
  ["Gnumeric_html:html40", { sheets: ["a"] }],
  ["Gnumeric_html:xhtml_range", { sheets: ["a"] }],
  ["Gnumeric_sylk:sylk", { sheets: ["b"] }],
  ["Gnumeric_dif:dif", { sheets: ["b"] }]
] as const)("passes only honored selection/range metadata to %s", async (id, selection) => {
  const f = fixture(id);
  expect((await f.cli(["--export-range=First!A1"])).result.exitCode).toBe(0);
  expect(f.selections).toEqual([selection]);
});

it("LaTeX uses runtime selection, ignoring the common sheet option until range overrides it", async () => {
  const f = fixture("Gnumeric_html:latex_table");
  await f.cli(["-O", "sheet=First"]);
  expect(f.selections).toEqual([{ sheets: ["b"] }]);
  await f.cli(["-O", "sheet=First", "--export-range=Last!A1"]);
  expect(f.selections[1]).toEqual({ sheets: ["c"], range: { sheet: "c", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } });
});

it.each([false, true])("preserves duplicates and split-range exclusion (qualified=%s)", async qualified => {
  const f = fixture();
  const request: ConversionRequest = { ...f.request, destination: { kind: "resource", uri: "/out-%n-%s" }, perSheet: true,
    exportOptions: ["sheet=Last sheet=First sheet=Last"], exportRangeExpression: qualified ? "Last!A1" : "A1" };
  await f.engine.convert(request, operation());
  expect(f.volume.toJSON()).toEqual({ "/input": "original", "/keep": "keep",
    "/out-0-Last": "3\n", "/out-1-First": qualified ? "" : "1\n", "/out-2-Last": "3\n" });
});

it.each(["First:Last!A1", "Last:First!A1"])("preserves the original sheet-span order: %s", async expression => {
  const f = fixture();
  await f.engine.convert({ ...f.request, perSheet: true, exportRangeExpression: expression }, operation());
  expect(f.volume.readFileSync("/keep.0", "utf8")).toBe(expression.startsWith("Last") ? "" : "1\n");
  expect(f.volume.readFileSync("/keep.1", "utf8")).toBe(expression.startsWith("Last") ? "" : "2\n");
  expect(f.volume.readFileSync("/keep.2", "utf8")).toBe(expression.startsWith("Last") ? "" : "3\n");
});

it("validates merge options against the empty target before reading inputs", async () => {
  for (const options of ["sheet=First", "active-sheet=ignored"]) {
    const f = fixture();
    await expect(f.engine.merge({ ...f.request, inputs: [f.request.input, f.request.input], exportOptions: [options] }, operation()))
      .rejects.toMatchObject({ message: `ssconvert: Unknown sheet "${options.split("=")[1]}"`, exitCode: 1 });
    expect(f.events).toEqual([]);
    expect(f.volume.toJSON()).toEqual({ "/input": "original", "/keep": "keep" });
  }
});
