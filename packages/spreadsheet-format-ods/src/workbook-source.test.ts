import { describe, expect, it } from "vitest";
import { createOdfStreamWriter, createOdfWriter } from "./odf.js";
import { defaultSsconvertLimits } from "@poe-code/spreadsheet-engine";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { Workbook, Cell } from "@poe-code/spreadsheet-ast";

function context(signal = new AbortController().signal) {
  const backing = new Uint8Array(1024 * 1024); let end = 8, closed = 0;
  const context: CapabilityContext = { signal, limits: defaultSsconvertLimits, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {},
    createWorkingStorage() { return {
      allocate(length) { const position = end; end += length; expect(end).toBeLessThan(backing.length); return position; },
      async read(position, length) { expect(length).toBeLessThanOrEqual(16384); return backing.subarray(position, position + length); },
      async write(position, bytes) { expect(bytes.length).toBeLessThanOrEqual(16384); backing.set(bytes, position); },
      async close() { closed++; }
    }; }
  };
  return { context, closed: () => closed };
}
async function collect(source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>) {
  const chunks = []; for await (const chunk of source) chunks.push(chunk.slice());
  return Buffer.concat(chunks);
}

it.each(["strict", "extended"] as const)("preserves ODF %s metadata, style overlays and diagnostics with replayed cells", async edition => {
  const book: Workbook = { sheets: [
    { id: "s", name: "Styled", cells: [{ row: 1, column: 1, value: { kind: "number", value: 42 } }],
      unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Styles", disposition: "retained", data: {
        name: "Styles", children: [{ name: "StyleRegion", attributes: { startRow: "0", endRow: "2", startCol: "0", endCol: "2" },
          children: [{ name: "Style", attributes: { Format: "0.00" }, children: [] }] }]
      } }, { source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: {
        name: "Objects", children: [
          { name: "CellComment", attributes: { ObjectBound: "A1", Author: "Author", Text: "empty-cell comment" } },
          { name: "SheetObjectGraph", children: [] }
        ]
      } }, { source: "Gnumeric_OpenCalc:openoffice", kind: "annotation", disposition: "retained", data: {
        row: 5, column: 2, xml: { name: "annotation", namespace: "urn:oasis:names:tc:opendocument:xmlns:office:1.0", attributes: [], children: [] }
      } }, { source: "Gnumeric_OpenCalc:openoffice", kind: "detective", disposition: "retained", data: {
        row: 7, column: 1, xml: { name: "detective", namespace: "urn:oasis:names:tc:opendocument:xmlns:table:1.0", attributes: [], children: [] }
      } }] },
    { id: "reserved", name: "Reserved", cells: [{ row: 0, column: 0, value: { kind: "number", value: 7 },
      style: { odf: { name: "style", namespace: "urn:oasis:names:tc:opendocument:xmlns:style:1.0", attributes: [
        { name: "name", namespace: "urn:oasis:names:tc:opendocument:xmlns:style:1.0", value: "ce0" }
      ], children: [] } } }] },
    { id: "t", name: "Warnings", cells: [{ row: 3, column: 2, value: { kind: "string", value: "é🦀" },
      style: { gnumeric: { name: "Style", children: [{ name: "InputMessage", children: [] }] } } }] }
  ] };
  const expectedWarnings: string[] = [], actualWarnings: string[] = [];
  const reference = context(), actual = context();
  const expected = await createOdfWriter(edition)(book, [], { ...reference.context, async diagnostic(d) { expectedWarnings.push(d.message); } });
  let opened = 0, closed = 0;
  const source = { metadata: { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, cells: [] })) },
    async *cells(id: string) { opened++; try { yield* book.sheets.find(sheet => sheet.id === id)!.cells; } finally { closed++; } }
  };
  expect(await collect(createOdfStreamWriter(edition)(source, [], { ...actual.context, async diagnostic(d) { actualWarnings.push(d.message); } }))).toEqual(Buffer.from(expected));
  expect(actualWarnings).toEqual(expectedWarnings); expect(actualWarnings.some(w => w.includes("SheetObjectGraph"))).toBe(true);
  expect(opened).toBeGreaterThan(2); expect(closed).toBe(opened); expect(actual.closed()).toBe(1);
});

