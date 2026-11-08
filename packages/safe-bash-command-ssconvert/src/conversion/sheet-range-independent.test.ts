import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, type Workbook } from "../index.js";

const book: Workbook = { activeSheet: "active", sheets: [
  { id: "first", name: "First", cells: [], size: { rows: 128, columns: 128 } },
  { id: "active", name: "Active", cells: [], size: { rows: 128, columns: 128 } }
] };

it.each(["[fixture.gnumeric]First!A1", "[/data/fixture.gnumeric]First!A1",
  "[file:///data/fixture.gnumeric]First!A1", "['fixture.gnumeric']First!A1"])(
  "resolves registered input workbook qualifier %s without ambient I/O", async expression => {
    const volume = Volume.fromJSON({ "/data/fixture.gnumeric": "original", "/output": "keep" });
    const reads: string[] = [], selections: unknown[] = [];
    const engine = createEngine({
      codecs: [{ id: "fixture", description: "Original fixture", extensions: [], saveScope: "sheet", honorsExportRange: true,
        probeContent: () => true, async read() { return book; },
        async write(_book, _options, _context, selection) {
          selections.push(selection); return new TextEncoder().encode("saved");
        } }],
      environment: { env: {}, locale: "C", timezone: "UTC" },
      limits: { inputBytes: 100, outputBytes: 100, cells: 100, sheets: 10, operations: 10 },
      filesystem: { async read(path) { reads.push(path); return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
        async write(path, bytes) { volume.writeFileSync(path, bytes); } }
    });
    const request = { input: { kind: "resource" as const, uri: "/data/fixture.gnumeric" },
      destination: { kind: "resource" as const, uri: "/output" }, exportType: "fixture", exportRangeExpression: expression };
    await engine.convert(request, { signal: new AbortController().signal });
    expect(selections).toEqual([{ sheets: ["first"], range: { sheet: "first", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } }]);
    expect(reads).toEqual(["/data/fixture.gnumeric"]);
    expect(volume.toJSON()).toEqual({ "/data/fixture.gnumeric": "original", "/output": "saved" });
    selections.length = 0;
    await expect(engine.convert({ ...request, exportRangeExpression: "[unregistered.gnumeric]First!A1" },
      { signal: new AbortController().signal })).rejects.toMatchObject({ message: "Invalid range specified." });
    expect(selections).toEqual([]);
    expect(reads).toEqual(["/data/fixture.gnumeric", "/data/fixture.gnumeric"]);
  }
);

it("wraps only unqualified relative set coordinates to the smaller active sheet", async () => {
  const ranges: unknown[] = [];
  const engine = createEngine({ codecs: [{ id: "fixture", description: "Original unequal fixture", extensions: [],
    probeContent: () => true, async read() { return { ...book, sheets: [
      { ...book.sheets[0]!, size: { rows: 256, columns: 256 } }, book.sheets[1]!
    ] }; }, async write() { return new Uint8Array(); } }],
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100, outputBytes: 100, cells: 100, sheets: 10, operations: 10 },
    cellText: { async setText(value, range) { ranges.push(range); return value; } }
  });
  await engine.convert({ input: { kind: "stream", source: [new Uint8Array()] },
    destination: { kind: "stream", sink: { async write() {} } }, exportType: "fixture",
    updateExpressions: ["DY129=relative", "$DY$129=absolute", "First!DY129=qualified", "DY$129:$DY130=mixed"]
  }, { signal: new AbortController().signal });
  expect(ranges).toEqual([
    { sheet: "active", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
    { sheet: "active", startRow: 128, endRow: 128, startColumn: 128, endColumn: 128 },
    { sheet: "active", startRow: 128, endRow: 128, startColumn: 128, endColumn: 128 },
    { sheet: "active", startRow: 1, endRow: 128, startColumn: 0, endColumn: 128 }
  ]);
});

it.each(["A129", "$A$129", "A$129:A130"])("normalizes exporter-relative endpoints against each target size: %s", async expression => {
  const { parseRangeExpression, exportRangeForSheet } = await import("../workbook/expressions.js");
  const unequal: Workbook = { ...book, sheets: [{ ...book.sheets[0]!, size: { rows: 256, columns: 256 } }, book.sheets[1]!] };
  const range = parseRangeExpression(expression, unequal, true);
  const selected = exportRangeForSheet(range, unequal, "active");
  expect(selected?.startRow).toBe(expression === "A129" ? 0 : expression === "$A$129" ? 128 : 1);
  expect(selected?.endRow).toBe(expression === "A129" ? 0 : 128);
});

it("resolves an explicit stream filename while preserving anonymous stream isolation", async () => {
  const selections: unknown[] = [];
  const engine = createEngine({ codecs: [{ id: "fixture", description: "Original stream", extensions: [], saveScope: "sheet",
    honorsExportRange: true, probeContent: () => true, async read() { return book; },
    async write(_book, _options, _context, selection) { selections.push(selection); return new Uint8Array(); } }],
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100, outputBytes: 100, cells: 100, sheets: 10, operations: 10 }
  });
  const request = { input: { kind: "stream" as const, source: [new Uint8Array()], filename: "fd://0" },
    destination: { kind: "stream" as const, sink: { async write() {} } }, exportType: "fixture", exportRangeExpression: "[fd://0]First!A1" };
  await engine.convert(request, { signal: new AbortController().signal });
  expect(selections).toHaveLength(1);
  await expect(engine.convert({ ...request, input: { kind: "stream", source: [new Uint8Array()] } },
    { signal: new AbortController().signal })).rejects.toMatchObject({ message: "Invalid range specified." });
  expect(selections).toHaveLength(1);
});

it.each(["A130:A$129", "A$129:A130"])("keeps mixed reference flags paired after reversed endpoint normalization: %s", async expression => {
  const { parseRangeExpression, exportRangeForSheet } = await import("../workbook/expressions.js");
  const unequal: Workbook = { ...book, sheets: [{ ...book.sheets[0]!, size: { rows: 256, columns: 256 } }, book.sheets[1]!] };
  const range = parseRangeExpression(expression, unequal, true);
  expect(range.startRowRelative).toBe(false);
  expect(range.endRowRelative).toBeUndefined();
  const result = exportRangeForSheet(range, unequal, "active")!;
  expect(result).toMatchObject({ startRow: 1, endRow: 128, endRowRelative: false });
  expect(result.startRowRelative).toBeUndefined();
});
