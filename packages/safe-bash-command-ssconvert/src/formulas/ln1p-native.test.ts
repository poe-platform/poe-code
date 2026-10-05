import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "./evaluator.js";
import { mathFunctions } from "./functions/math.js";
import type { FunctionHost, Value } from "./functions/types.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
 environment: { env: {}, locale: "C", timezone: "UTC" },
 limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 10000 } };
// Native HEXREP results also independently match a220-digit Decimal log reference.
const fixtures = [
 {"expression": "0.33688260287586475", "native": "0x1.294f0450c0973p-2"},
 {"expression": "0.5970989573261564", "native": "0x1.df6ce4a42bd55p-2"},
 {"expression": "0.22690015107295408", "native": "0x1.a2cc10afdeaf1p-3"},
 {"expression": "0.0", "native": "0x0p+0"},
 {"expression": "-0.0", "native": "0x0p+0"},
 {"expression": "-1.0", "native": "#NUM!"},
 {"expression": "-2.0", "native": "#NUM!"},
 {"expression": "-0.9999999999999999", "native": "-0x1.25e4f7b2737fap+5"},
 {"expression": "2.7755575615628914e-17", "native": "0x1p-55"},
 {"expression": "-2.7755575615628914e-17", "native": "-0x1p-55"},
 {"expression": "1.0", "native": "0x1.62e42fefa39efp-1"},
 {"expression": "2.0", "native": "0x1.193ea7aad030bp+0"},
 {"expression": "1e+308", "native": "0x1.62991d5d62a5ep+9"},
 ];
it.each(fixtures)("preserves native LN1P bits for $expression", ({ expression, native }) => {
 const book = { sheets: [{ id: "s", name: "Here", cells: [{ row: 0, column: 0,
  formula: `=HEXREP(LN1P(${expression}))`, formulaDirty: true, value: { kind: "number" as const, value: 0 } }] }] };
 const value = recalculateWorkbook(book, context).sheets[0]!.cells[0]!.value;
 expect(value).toEqual(native === "#NUM!" ? { kind: "error", value: native } : { kind: "string", value: native });
});
it("observes work/cancellation while evaluating LN1P without consuming further work", () => {
 const reason = new Error("stop LN1P series"); let ticks = 0;
 const host = { scalar(value: Value) { return value; }, tick() { if (++ticks === 4) throw reason; } } as unknown as FunctionHost;
 expect(() => mathFunctions.LN1P!([{ kind: "number", value: .33688260287586475 }], host)).toThrow(reason);
 expect(ticks).toBe(4);
});

// Exact binary64 inputs; independent 500-digit Decimal ln(1+x) rounds to these
// public values. Linux AArch64 glibc 2.41 differs by one ULP at both inputs.
it.each([
 { input: 2, rounded: "3ff193ea7aad030b", linux: "3ff193ea7aad030a" },
 { input: -1.8626451492309568e-9, rounded: "be20000000400000", linux: "be200000003fffff" }
])("distinguishes LN1P mathematical rounding from the Linux kernel at $input", async ({ input, rounded, linux }) => {
 const { capturedLog1p } = await import("./functions/captured-log1p.js");
 const bits = (value: number) => {
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value);
  return view.getBigUint64(0).toString(16).padStart(16, "0");
 };
 const host = { scalar(value: Value) { return value; }, tick() {} } as unknown as FunctionHost;
 const result = mathFunctions.LN1P!([{ kind: "number", value: input }], host);
 expect(result.kind).toBe("number");
 if (result.kind !== "number") throw new Error("Expected numeric LN1P result");
 expect(bits(result.value)).toBe(rounded);
 expect(bits(capturedLog1p(input))).toBe(linux);
});
