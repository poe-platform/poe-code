import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, type Workbook } from "../index.js";

const book: Workbook = { sheets: [{ id: "first", name: "First", cells: [
  { row: 0, column: 0, value: { kind: "number", value: 1 } }
] }] };
function fixture(inputBook = book, saver?: import("../codecs.js").Codec, limits: Partial<import("../contracts.js").RuntimeLimits> = {},
  formulas?: import("../formulas.js").FormulaCapability) {
  const volume = Volume.fromJSON({ "/input": "original", "/output": "keep" });
  const engine = createEngine({ codecs: [{ id: "fixture", description: "Original fixture", extensions: [],
    probeContent: () => true, async read() { return inputBook; } }, ...(saver ? [saver] : [])],
    environment: { env: { PWD: "/" }, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100, ...limits },
    ...(formulas ? { formulas } : {}),
    filesystem: {
      async read(path) { return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
      async write(path, bytes) { volume.writeFileSync(path, bytes); }
    } });
  async function cli(target: string, range = "A1") {
    const stderr: string[] = [];
    const result = await runCommand([`--clipboard=${target}`, `--export-range=${range}`, "/input", "/output"], engine, {
      signal: new AbortController().signal,
      stdout: { async write() { throw new Error("unexpected stdout"); } },
      stderr: { async write(bytes) { stderr.push(new TextDecoder().decode(bytes)); } }
    });
    return { result, stderr };
  }
  return { volume, engine, cli };
}

it.each(["UTF8_STRING", "text/plain;charset=utf-8", "STRING", "COMPOUND_TEXT"])("matches released empty text target %s", async target => {
  const f = fixture();
  expect(await f.cli(target)).toEqual({ result: { exitCode: 0, profile: "gnumeric-1.12.61", diagnostics: [],
    artifacts: [{ uri: "/output", bytes: 0 }], usage: { inputBytes: 8, outputBytes: 0 } }, stderr: [] });
  expect(f.volume.readFileSync("/output")).toHaveLength(0);
});

it("uses explicit nonforce import calculation while preserving manual mode before updates", async () => {
  const calls: unknown[] = [];
  const imported: Workbook = { calculationMode: "manual", sheets: [{ id: "first", name: "First", cells: [{
    row: 0, column: 0, value: { kind: "number", value: 99 }, formula: "=1+1", formulaDirty: true
  }] }] };
  const f = fixture(imported, undefined, {}, { async recalculate(book, _context, options) {
    calls.push({ mode: book.calculationMode, options });
    return { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, cells: sheet.cells.map(cell => ({ ...cell,
      formulaDirty: false, cachedResult: { kind: "number" as const, value: 2 } })) })) };
  } });
  await f.engine.convert({ input: { kind: "resource", uri: "/input" }, destination: { kind: "resource", uri: "/output" },
    clipboard: "application/x-gnumeric", exportRangeExpression: "A1", updateExpressions: ["A1=7"] }, { signal: new AbortController().signal });
  expect(calls).toEqual([{ mode: "manual", options: { force: false, ignoreCalculationMode: true } }]);
  expect(f.volume.readFileSync("/output", "utf8").toString()).toContain('<gnm:Cell Row="0" Col="0" ValueType="40">7</gnm:Cell>');
  expect(imported.calculationMode).toBe("manual");
  expect(imported.sheets[0]?.cells[0]?.formulaDirty).toBe(true);
});

it("observes injected import-calculation cancellation before destination effects", async () => {
  const controller = new AbortController(), reason = new Error("import calculation cancellation");
  const f = fixture({ sheets: [{ id: "first", name: "First", cells: [{ row: 0, column: 0,
    value: { kind: "blank" }, formula: "=1+1", formulaDirty: true }] }] }, undefined, {}, { async recalculate(book, context) {
    expect(context.signal).toBe(controller.signal); controller.abort(reason); return book;
  } });
  await expect(f.engine.convert({ input: { kind: "resource", uri: "/input" }, destination: { kind: "resource", uri: "/output" },
    clipboard: "application/x-gnumeric", exportRangeExpression: "A1" }, { signal: controller.signal })).rejects.toBe(reason);
  expect(f.volume.readFileSync("/output", "utf8")).toBe("keep");
});

