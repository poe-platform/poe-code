import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { snapshotRuntimeFunctions, type RuntimeFunctions } from "./runtime-functions.js";
import { createEngine } from "../engine.js";
import type { Codec } from "../codecs.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100 }, own() {}
};
const book = (formula: string): Workbook => ({ sheets: [{ id: "s", name: "Sheet1", cells: [
  { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "blank" } }
] }] });

it("evaluates an explicitly injected optional function in the ordinary calculation namespace", () => {
  const extended = { ...context, runtimeFunctions: { PERL_ADDER: { signature: "ff", implementation: (args: readonly unknown[]) => {
    const values = args as readonly { kind: "number"; value: number }[];
    return { kind: "number" as const, value: values[0]!.value + values[1]!.value };
  } } } };
  expect(recalculateWorkbook(book('=PERL_ADDER("17",22)'), extended).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "number", value: 39 });
  expect(recalculateWorkbook(book("=PERL_ADDER(17,22)"), context).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#NAME?" });
});

it("rejects accessors and inherited definition fields without executing accessors", () => {
  let reads = 0;
  const accessor = { get PORTED() { reads++; return { signature: "", implementation: () => ({ kind: "blank" }) }; } };
  expect(() => snapshotRuntimeFunctions(accessor as RuntimeFunctions)).toThrow(TypeError);
  expect(reads).toBe(0);
  const definition = { get signature() { reads++; return ""; }, implementation: () => ({ kind: "blank" as const }) };
  expect(() => snapshotRuntimeFunctions({ PORTED: definition })).toThrow(TypeError);
  expect(reads).toBe(0);
  expect(() => snapshotRuntimeFunctions({ PORTED: Object.create({ signature: "", implementation: () => ({ kind: "blank" }) }) })).toThrow(TypeError);
});

it("keeps inherited functions out of the namespace and rejects built-in collisions", () => {
  const inherited = Object.create({ PORTED: { signature: "", implementation: () => ({ kind: "number", value: 9 }) } }) as RuntimeFunctions;
  expect(Object.keys(snapshotRuntimeFunctions(inherited))).toEqual([]);
  for (const name of ["SUM", "PRODUCT", "GNUMERIC_VERSION", "IF", "RAND", "TABLE", "IFERROR", "IFNA"])
    expect(() => snapshotRuntimeFunctions({ [name]: { signature: "", implementation: () => ({ kind: "blank" }) } })).toThrow("conflicting");
});

it("owns returned records and rejects malformed provider results", () => {
  const result = { kind: "number" as const, value: 7 };
  const extended = { ...context, runtimeFunctions: { PORTED: { signature: "", implementation: () => result } } };
  const calculated = recalculateWorkbook(book("=PORTED()"), extended);
  result.value = 99;
  expect(calculated.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
  for (const invalid of [undefined, Promise.resolve({ kind: "blank" }), { kind: "matrix", rows: [] }, { kind: "number", value: "7" }]) {
    const functions = { PORTED: { signature: "", implementation: () => invalid } } as unknown as RuntimeFunctions;
    expect(() => recalculateWorkbook(book("=PORTED()"), { ...context, runtimeFunctions: functions })).toThrow();
  }
});

it("captures provider definitions before caller mutation", () => {
  const definition = { signature: "", implementation: () => ({ kind: "number" as const, value: 7 }) };
  const captured = snapshotRuntimeFunctions({ PORTED: definition });
  definition.signature = "ff";
  definition.implementation = () => ({ kind: "number", value: 99 });
  expect(Object.isFrozen(captured)).toBe(true);
  expect(Object.isFrozen(captured.PORTED)).toBe(true);
  expect(recalculateWorkbook(book("=PORTED()"), { ...context, runtimeFunctions: captured }).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "number", value: 7 });
});

