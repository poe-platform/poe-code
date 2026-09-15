import { expect, it } from "vitest";
import { createRuntimePercentConversionContext } from "./runtime-percent-conversion.js";
import { percentFloat } from "./percent-float-conversion.js";
import { percentInteger } from "./percent-integer-conversion.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  return { meter, v };
}
it("converts native float, integer and bool operands without parsing text", () => {
  const { meter, v } = fixture(), context = createRuntimePercentConversionContext(meter);
  for (const number of [-0, 2.5, Infinity, -Infinity, NaN]) expect(percentFloat(v.float(number), false, context, meter)).toBe(number);
  expect(percentFloat(v.integer(7), false, context, meter)).toBe(7);
  expect(percentFloat(v.true, true, context, meter)).toBe(1);
  for (const [value, name] of [[v.string("2.5"), "str"], [v.bytes(Uint8Array.of(50)), "bytes"], [v.none, "NoneType"], [v.notImplemented, "NotImplementedType"]] as const) {
    expect(() => percentFloat(value, false, context, meter)).toThrow(`must be real number, not ${name}`);
    expect(() => percentFloat(value, true, context, meter)).toThrow(`float argument required, not ${name}`);
  }
});
it("keeps float subclass payload rules distinct for integer and float formatting", () => {
  const { meter, v } = fixture(), source = v.cell({}), calls: string[] = [];
  const hooks = {
    floating(value: unknown) { expect(this).toBe(hooks); return value === source ? 2.5 : undefined; },
    lookupFloat() { throw Error("float subclass override must be bypassed"); },
    lookupInt(value: unknown) { return value === source ? () => { calls.push("int"); return v.integer(9); } : undefined; },
    warn: () => {}
  };
  const context = createRuntimePercentConversionContext(meter, hooks);
  expect(percentFloat(source, false, context, meter)).toBe(2.5);
  expect(percentInteger(source, 100, context, meter)).toBe(9n);
  expect(calls).toEqual(["int"]);
});
it("honors guest float and index slots and warning hook ownership", () => {
  const { meter, v } = fixture(), source = v.cell({}), subclass = v.cell({}), warnings: string[] = [];
  const hooks = {
    floating: (value: unknown) => value === subclass ? 4.5 : undefined,
    lookupFloat(value: unknown) { expect(this).toBe(hooks); return value === source ? () => subclass : undefined; },
    lookupIndex: () => () => v.integer(3),
    typeName: (value: unknown) => value === subclass ? "F" : "C",
    warn(_category: string, message: string) { expect(this).toBe(hooks); warnings.push(message); }
  };
  const context = createRuntimePercentConversionContext(meter, hooks);
  expect(percentFloat(source, false, context, meter)).toBe(4.5);
  expect(percentFloat(v.cell({}), false, context, meter)).toBe(3);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("C.__float__ returned non-float (type F)");
});
it("does not warn for exact native float slot results", () => {
  const { meter, v } = fixture();
  const context = createRuntimePercentConversionContext(meter, { lookupFloat: () => () => v.float(2), warn: () => { throw Error("unexpected warning"); } });
  expect(percentFloat(v.cell({}), false, context, meter)).toBe(2);
});
it("classifies guest BaseException faults for bytes but preserves text exceptions", () => {
  const { meter, v } = fixture(), guest = {}, source = v.cell({});
  const hooks = {
    lookupFloat: () => () => { throw guest; },
    isPythonException(error: unknown) { expect(this).toBe(hooks); return error === guest; },
    typeName: () => "Guest", warn: () => {}
  };
  const context = createRuntimePercentConversionContext(meter, hooks);
  expect(() => percentFloat(source, true, context, meter)).toThrow("float argument required, not Guest");
  try { percentFloat(source, false, context, meter); expect.unreachable(); } catch (error) { expect(error).toBe(guest); }
});
it("checks cancellation after guest payload and slot callbacks", () => {
  const { v } = fixture();
  for (const stage of ["payload", "lookup"] as const) {
    let cancelled = false;
    const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
    const context = createRuntimePercentConversionContext(meter, {
      floating: () => { if (stage === "payload") cancelled = true; return undefined; },
      lookupFloat: () => { cancelled = true; return () => v.float(1); },
      isPythonException: () => true, warn: () => {}
    });
    expect(() => percentFloat(v.cell({}), true, context, meter)).toThrow(ExecutionLimitError);
  }
});