it("admits injected import-calculation results against workbook budgets before publication", async () => {
  const f = fixture({ sheets: [{ id: "first", name: "First", cells: [{ row: 0, column: 0,
    value: { kind: "blank" }, formula: "=1+1", formulaDirty: true }] }] }, undefined, { cells: 1 }, { async recalculate(book) {
    return { ...book, sheets: [{ ...book.sheets[0]!, cells: [{ row: 0, column: 0, value: { kind: "number", value: 2 } },
      { row: 1, column: 0, value: { kind: "number", value: 3 } }] }] };
  } });
  await expect(f.engine.convert({ input: { kind: "resource", uri: "/input" }, destination: { kind: "resource", uri: "/output" },
    clipboard: "application/x-gnumeric", exportRangeExpression: "A1" }, { signal: new AbortController().signal })).rejects.toMatchObject({ code: "resource-limit" });
  expect(f.volume.readFileSync("/output", "utf8")).toBe("keep");
});

it("rejects clipboard serialization beyond the output budget without publishing", async () => {
  const f = fixture(book, undefined, { outputBytes: 20 });
  await expect(f.engine.convert({ input: { kind: "resource", uri: "/input" }, destination: { kind: "resource", uri: "/output" },
    clipboard: "application/x-gnumeric", exportRangeExpression: "A1" }, { signal: new AbortController().signal }))
    .rejects.toMatchObject({ code: "resource-limit" });
  expect(f.volume.readFileSync("/output", "utf8")).toBe("keep");
});

it("observes cancellation following a clipboard diagnostic before publishing empty bytes", async () => {
  const f = fixture();
  const controller = new AbortController(), reason = new Error("independent cancellation");
  await expect(f.engine.convert({ input: { kind: "resource", uri: "/input" }, destination: { kind: "resource", uri: "/output" },
    clipboard: "text/uri-list", exportRangeExpression: "A1" }, { signal: controller.signal,
      async diagnostic() { controller.abort(reason); } })).rejects.toBe(reason);
  expect(f.volume.readFileSync("/output", "utf8")).toBe("keep");
});

it("rejects an SDK clipboard range naming a missing sheet without publishing", async () => {
  const f = fixture();
  await expect(f.engine.convert({ input: { kind: "resource", uri: "/input" }, destination: { kind: "resource", uri: "/output" },
    clipboard: "application/x-gnumeric", exportRange: { sheet: "missing", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } },
    { signal: new AbortController().signal })).rejects.toMatchObject({ code: "invalid-request", message: "Invalid range specified." });
  expect(f.volume.readFileSync("/output", "utf8")).toBe("keep");
});

it("preserves array dimensions and omits array follower cells in native clipboard XML", async () => {
  const f = fixture({ sheets: [{ id: "first", name: "First", formulaGroups: [{ id: "array", kind: "array", expression: "={1,2;3,4}",
    range: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 } }], cells: [
    { row: 1, column: 1, value: { kind: "number", value: 1 }, formula: "={1,2;3,4}", formulaGroup: "array" },
    { row: 1, column: 2, value: { kind: "number", value: 2 }, formulaGroup: "array" },
    { row: 2, column: 1, value: { kind: "number", value: 3 }, formulaGroup: "array" },
    { row: 2, column: 2, value: { kind: "number", value: 4 }, formulaGroup: "array" }
  ] }] });
  await f.cli("application/x-gnumeric", "B2:C3");
  const xml = f.volume.readFileSync("/output", "utf8").toString();
  expect(xml).toContain('<gnm:Cell Row="1" Col="1" ExprID="1" Rows="2" Cols="2" ValueType="40" Value="1">={1,2;3,4}</gnm:Cell>');
  expect(xml.split('<gnm:Cell ')).toHaveLength(2);
  await f.cli("application/x-gnumeric", "C3");
  const follower = f.volume.readFileSync("/output", "utf8").toString();
  expect(follower).toContain("  <gnm:Cells/>\n");
  expect(follower).toContain('FloatDigits="53" NotAsContent="1"');
});