it("captures extensions at the shared engine boundary before byte I/O", async () => {
  const definition = { signature: "", implementation: () => ({ kind: "number" as const, value: 7 }) };
  let written: Workbook | undefined;
  const codec: Codec = { id: "optional-fixture", description: "In-memory optional fixture", extensions: ["fixture"],
    probeContent: () => true, async read() { return book("=PORTED()"); },
    async write(calculated) { written = calculated; return new Uint8Array([55]); }
  };
  const engine = createEngine({ limits: context.limits, environment: context.environment, codecs: [codec], runtimeFunctions: { PORTED: definition } });
  definition.signature = "ff";
  definition.implementation = () => ({ kind: "number", value: 99 });
  const bytes: number[] = [];
  try {
    const result = await engine.convert({ input: { kind: "stream", source: [new Uint8Array([1])], filename: "input.fixture" },
      exportType: "optional-fixture", destination: { kind: "stream", sink: { async write(chunk) { bytes.push(...chunk); } } } }, { signal: context.signal });
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
    expect(bytes).toEqual([55]);
    expect(written!.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
  } finally { await engine.dispose(); }
});

it("observes cancellation after provider execution and bounds cooperative work", () => {
  const controller = new AbortController(), reason = new Error("stop provider");
  const aborted = { ...context, signal: controller.signal, runtimeFunctions: { PORTED: { signature: "", implementation: () => {
    controller.abort(reason); return { kind: "blank" as const };
  } } } };
  expect(() => recalculateWorkbook(book("=PORTED()"), aborted)).toThrow(reason);
  const bounded = { ...context, limits: { ...context.limits, workbookWork: 100 }, runtimeFunctions: { PORTED: { signature: "", implementation: (_args: unknown, host: { tick(): void }) => {
    for (let i = 0; i < 101; i++) host.tick();
    return { kind: "blank" as const };
  } } } };
  expect(() => recalculateWorkbook(book("=PORTED()"), bounded)).toThrow("work limit exceeded");
});

it("ports source-shipped arithmetic and delegated Python BITAND only when enabled", async () => {
  const { perlSampleFunctions, pythonSampleFunctions } = await import("./optional-providers.js");
  const extended = { ...context, runtimeFunctions: { ...perlSampleFunctions, ...pythonSampleFunctions } };
  for (const [formula, value] of [["=PERL_ADDER(17,22)", 39], ["=PY_BITAND(12,6)", 4], ["=PY_BITAND(4294967297,4294967297)", 4294967297]] as const)
    expect(recalculateWorkbook(book(formula), extended).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value });
  expect(recalculateWorkbook(book("=PERL_ADDER(1)"), extended).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#N/A" });
  expect(recalculateWorkbook(book('=PERL_ADDER("bad",2)'), extended).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#VALUE!" });
});

it("keeps absent custom names as cell errors without namespace leakage", () => {
  for (const formula of ["=UNKNOWN_CUSTOM()", "=CONSTRUCTOR()", "=TOSTRING()", "=HASOWNPROPERTY()", "=PORTED()"])
    expect(recalculateWorkbook(book(formula), context).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#NAME?" });
  const extended = { ...context, runtimeFunctions: { PORTED: { signature: "", implementation: () => ({ kind: "number" as const, value: 7 }) } } };
  expect(recalculateWorkbook(book("=PORTED()"), extended).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
  expect(recalculateWorkbook(book("=PORTED()"), context).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#NAME?" });
});

it("preserves special-form ordering and errors around absent functions", () => {
  const value = (formula: string) => recalculateWorkbook(book(formula), context).sheets[0]!.cells[0]!.value;
  expect(value("=IF(TRUE,7,UNKNOWN_CUSTOM())")).toEqual({ kind: "number", value: 7 });
  expect(value("=IF(FALSE,7,UNKNOWN_CUSTOM())")).toEqual({ kind: "error", value: "#NAME?" });
  expect(value("=IFERROR(UNKNOWN_CUSTOM(),8)")).toEqual({ kind: "number", value: 8 });
  expect(value("=IFNA(UNKNOWN_CUSTOM(),8)")).toEqual({ kind: "error", value: "#NAME?" });
  expect(value("=SUM(UNKNOWN_CUSTOM(),1)")).toEqual({ kind: "error", value: "#NAME?" });
  expect(value("=GNUMERIC_VERSION()")).toEqual({ kind: "string", value: "1.12.61" });
  expect(() => value("=RAND()")).toThrow("explicit random source");
});

it("retains workbook budget and cancellation admission for absent function calls", () => {
  expect(() => recalculateWorkbook(book("=UNKNOWN_CUSTOM()"), { ...context, limits: { ...context.limits, workbookWork: 0 } }))
    .toThrow("work limit exceeded");
  const controller = new AbortController(), reason = new Error("abort absent namespace");
  controller.abort(reason);
  expect(() => recalculateWorkbook(book("=UNKNOWN_CUSTOM()"), { ...context, signal: controller.signal })).toThrow(reason);
});

it("preserves Perl loader boolean-to-integer conversion in typed sample addition", async () => {
  const { perlSampleFunctions } = await import("./optional-providers.js");
  expect(recalculateWorkbook(book("=PERL_ADDER(TRUE,2)"), { ...context, runtimeFunctions: perlSampleFunctions }).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "number", value: 3 });
});

it("ports PERL_DATE using the injected clock and timezone without enabling absent names", async () => {
  const { perlSampleFunctions } = await import("./optional-providers.js");
  const now = Date.UTC(2024, 1, 29, 0, 30);
  const supplied = { ...context, runtimeFunctions: perlSampleFunctions, clock: { now: () => now } };
  const calculate = (formula: string, selected = supplied) =>
    recalculateWorkbook(book(formula), selected).sheets[0]!.cells[0]!.value;
  expect(calculate("=PERL_DATE()")).toEqual({ kind: "string", value: "20240229" });
  expect(calculate("=PERL_DATE()", { ...supplied, environment: { ...context.environment, timezone: "America/Los_Angeles" } }))
    .toEqual({ kind: "string", value: "20240228" });
  expect(calculate("=PERL_DATE(1)")).toEqual({ kind: "error", value: "#N/A" });
  expect(calculate("=PERL_DATE()", { ...supplied, runtimeFunctions: {} }))
    .toEqual({ kind: "error", value: "#NAME?" });
  expect(() => recalculateWorkbook(book("=PERL_DATE()"), { ...context, runtimeFunctions: perlSampleFunctions }))
    .toThrow("explicit clock");
  expect(() => calculate("=PERL_DATE()", { ...supplied, clock: { now: () => NaN } }))
    .toThrow("Invalid ssconvert clock result");
  expect(() => calculate("=PERL_DATE()", { ...supplied, clock: { now: () => 8640000000000001 } }))
    .toThrow("Invalid ssconvert clock result");
  expect(() => calculate("=PERL_DATE()", { ...supplied, limits: { ...context.limits, outputBytes: 7 } }))
    .toThrow("text limit");
});

it("retains typed optional sample coercion and outer arithmetic error propagation", async () => {
  const { perlSampleFunctions, pythonSampleFunctions } = await import("./optional-providers.js");
  const extended = { ...context, runtimeFunctions: { ...perlSampleFunctions, ...pythonSampleFunctions } };
  const value = (formula: string) => recalculateWorkbook(book(formula), extended).sheets[0]!.cells[0]!.value;
  for (const [formula, expected] of [
    ["=PERL_ADDER(FALSE,2)", 2], ["=PERL_ADDER(TRUE,FALSE)", 1], ["=PERL_ADDER(A2,2)", 2],
    ["=PERL_ADDER(-1.5,2.25)", .75], ['=PERL_ADDER("17",22)', 39],
    ["=PY_BITAND(TRUE,3)", 1], ["=PY_BITAND(FALSE,3)", 0], ["=PY_BITAND(A2,3)", 0],
    ['=PY_BITAND("12",6)', 4], ["=PY_BITAND(12.9,6.1)", 4]
  ] as const) expect(value(formula)).toEqual({ kind: "number", value: expected });
  for (const name of ["PERL_ADDER", "PY_BITAND"])
    for (const [argumentsText, expected] of [["1/0,2", "#DIV/0!"], ["2,1/0", "#DIV/0!"], ['"bad",2', "#VALUE!"], ["1", "#N/A"], ["1,2,3", "#N/A"]] as const)
      expect(value(`=${name}(${argumentsText})`)).toEqual({ kind: "error", value: expected });
  expect(value("=PERL_ADDER(1e308,1e308)")).toEqual({ kind: "error", value: "#NUM!" });
});

it("converts delegated Python BITAND errors to empty values with the native bridge warning", async () => {
  const { pythonSampleFunctions } = await import("./optional-providers.js");
  const diagnostics: unknown[] = [];
  const extended = { ...context, runtimeFunctions: pythonSampleFunctions };
  const input = book("=PY_BITAND(-1,3)");
  expect(recalculateWorkbook(input, extended, false, diagnostic => diagnostics.push(diagnostic)).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "blank" });
  expect(diagnostics).toEqual([{ code: "python-loader", severity: "warning", message: "gnm_value_to_py_obj: unsupported value type" }]);
  expect(input.sheets[0]!.cells[0]!.value).toEqual({ kind: "blank" });
  expect(input.sheets[0]!.cells[0]!.formulaDirty).toBe(true);
  diagnostics.length = 0;
  for (const [formula, error] of [["=BITAND(-1,3)", "#VALUE!"], ["=PY_BITAND(NA(),3)", "#N/A"],
    ['=PY_BITAND("bad",3)', "#VALUE!"], ["=PY_BITAND(3)", "#N/A"]] as const)
    expect(recalculateWorkbook(book(formula), extended, false, diagnostic => diagnostics.push(diagnostic)).sheets[0]!.cells[0]!.value)
      .toEqual({ kind: "error", value: error });
  expect(diagnostics).toEqual([]);
  expect(recalculateWorkbook(book("=A2"), extended).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 0 });
  const referenced: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    ...book("=PY_BITAND(-1,3)").sheets[0]!.cells,
    { row: 0, column: 1, formula: "=A1", formulaDirty: true, value: { kind: "blank" } }
  ] }] };
  expect(recalculateWorkbook(referenced, extended).sheets[0]!.cells.map(cell => cell.value))
    .toEqual([{ kind: "blank" }, { kind: "number", value: 0 }]);
});

