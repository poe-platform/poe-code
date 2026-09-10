import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { prepareRuntimeSlotDeclaration } from "./runtime-slot-declaration.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const namespace = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => runtimeComparison("==", a, b, v, meter).value }, meter));
  const context = { namespace, dictionaryAllowed: true, weakReferencesAllowed: true };
  const prepare = (value: RuntimeValue) => prepareRuntimeSlotDeclaration("_C", value, context, v, meter);
  return { v, meter, namespace, context, prepare };
}

it.each(["", "1x", "a-b", "a.b", "a\0b", "\ud800"])("rejects non-identifier slot %j", text => {
  const { v, prepare } = fixture(); expect(() => prepare(v.string(text))).toThrow("__slots__ must be identifiers");
});

it("mangles private names, retains duplicates and Unicode spelling, and sorts by code point", () => {
  const { v, prepare } = fixture(), source = v.list([v.string("𐀀"), v.string("K"), v.string("__x"), v.string("x"), v.string("x")]);
  expect(prepare(source).names).toEqual(["_C__x", "x", "x", "K", "𐀀"]);
  expect(source.items.length).toBe(5);
});

it("handles dictionary declarations without reading their documentation values", () => {
  const { v, namespace, prepare } = fixture(), declaration = v.dictionary(namespace.items.emptyCopy()); declaration.items.set(v.string("x"), v.none);
  expect(prepare(declaration).names).toEqual(["x"]);
});

it("checks duplicate and inherited dictionary/weak-reference requests", () => {
  const { v, prepare, context } = fixture();
  for (const name of ["__dict__", "__weakref__"]) expect(() => prepare(v.tuple([v.string(name), v.string(name)]))).toThrow(`${name} slot disallowed: we already got one`);
  context.dictionaryAllowed = false; expect(() => prepare(v.string("__dict__"))).toThrow("__dict__ slot disallowed");
  context.weakReferencesAllowed = false; expect(() => prepare(v.string("__weakref__"))).toThrow("__weakref__ slot disallowed");
});

it("consumes the whole iterator before validating entries", () => {
  const { v, prepare } = fixture(), failure = Error("iteration failed"); let reads = 0;
  const iterator = v.iterator({ next() { if (reads++ === 0) return { done: false, value: v.integer(1) }; throw failure; } });
  expect(() => prepare(iterator)).toThrow(failure); expect(reads).toBe(2);
});

it("checks variable-sized bases before item types and rejects namespace conflicts", () => {
  const { v, meter, context, namespace, prepare } = fixture();
  expect(() => prepareRuntimeSlotDeclaration("C", v.tuple([v.integer(1)]), { ...context, variableSizedBase: "type" }, v, meter)).toThrow("nonempty __slots__ not supported for subtype of 'type'");
  namespace.items.set(v.string("_C__x"), v.true);
  expect(() => prepare(v.string("__x"))).toThrow("'_C__x' in __slots__ conflicts with class variable");
});

it("honors cancellation before consuming slot iterators", () => {
  const controller = new AbortController(), { v, prepare } = fixture(controller.signal); let reads = 0;
  const iterator = v.iterator({ next() { reads++; return { done: true, value: v.none }; } });
  controller.abort(); expect(() => prepare(iterator)).toThrow("execution cancelled"); expect(reads).toBe(0);
});