describe.each([4, 5])("source pass %i", failPass => {
it.each(["failure", "cancel", "moved", "shorter", "longer"])("closes source replays and staging after %s", async mode => {
  const controller = new AbortController(), reason = new Error("replay failed"), runtime = context(controller.signal);
  let opened = 0, closed = 0;
  const source = { metadata: { sheets: [{ id: "s", name: "Data", cells: [] }] }, async *cells(): AsyncGenerator<Cell> {
    const pass = ++opened;
    try {
      if (mode === "shorter" && pass >= failPass) return;
      yield { row: mode === "moved" && pass === failPass ? 1 : 0, column: 0, value: { kind: "string", value: "hello" } };
      if (mode === "longer" && pass >= failPass) yield { row: 2, column: 0, value: { kind: "number", value: 1 } };
      if (pass === failPass && mode === "failure") throw reason;
      if (pass === failPass && mode === "cancel") controller.abort(reason);
    } finally { closed++; }
  } };
  const result = collect(createOdfStreamWriter("extended")(source, [], runtime.context));
  if (mode === "failure" || mode === "cancel") await expect(result).rejects.toBe(reason);
  else await expect(result).rejects.toThrow("changed during replay");
  expect(closed).toBe(opened); expect(runtime.closed()).toBe(1);
});

});

it("keeps captured mutable SDK cells and last duplicate coordinates during backing writes", async () => {
  const cells: Cell[] = Array.from({ length: 130 }, (_, row) => ({ row, column: 0, value: { kind: "number", value: row } }));
  cells.push({ row: 0, column: 0, value: { kind: "string", value: "last duplicate" } });
  const book = { sheets: [{ id: "s", name: "Data", cells }] };
  const reference = context();
  const expected = await createOdfWriter("strict")(book, [], reference.context);
  const runtime = context();
  const acquire = runtime.context.createWorkingStorage!;
  let changed = false;
  const actual = await collect(createOdfStreamWriter("strict")(book, [], { ...runtime.context,
    createWorkingStorage() {
      const storage = acquire(), read = storage.read.bind(storage);
      return { ...storage, async read(position, length) {
        if (!changed) {
          changed = true;
          cells[129] = { row: 129, column: 0, value: { kind: "string", value: "replacement" } };
          cells[130] = { row: 0, column: 0, value: { kind: "string", value: "replacement duplicate" } };
        }
        return read(position, length);
      } };
    }
  }));
  expect(changed).toBe(true); expect(actual).toEqual(Buffer.from(expected));
});


it("supports a replayable empty workbook without working storage", async () => {
  const runtime = context();
  const { createWorkingStorage, ...plain } = runtime.context; void createWorkingStorage;
  const book = { sheets: [{ id: "s", name: "Empty", cells: [] }] };
  const expected = await createOdfWriter("strict")(book, [], plain);
  const source = { metadata: book, async *cells(): AsyncGenerator<Cell> {} };
  expect(await collect(createOdfStreamWriter("strict")(source, [], plain))).toEqual(Buffer.from(expected));
});

it("enforces the aggregate cell limit while reserving source styles", async () => {
  const runtime = context(), passes = new Map<string, number>();
  const source = { metadata: { sheets: ["a", "b"].map(id => ({ id, name: id, cells: [] })) },
    async *cells(id: string): AsyncGenerator<Cell> {
      const pass = (passes.get(id) ?? 0) + 1; passes.set(id, pass);
      if (pass > 2) throw new Error("indexing began before aggregate source admission");
      yield { row: 0, column: 0, value: { kind: "number", value: 1 } };
      if (pass === 2) yield { row: 1, column: 0, value: { kind: "number", value: 2 } };
    }
  };
  await expect(collect(createOdfStreamWriter("strict")(source, [], {
    ...runtime.context, limits: { ...runtime.context.limits, cells: 3 }
  }))).rejects.toMatchObject({ code: "resource-limit" });
  expect(runtime.closed()).toBe(1);
});
