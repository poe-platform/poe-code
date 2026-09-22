import { expect, it } from "vitest";
import { byteStringCases } from "./byte-string-fixtures.js";
import { recalculateWorkbook } from "./evaluator.js";
import { perlSampleFunctions } from "./optional-providers.js";
import { createEngine } from "../engine.js";
import type { CapabilityContext } from "../contracts.js";
import { rendered } from "./values.js";

const context: CapabilityContext = { own() {}, signal: new AbortController().signal,
  runtimeFunctions: perlSampleFunctions, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 1000, sheets: 3, operations: 1000 } };
it.each(byteStringCases)("retains native invalid-UTF8 scalar bytes $id", vector => {
  const book = recalculateWorkbook({ sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "blank" }, formula: "=" + vector.expressions[0], formulaDirty: true }
  ] }] }, context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "byte-string", value: vector.outputHex });
});
it("matches qualified native byte cursors, predicates, CODE, concatenation and repeated Perl calls", () => {
  const book = recalculateWorkbook({ sheets: [{ id: "s", name: "S", cells: byteStringCases.flatMap((vector, row) =>
    vector.expressions.slice(0, 10).map((expression, column) => ({ row, column, value: { kind: "blank" as const }, formula: "=" + expression, formulaDirty: true })))
  }] }, context);
  for (const cell of book.sheets[0]!.cells) {
    const value = cell.value;
    const hex = value.kind === "byte-string" ? value.value : Array.from(new TextEncoder().encode(rendered(value)), b => b.toString(16).padStart(2, "0")).join("");
    expect(hex, `${byteStringCases[cell.row]!.id} column${cell.column}`).toBe(byteStringCases[cell.row]!.downstreamHex[cell.column]);
  }
});
it("exports all38 native byte results through the public SDK without text replacement", async () => {
  const input = new TextEncoder().encode('<Workbook xmlns="http://www.gnumeric.org/v10.dtd"><Sheets><Sheet><Name>S</Name><Cells>' +
    byteStringCases.map((v, row) => `<Cell Row="${row}" Col="0">=${v.expressions[0].split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;")}</Cell>`).join("") +
    '</Cells></Sheet></Sheets></Workbook>');
  const engine = createEngine({ codecs: [], runtimeFunctions: perlSampleFunctions, environment: context.environment, limits: context.limits });
  const chunks: Uint8Array[] = [];
  try {
    const result = await engine.convert({ input: { kind: "stream", filename: "input.gnumeric", source: [input] }, recalc: true,
      exportType: "Gnumeric_stf:stf_csv", destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal: context.signal });
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
    const expected = Uint8Array.from(byteStringCases.flatMap(v => [...v.outputHex.match(/../g)!.map(h => parseInt(h, 16)), 10]));
    expect(new Uint8Array(chunks.flatMap(chunk => [...chunk]))).toEqual(expected);
  } finally { await engine.dispose(); }
});