it("copies only contained objects and comments to relative native and table anchors", async () => {
  const namespace = "http://www.gnumeric.org/v10.dtd";
  const attribute = (name: string, value: string) => ({ name, namespace: "", value });
  const comment = (bound: string, text: string) => ({ name: "CellComment", namespace, text: "", children: [],
    attributes: [attribute("ObjectBound", bound), attribute("Text", text)] });
  let saved: Workbook | undefined;
  const f = fixture({ sheets: [{ id: "first", name: "First", cells: [], unsupportedRecords: [{
    source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: { name: "Objects", namespace, text: "", attributes: [],
      children: [comment("B2:B2", "inside"), comment("A1:A1", "outside"), comment("C3:D4", "overlapping")] }
  }] }] }, { id: "Gnumeric_html:xhtml_range", description: "Original captured table saver", extensions: [], async write(book) { saved = book; return new Uint8Array(); } });
  await f.cli("application/x-gnumeric", "B2:C3");
  const xml = f.volume.readFileSync("/output", "utf8").toString();
  expect(xml).toContain('<gnm:CellComment ObjectBound="A1:A1" Text="inside"/>');
  expect(xml).not.toContain("outside"); expect(xml).not.toContain("overlapping");
  await f.cli("text/html", "B2:C3");
  expect(saved?.sheets[0]?.unsupportedRecords?.filter(record => record.kind === "Objects")).toEqual([{
    source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: { name: "Objects", namespace, text: "", attributes: [], children: [comment("A1:A1", "inside")] }
  }]);
});

it.each(["text/plain", "text/rtf", "application/unknown"])("rejects unknown MIME %s without overwriting", async target => {
  const f = fixture();
  expect(await f.cli(target)).toEqual({ result: { exitCode: 1 }, stderr: ["Failed to get clipboard data.\n"] });
  expect(f.volume.readFileSync("/output", "utf8")).toBe("keep");
});

it("validates ranges before target lookup", async () => {
  const f = fixture();
  expect(await f.cli("application/unknown", "nonsense")).toEqual({ result: { exitCode: 1 }, stderr: ["Invalid range specified.\n"] });
  expect(f.volume.readFileSync("/output", "utf8")).toBe("keep");
});

it("copies overlapping native merges including negative translated coordinates, omitting disjoint merges", async () => {
  const f = fixture({ sheets: [{ id: "first", name: "First", cells: [], merges: [
    { startRow: 1, startColumn: 1, endRow: 3, endColumn: 3 }
  ] }] });
  await f.cli("application/x-gnumeric", "A1:C3");
  expect(f.volume.readFileSync("/output", "utf8").toString()).toContain("<gnm:Merge>B2:D4</gnm:Merge>");
  await f.cli("application/x-gnumeric", "C3:D4");
  expect(f.volume.readFileSync("/output", "utf8").toString()).toContain("<gnm:Merge>[C-1]0:B2</gnm:Merge>");
  await f.cli("application/x-gnumeric", "F6");
  expect(f.volume.readFileSync("/output", "utf8").toString()).not.toContain("MergedRegions");
});

it("orders native clipboard merges bottom to top and left to right regardless of import order", async () => {
  const f = fixture({ sheets: [{ id: "first", name: "First", cells: [], merges: [
    { startRow: 1, startColumn: 3, endRow: 1, endColumn: 4 },
    { startRow: 1, startColumn: 0, endRow: 1, endColumn: 1 },
    { startRow: 3, startColumn: 1, endRow: 3, endColumn: 2 }
  ] }] });
  await f.cli("application/x-gnumeric", "A1:F5");
  const xml = f.volume.readFileSync("/output", "utf8").toString();
  expect(xml.split("<gnm:Merge>").slice(1).map(text => text.split("</gnm:Merge>")[0])).toEqual(["B4:C4", "A2:B2", "D2:E2"]);
});

it("retains an explicitly existing blank clipboard cell and distinguishes absent cells", async () => {
  const f = fixture({ sheets: [{ id: "first", name: "First", cells: [{ row: 0, column: 0, value: { kind: "blank" } }] }] });
  await f.cli("application/x-gnumeric", "A1:B1");
  expect(f.volume.readFileSync("/output", "utf8").toString()).toContain('<gnm:Cell Row="0" Col="0" ValueType="10"></gnm:Cell>');
  await f.cli("application/x-gnumeric", "B1");
  expect(f.volume.readFileSync("/output", "utf8").toString()).not.toContain("<gnm:Cells");
});