it("preserves cancellation triggered by the Python bridge warning", async () => {
  const { pythonSampleFunctions } = await import("./optional-providers.js");
  for (const reason of [null, false, 0, "", NaN]) {
    const controller = new AbortController();
    let caught: unknown = Symbol("not thrown");
    try {
      recalculateWorkbook(book("=PY_BITAND(-1,3)"), { ...context, signal: controller.signal, runtimeFunctions: pythonSampleFunctions },
        false, () => controller.abort(reason));
    } catch (error) { caught = error; }
    expect(caught).toBe(reason);
  }
});

it("retains empty Python bridge slots beside valid array results", async () => {
  const { pythonSampleFunctions } = await import("./optional-providers.js");
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [], formulaGroups: [
    { id: "a", kind: "array", expression: "=PY_BITAND({12,-1,7},3)",
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 2 } }
  ] }] };
  const diagnostics: unknown[] = [];
  expect(recalculateWorkbook(input, { ...context, runtimeFunctions: pythonSampleFunctions }, true,
    diagnostic => diagnostics.push(diagnostic)).sheets[0]!.cells.map(cell => cell.value))
    .toEqual([{ kind: "number", value: 0 }, { kind: "blank" }, { kind: "number", value: 3 }]);
  expect(diagnostics).toHaveLength(1);
  expect(input.sheets[0]!.cells).toEqual([]);
});

