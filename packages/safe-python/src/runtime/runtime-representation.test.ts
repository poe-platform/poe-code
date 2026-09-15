import { expect, it } from "vitest";
import { createRuntimeRepresentationContext, type RuntimeRepresentationState } from "./runtime-representation.js";
import { representationObject } from "./representation-protocol.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const context = createRuntimeRepresentationContext(v, meter, { defaultRepr: () => { throw Error("unexpected default"); } });
  return { meter, v, context };
}
const points = (value: RuntimeValue) => { if (value.kind !== "str") throw Error("expected str"); return String.fromCodePoint(...value.value); };
it.each([false, true])("keeps representation policies separate with shared guards=%s and restores failures", shared => {
  const { meter, v } = fixture(), firstState: RuntimeRepresentationState = {}, secondState: RuntimeRepresentationState = shared ? firstState : {}, guest = v.cell({}), items = v.list([guest]), failure = Error("guest repr failed"); let fail = true;
  const second = createRuntimeRepresentationContext(v, meter, { lookupRepr: () => () => v.string("leaf"), defaultRepr: () => v.none }, secondState);
  const first = createRuntimeRepresentationContext(v, meter, {
    lookupRepr: () => () => { if (fail) throw failure; return representationObject(items, "repr", second, meter); }, defaultRepr: () => v.none
  }, firstState);
  expect(firstState.stack).toBeUndefined(); expect(secondState.stack).toBeUndefined();
  expect(points(representationObject(v.integer(1), "repr", first, meter))).toBe("1");
  expect(firstState.stack).toBeUndefined();
  expect(() => representationObject(items, "repr", first, meter)).toThrow(failure);
  expect(points(representationObject(items, "repr", second, meter))).toBe("[leaf]");
  fail = false;
  expect(points(representationObject(items, "repr", first, meter))).toBe(shared ? "[[...]]" : "[[leaf]]");
  expect(points(representationObject(items, "repr", second, meter))).toBe("[leaf]");
  expect(firstState.stack === secondState.stack).toBe(shared);
});
it("reuses exact native strings and renders repr/ascii from their storage", () => {
  const { meter, v, context } = fixture(), source = v.string("é😀");
  expect(representationObject(source, "str", context, meter)).toBe(source);
  expect(points(representationObject(source, "repr", context, meter))).toBe("'é😀'");
  expect(points(representationObject(source, "ascii", context, meter))).toBe("'\\xe9\\U0001f600'");
});
it("uses native scalar representation rules for integers, booleans and bytes", () => {
  const { meter, v, context } = fixture();
  for (const [source, expected] of [[v.integer(-(1n << 70n)), "-1180591620717411303424"], [v.true, "True"], [v.false, "False"], [v.bytes(Uint8Array.of(0, 255)), "b'\\x00\\xff'"]] as const) {
    for (const mode of ["str", "repr", "ascii"] as const) expect(points(representationObject(source, mode, context, meter))).toBe(expected);
  }
});
it("preserves guest string-subclass identity and exactifies escaped output", () => {
  const { meter, v } = fixture(), source = v.cell({}), result = v.cell({});
  let payload = v.string("ascii").value;
  const context = createRuntimeRepresentationContext(v, meter, {
    string: value => value === result ? payload : undefined,
    lookupRepr: value => value === source ? () => result : undefined,
    defaultRepr: () => { throw Error("default"); }
  });
  expect(representationObject(source, "str", context, meter)).toBe(result);
  expect(representationObject(source, "ascii", context, meter)).toBe(result);
  payload = v.string("é").value;
  expect(points(representationObject(source, "ascii", context, meter))).toBe("\\xe9");
});
it("binds guest slots and defaults with hook ownership", () => {
  const { meter, v } = fixture(), source = v.cell({}), fallback = v.string("<owned>");
  const hooks = {
    lookupStr(value: RuntimeValue) { expect(this).toBe(hooks); return value === source ? () => v.string("custom") : undefined; },
    defaultRepr(value: RuntimeValue) { expect(this).toBe(hooks); expect(value).toBe(source); return fallback; }
  };
  const context = createRuntimeRepresentationContext(v, meter, hooks);
  expect(points(representationObject(source, "str", context, meter))).toBe("custom");
  expect(representationObject(source, "repr", context, meter)).toBe(fallback);
});
it("uses native and guest type names for invalid slot results", () => {
  const { meter, v } = fixture(), source = v.cell({}), bad = v.cell({});
  const result = v.none;
  const context = createRuntimeRepresentationContext(v, meter, { lookupRepr: () => () => result, typeName: value => value === bad ? "Guest" : undefined, defaultRepr: () => v.none });
  expect(() => representationObject(source, "repr", context, meter)).toThrow("type NoneType");
  const guestContext = createRuntimeRepresentationContext(v, meter, { lookupRepr: () => () => bad, typeName: () => "Guest", defaultRepr: () => v.none });
  expect(() => representationObject(source, "repr", guestContext, meter)).toThrow("type Guest");
});
it("enforces native integer decimal limits through representation dispatch", () => {
  const { meter, v, context } = fixture();
  expect(() => representationObject(v.integer(10n ** 4300n), "repr", context, meter)).toThrow("Exceeds the limit (4300 digits)");
});
it("checks cancellation after guest slot lookup and payload inspection", () => {
  const { v } = fixture(), source = v.cell({}), result = v.cell({});
  for (const stage of ["lookup", "payload"] as const) {
    let cancelled = false;
    const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
    const context = createRuntimeRepresentationContext(v, meter, {
      lookupRepr: () => { if (stage === "lookup") cancelled = true; return () => result; },
      string: () => { cancelled = true; return v.string("x").value; },
      defaultRepr: () => v.none
    });
    expect(() => representationObject(source, "repr", context, meter)).toThrow(ExecutionLimitError);
  }
});