it("returns native empty image bytes and a warning for a contained non-imageable comment", async () => {
  const namespace = "http://www.gnumeric.org/v10.dtd";
  const f = fixture({ sheets: [{ id: "first", name: "First", cells: [], unsupportedRecords: [{
    source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: {
      name: "Objects", namespace, text: "", attributes: [], children: [{ name: "CellComment", namespace, text: "", children: [],
        attributes: [{ name: "ObjectBound", namespace: "", value: "A1:A1" }, { name: "Text", namespace: "", value: "original comment" }] }]
    }
  }] }] });
  const { result, stderr } = await f.cli("image/png");
  expect(result.exitCode).toBe(0);
  expect(stderr).toEqual(["sheet_object_write_image: assertion 'GNM_IS_SO_IMAGEABLE (so)' failed\n"]);
  expect(f.volume.readFileSync("/output")).toHaveLength(0);
});

it("pastes overlapping table merges only when translated corners remain valid", async () => {
  let saved: Workbook | undefined;
  const f = fixture({ sheets: [{ id: "first", name: "First", cells: [], merges: [
    { startRow: 1, startColumn: 1, endRow: 3, endColumn: 3 }
  ] }] }, { id: "Gnumeric_html:xhtml_range", description: "Captured saver", extensions: [],
    async write(book) { saved = book; return new Uint8Array(); } });
  await f.cli("text/html", "A1:C3");
  expect(saved?.sheets[0]?.merges).toEqual([{ startRow: 1, startColumn: 1, endRow: 3, endColumn: 3 }]);
  await f.cli("text/html", "C3:D4");
  expect(saved?.sheets[0]?.merges).toEqual([]);
});

it("serializes native cells with the clipboard root, styles and original coordinates", async () => {
  const f = fixture();
  const result = await f.cli("application/x-gnumeric");
  const xml = f.volume.readFileSync("/output", "utf8").toString();
  expect(result).toEqual({ result: { exitCode: 0, profile: "gnumeric-1.12.61", diagnostics: [],
    artifacts: [{ uri: "/output", bytes: new TextEncoder().encode(xml).length }],
    usage: { inputBytes: 8, outputBytes: new TextEncoder().encode(xml).length } }, stderr: [] });
  expect(xml).toContain('<gnm:ClipboardRange xmlns:gnm="http://www.gnumeric.org/v10.dtd" xmlns="http://www.gnumeric.org/v10.dtd" Cols="1" Rows="1" BaseCol="0" BaseRow="0" FloatRadix="2" FloatDigits="53">');
  expect(xml).toContain('    <gnm:Cell Row="0" Col="0" ValueType="40">1</gnm:Cell>');
  expect(xml).toContain('<gnm:Styles>');
  expect(xml).not.toContain('<gnm:Workbook');
  expect(xml).toContain('StrikeThrough="0" Script="0"');
});

it("preserves original formula coordinates and native shared expression IDs", async () => {
  const f = fixture({ sheets: [{ id: "first", name: "First", cells: [
    { row: 1, column: 1, value: { kind: "number", value: 5 } },
    { row: 1, column: 2, value: { kind: "number", value: 6 }, formula: "=B2+1" },
    { row: 1, column: 3, value: { kind: "number", value: 6 }, formula: "=$B$2+1" },
    { row: 2, column: 2, value: { kind: "number", value: 8 }, formula: "=B3+1" }
  ] }] });
  await f.cli("application/x-gnumeric", "B2:D3");
  const xml = f.volume.readFileSync("/output", "utf8").toString();
  expect(xml).toContain('<gnm:Cell Row="1" Col="2" ExprID="1" ValueType="40" Value="6">=B2+1</gnm:Cell>');
  expect(xml).toContain('<gnm:Cell Row="1" Col="3" ExprID="2" ValueType="40" Value="6">=$B$2+1</gnm:Cell>');
  expect(xml).toContain('<gnm:Cell Row="2" Col="2" ExprID="3" ValueType="40" Value="8">=B3+1</gnm:Cell>');
});

