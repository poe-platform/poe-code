import { expect, it } from "vitest";
import { createRuntimePercentConversionContext } from "./runtime-percent-conversion.js";
import { percentCharacter } from "./percent-character-conversion.js";
import { CodePointString } from "./code-point-string.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  return { v, meter, context: createRuntimePercentConversionContext(meter) };
}
it("extracts one native string code point without combining surrogates", () => {
  const { v, meter, context } = fixture();
  expect(percentCharacter(v.string("😀"), false, context, meter)).toBe(0x1f600);
  expect(percentCharacter(v.stringPoints(Uint32Array.of(0xd800)), false, context, meter)).toBe(0xd800);
  expect(() => percentCharacter(v.stringPoints(Uint32Array.of(0xd800, 0xdc00)), false, context, meter)).toThrow("not a string of length 2");
});
it("extracts native bytes and rejects text for byte formats", () => {
  const { v, meter, context } = fixture();
  expect(percentCharacter(v.bytes(Uint8Array.of(255)), true, context, meter)).toBe(255);
  expect(() => percentCharacter(v.bytes(new Uint8Array()), true, context, meter)).toThrow("not a bytes object of length 0");
  expect(() => percentCharacter(v.string("a"), true, context, meter)).toThrow("not str");
  expect(() => percentCharacter(v.bytes(Uint8Array.of(65)), false, context, meter)).toThrow("not bytes");
});
it("uses native integer/bool ranges and rejects floats without truncation", () => {
  const { v, meter, context } = fixture();
  expect(percentCharacter(v.true, true, context, meter)).toBe(1);
  expect(percentCharacter(v.integer(256), false, context, meter)).toBe(256);
  expect(() => percentCharacter(v.integer(256), true, context, meter)).toThrow("%c arg not in range(256)");
  expect(() => percentCharacter(v.float(65), false, context, meter)).toThrow("not float");
  expect(() => percentCharacter(v.none, false, context, meter)).toThrow("not NoneType");
});
it("accepts explicit guest string and bytearray storage capabilities", () => {
  const { v, meter } = fixture(), source = v.cell({}), text = new CodePointString(Uint32Array.of(65)), bytes = ImmutableBytes.copyOf([255], meter);
  const hooks = {
    string(value: unknown) { expect(this).toBe(hooks); return value === source ? text : undefined; },
    bytes(value: unknown) { expect(this).toBe(hooks); return value === source ? { kind: "bytearray" as const, value: bytes } : undefined; },
    warn: () => {}
  };
  const context = createRuntimePercentConversionContext(meter, hooks);
  expect(percentCharacter(source, false, context, meter)).toBe(65);
  expect(percentCharacter(source, true, context, meter)).toBe(255);
});
it("preserves qualified character diagnostics without using __int__", () => {
  const { v, meter } = fixture(), source = v.cell({});
  const context = createRuntimePercentConversionContext(meter, { typeName: () => "C", qualifiedTypeName: () => "foo.Outer.Inner", lookupInt: () => () => { throw Error("must not call"); }, warn: () => {} });
  expect(() => percentCharacter(source, false, context, meter)).toThrow("not foo.Outer.Inner");
});
it("checks cancellation after guest character payload inspection", () => {
  const { v } = fixture(); let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  const context = createRuntimePercentConversionContext(meter, { string: () => { cancelled = true; return new CodePointString(Uint32Array.of(65)); }, warn: () => {} });
  expect(() => percentCharacter(v.cell({}), false, context, meter)).toThrow(ExecutionLimitError);
});
