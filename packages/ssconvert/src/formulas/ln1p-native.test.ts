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