it("pastes table values into a fresh workbook without source axes or date convention", async () => {
  let saved: Workbook | undefined;
  const f = fixture({ dateSystem: "1904", sheets: [{ id: "first", name: "First", rows: [{ index: 1, sizePoints: 80 }],
    columns: [{ index: 1, hidden: true }], cells: [
      { row: 1, column: 1, value: { kind: "number", value: 9 }, formula: "=1+1", cachedResult: { kind: "number", value: 2 } }
    ] }] }, { id: "Gnumeric_html:xhtml_range", extensions: [], description: "Captured saver", async write(value) { saved = value; return new Uint8Array(); } });
  await f.cli("text/html", "B2");
  const namespace = "http://www.gnumeric.org/v10.dtd";
  const attributes = (values: Readonly<Record<string, string>>) => Object.entries(values).map(([name, value]) => ({ name, namespace: "", value }));
  expect(saved).toEqual({ activeSheet: "clipboard", sheets: [{ id: "clipboard", name: "Sheet1", unsupportedRecords: [{
    source: "Gnumeric_XmlIO:sax", kind: "Styles", disposition: "retained", data: { name: "Styles", namespace, text: "", attributes: [], children: [{
      name: "StyleRegion", namespace, text: "", attributes: attributes({ startCol: "0", startRow: "0", endCol: "0", endRow: "0" }), children: [{
        name: "Style", namespace, text: "", attributes: attributes({ HAlign: "GNM_HALIGN_GENERAL", VAlign: "GNM_VALIGN_BOTTOM", WrapText: "0", ShrinkToFit: "0",
          Rotation: "0", Shade: "0", Indent: "0", Locked: "1", Hidden: "0", Fore: "0:0:0", Back: "FFFF:FFFF:FFFF", PatternColor: "0:0:0", Format: "General" }),
        children: [{ name: "Font", namespace, text: "Sans", attributes: attributes({ Unit: "10", Bold: "0", Italic: "0", Underline: "0", StrikeThrough: "0", Script: "0" }), children: [] }]
      }]
    }] }
  }], cells: [
    { row: 0, column: 0, value: { kind: "number", value: 2 } }
  ] }] });
});

it("serializes imported uniform styles and original axis positions as native XML", async () => {
  const ns = "http://www.gnumeric.org/v10.dtd";
  const attr = (name: string, value: string) => ({ name, value, namespace: "" });
  const style = { name: "Style", namespace: ns, attributes: [attr("Format", "0.00")], text: "",
    children: [{ name: "Font", namespace: ns, attributes: [attr("Bold", "1")], text: "", children: [] }] };
  const f = fixture({ sheets: [{ id: "first", name: "Original", columns: [{ index: 1, sizePoints: 90, hidden: true,
    style: { gnumeric: { name: "ColInfo", namespace: ns, attributes: [attr("HardSize", "1")], children: [], text: "" } } }],
    rows: [{ index: 1, sizePoints: 60, style: { gnumeric: { name: "RowInfo", namespace: ns, attributes: [attr("HardSize", "1")], children: [], text: "" } } }],
    cells: [{ row: 1, column: 1, value: { kind: "number", value: 2 }, format: "0.00", style: { gnumeric: style } }],
    unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Styles", disposition: "retained", data: {
      name: "Styles", namespace: ns, attributes: [], text: "", children: [{ name: "StyleRegion", namespace: ns,
        attributes: [attr("startCol", "1"), attr("startRow", "1"), attr("endCol", "2"), attr("endRow", "2")], text: "", children: [style] }]
    } }] }] });
  await f.cli("application/x-gnumeric", "B2:C3");
  const xml = f.volume.readFileSync("/output", "utf8").toString();
  expect(xml).toContain('<gnm:ColInfo No="1" Unit="90" HardSize="1" Hidden="1"/>');
  expect(xml).toContain('<gnm:RowInfo No="1" Unit="60" HardSize="1"/>');
  expect(xml.split('<gnm:StyleRegion')).toHaveLength(2);
  expect(xml).toContain('PatternColor="0:0:0" Format="0.00"');
  expect(xml).toContain('<gnm:Font Unit="10" Bold="1" Italic="0" Underline="0" StrikeThrough="0" Script="0">Sans</gnm:Font>');
  await f.cli("application/x-gnumeric", "C3:D4");
  const mixed = f.volume.readFileSync("/output", "utf8").toString();
  expect(mixed).not.toContain("<gnm:Cells");
  const first = mixed.indexOf('startCol="0" startRow="0" endCol="0" endRow="0"');
  const second = mixed.indexOf('startCol="0" startRow="1" endCol="1" endRow="1"');
  const third = mixed.indexOf('startCol="1" startRow="0" endCol="1" endRow="0"');
  expect(first).toBeGreaterThan(0);
  expect(second).toBeGreaterThan(first);
  expect(third).toBeGreaterThan(second);
});
