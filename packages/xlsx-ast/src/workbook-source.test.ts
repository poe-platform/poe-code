import { expect, it } from "vitest";
import { createXlsxStreamWriter, createXlsxWriter } from "./xlsx.js";
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

it.each(["2006", "2008"] as const)("preserves XLSX %s metadata, style overlays and diagnostics with replayed cells", async edition => {
  const book: Workbook = { sheets: [
    { id: "s", name: "Styled", cells: [{ row: 1, column: 1, value: { kind: "number", value: 42 } }],
      unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Styles", disposition: "retained", data: {
        name: "Styles", children: [{ name: "StyleRegion", attributes: { startRow: "0", endRow: "2", startCol: "0", endCol: "2" },
          children: [{ name: "Style", attributes: { Format: "0.00" }, children: [] }] }]
      } }] },
    { id: "t", name: "Warnings", cells: [{ row: 3, column: 2, value: { kind: "string", value: "é🦀" },
      style: { gnumeric: { name: "Style", children: [{ name: "InputMessage", children: [] }] } } }] }
  ] };
  const expectedWarnings: string[] = [], actualWarnings: string[] = [];
  const reference = context(), actual = context();
  const expected = await createXlsxWriter(edition)(book, [], { ...reference.context, async diagnostic(d) { expectedWarnings.push(d.message); } });
  let opened = 0, closed = 0;
  const source = { metadata: { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, cells: [] })) },
    async *cells(id: string) { opened++; try { yield* book.sheets.find(sheet => sheet.id === id)!.cells; } finally { closed++; } }
  };
  expect(await collect(createXlsxStreamWriter(edition)(source, [], { ...actual.context, async diagnostic(d) { actualWarnings.push(d.message); } }))).toEqual(Buffer.from(expected));
  expect(actualWarnings).toEqual(expectedWarnings); expect(actualWarnings.some(w => w.includes("InputMessage"))).toBe(true);
  expect(opened).toBeGreaterThan(2); expect(closed).toBe(opened); expect(actual.closed()).toBe(1);
});

it.each(["failure", "cancel", "moved", "shorter", "longer"])("closes source replays and staging after %s", async mode => {
  const controller = new AbortController(), reason = new Error("replay failed"), runtime = context(controller.signal);
  let opened = 0, closed = 0;
  const source = { metadata: { sheets: [{ id: "s", name: "Data", cells: [] }] }, async *cells(): AsyncGenerator<Cell> {
    const pass = ++opened;
    try {
      if (mode === "shorter" && pass >= 3) return;
      yield { row: mode === "moved" && pass === 4 ? 1 : 0, column: 0, value: { kind: "string", value: "hello" } };
      if (mode === "longer" && pass >= 3) yield { row: 2, column: 0, value: { kind: "number", value: 1 } };
      if (pass === 4 && mode === "failure") throw reason;
      if (pass === 4 && mode === "cancel") controller.abort(reason);
    } finally { closed++; }
  } };
  const result = collect(createXlsxStreamWriter("2008")(source, [], runtime.context));
  if (mode === "failure" || mode === "cancel") await expect(result).rejects.toBe(reason);
  else await expect(result).rejects.toThrow("changed during replay");
  expect(closed).toBe(opened); expect(runtime.closed()).toBe(1);
});
