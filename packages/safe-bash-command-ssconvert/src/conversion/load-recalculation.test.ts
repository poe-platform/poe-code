import { expect, it } from "vitest";
import proof from "../../../../docs/ssconvert/python-loader-diagnostics-native.json" with { type: "json" };
import { createEngine, createPythonSampleFunctions, type EngineConfig, type ConversionRequest } from "../index.js";

const config: EngineConfig = { codecs: [], runtimeFunctions: createPythonSampleFunctions({ unicodeVersion: "15.1.0" }),
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
function source(formulas: string[], manual = false) {
  return new TextEncoder().encode('<Workbook xmlns="http://www.gnumeric.org/v10.dtd">' +
    (manual ? '<Calculation ManualRecalc="1"/>' : "") + '<Sheets><Sheet><Name>S</Name><Cells>' +
    formulas.map((formula, row) => `<Cell Row="${row}" Col="0">${formula}</Cell>`).join("") +
    '</Cells></Sheet></Sheets></Workbook>');
}
function request(input: Uint8Array, chunks: Uint8Array[], recalc = false): ConversionRequest {
  return { input: { kind: "stream", filename: "input.gnumeric", source: [input] }, recalc,
    exportType: "Gnumeric_stf:stf_csv", destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } };
}

it.each(proof.cases)("retains native load and forced-recalculation warnings: $id", async fixture => {
  const engine = createEngine(config), chunks: Uint8Array[] = [];
  try {
    const result = await engine.convert(request(source(fixture.formulas), chunks, fixture.recalc), { signal: new AbortController().signal });
    expect(result.exitCode).toBe(fixture.exitCode);
    expect(result.diagnostics).toHaveLength(fixture.warnings);
    expect(result.diagnostics.every(d => d.code === "python-loader" && d.message === "gnm_value_to_py_obj: unsupported value type")).toBe(true);
    expect(chunks.map(bytes => new TextDecoder().decode(bytes)).join("")).toBe(fixture.csv);
  } finally { await engine.dispose(); }
});

it("evaluates imported dirty cells before an update replaces their formula", async () => {
  const engine = createEngine(config), chunks: Uint8Array[] = [];
  try {
    const result = await engine.convert({ ...request(source(["=PY_BITAND(-1,3)"]), chunks), updateExpressions: ["A1=7"] }, { signal: new AbortController().signal });
    expect(result.diagnostics).toHaveLength(1);
    expect(chunks.map(bytes => new TextDecoder().decode(bytes)).join("")).toBe("7\n");
  } finally { await engine.dispose(); }
});

it("loads dirty manual-mode formulas while keeping raw readWorkbook free of calculation", async () => {
  const engine = createEngine(config), chunks: Uint8Array[] = [];
  try {
    const input = source(['=PY_PRINTF("%s",NA())'], true);
    const raw = await engine.readWorkbook({ kind: "stream", filename: "input.gnumeric", source: [input] }, {}, { signal: new AbortController().signal });
    expect(raw.calculationMode).toBe("manual");
    expect(raw.sheets[0]!.cells[0]!.formulaDirty).toBe(true);
    const result = await engine.convert(request(input, chunks), { signal: new AbortController().signal });
    expect(result.diagnostics).toHaveLength(1);
    expect(chunks.map(bytes => new TextDecoder().decode(bytes)).join("")).toBe("None\n");
  } finally { await engine.dispose(); }
});

it("bounds combined load/recalc warnings before publishing output", async () => {
  const engine = createEngine({ ...config, limits: { ...config.limits, outputBytes: 50 } }), chunks: Uint8Array[] = [];
  try {
    await expect(engine.convert(request(source(["=PY_BITAND(-1,3)"]), chunks, true), { signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "resource-limit" });
    expect(chunks).toEqual([]);
  } finally { await engine.dispose(); }
});

it("preserves cancellation at the initial warning before updates or export", async () => {
  const engine = createEngine(config), chunks: Uint8Array[] = [], controller = new AbortController(), reason = new Error("cancel load warning");
  try {
    await expect(engine.convert({ ...request(source(["=PY_BITAND(-1,3)"]), chunks, true), updateExpressions: ["A1=7"] }, {
      signal: controller.signal, async diagnostic() { controller.abort(reason); }
    })).rejects.toBe(reason);
    expect(chunks).toEqual([]);
  } finally { await engine.dispose(); }
});

it.each([false, true])("avoids an extra clean volatile pass after loading (force=%s)", async recalc => {
  let calls = 0;
  const engine = createEngine({ ...config, random: { next() { return ++calls / 10; } } }), chunks: Uint8Array[] = [];
  try {
    await engine.convert(request(source(["=RAND()"]), chunks, recalc), { signal: new AbortController().signal });
    expect(calls).toBe(recalc ? 2 : 1);
    expect(chunks.map(bytes => new TextDecoder().decode(bytes)).join("")).toBe(recalc ? "0.2\n" : "0.1\n");
  } finally { await engine.dispose(); }
});