it("snapshots owned repeated-argument metadata without executing getters", () => {
  let reads = 0;
  const definition = { signature: "", rest: "f" as "f" | "?", implementation: () => ({ kind: "blank" as const }) };
  const captured = snapshotRuntimeFunctions({ PORTED: definition });
  definition.rest = "?";
  expect(captured.PORTED!.rest).toBe("f");
  const accessor = { signature: "", implementation: definition.implementation, get rest() { reads++; return "f" as const; } };
  expect(() => snapshotRuntimeFunctions({ PORTED: accessor })).toThrow(TypeError);
  expect(reads).toBe(0);
  for (const rest of ["", "ff", "|", "x", 7, null])
    expect(() => snapshotRuntimeFunctions({ PORTED: { ...definition, rest } } as unknown as RuntimeFunctions)).toThrow(TypeError);
  const inherited = Object.assign(Object.create({ rest: "?" }), { signature: "", implementation: definition.implementation });
  expect(snapshotRuntimeFunctions({ PORTED: inherited }).PORTED!.rest).toBeUndefined();
});

it("coerces repeated typed arguments while retaining fixed minimum arity and blank operands", () => {
  const extended = { ...context, runtimeFunctions: { PORTED: { signature: "f", rest: "f" as const,
    implementation: (args: readonly unknown[]) => ({ kind: "string" as const, value: JSON.stringify(args) }) } } };
  const value = (formula: string) => recalculateWorkbook(book(formula), extended).sheets[0]!.cells[0]!.value;
  expect(value("=PORTED()")).toEqual({ kind: "error", value: "#N/A" });
  expect(value('=PORTED(1,"2",A2)')).toEqual({ kind: "string", value: JSON.stringify([
    { kind: "number", value: 1 }, { kind: "number", value: 2 }, { kind: "number", value: 0 }
  ]) });
  expect(value('=PORTED(1,"bad")')).toEqual({ kind: "error", value: "#VALUE!" });
  expect(value("=PORTED(1,1/0)")).toEqual({ kind: "error", value: "#DIV/0!" });
});

it("passes repeated untyped arrays, references and errors to the cooperative provider", () => {
  const extended = { ...context, runtimeFunctions: { PORTED: { signature: "", rest: "?" as const,
    implementation: (args: readonly unknown[]) => ({ kind: "string" as const,
      value: (args as readonly { kind: string }[]).map(value => value.kind).join(",") }) } } };
  expect(recalculateWorkbook(book("=PORTED({1,2},A2:B3,1/0,A2)"), extended).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "string", value: "matrix,range,error,blank" });
  const controller = new AbortController();
  controller.abort(new Error("stop repeated provider"));
  expect(() => recalculateWorkbook(book("=PORTED(1,2,3)"), { ...extended, signal: controller.signal }))
    .toThrow("stop repeated provider");
});
