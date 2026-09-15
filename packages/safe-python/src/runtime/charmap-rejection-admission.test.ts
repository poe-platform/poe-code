import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {createRuntimeCharmapBuild} from "./runtime-encoding-map.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues, type RuntimeValue} from "./runtime-values.js";

function fixture(signal?: AbortSignal) {
  let budget = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000, signal});
  const meter = {checkpoint(steps = 1, bytes = 0) {budget.checkpoint(steps, bytes);}};
  const values = new RuntimeValues(meter);
  const keys = {hash: () => 0n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, values, meter).value};
  const types = new RuntimeTypeRegistry(values, keys, meter);
  const build = createRuntimeCharmapBuild(values, meter, keys, () => types.encodingMapType());
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  return {values, meter, types, build, keywords, limit(bytes: number) {budget = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: bytes, signal});}};
}

function expectTerminal(invoke: () => unknown) {
  let failure: unknown;
  try {invoke();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {invoke();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
}

it.each(["missing", "extra", "keyword", "empty", "type"])("admits charmap_build %s rejection before constructing an exception", kind => {
  const {values, meter, build, keywords, limit} = fixture();
  const source = values.string("");
  const args = kind === "missing" ? [] : kind === "extra" ? [source, source] : kind === "type" ? [values.none] : [source];
  if (kind === "keyword") keywords.items.set(values.string("map"), source);
  limit(64);
  expectTerminal(() => build.value.invoke(args, keywords, meter));
});

it("admits a charmap type diagnostic after the type-name callback consumes storage", () => {
  const {values, meter, build, keywords, limit} = fixture();
  const source = values.cell({});
  let calls = 0;
  expectTerminal(() => build.value.invoke([source], keywords, meter, {
    call: () => values.none,
    typeName(value) {expect(value).toBe(source); calls++; limit(0); return "GuestType";}
  }));
  expect(calls).toBe(1);
});

it.each([false, true])("retains terminal cancellation when type-name resolution returns or throws (throws=%s)", throws => {
  const controller = new AbortController();
  const {values, meter, build, keywords} = fixture(controller.signal);
  const source = values.cell({});
  let calls = 0, first: unknown;
  const invoke = () => build.value.invoke([source], keywords, meter, {
    call: () => values.none,
    typeName() {
      calls++; controller.abort();
      if (throws) throw Error("service failed after cancellation");
      return "GuestType";
    }
  });
  try {invoke();} catch (error) {first = error;}
  expect(first).toBeInstanceOf(ExecutionLimitError);
  expect(first).toMatchObject({reason: "cancelled"});
  let retry: unknown;
  try {invoke();} catch (error) {retry = error;}
  expect(retry).toBe(first);
  expect(calls).toBe(1);
});

it.each(["extra", "keyword"])("admits EncodingMap.size %s rejection before constructing an exception", kind => {
  const {values, meter, types, build, keywords, limit} = fixture();
  const source = values.string("\0A");
  const map = build.value.invoke([source], keywords, meter);
  const method = types.encodingMapType().value.namespace.items.lookup(values.string("size"))!.value;
  if (method.kind !== "method_descriptor") throw Error("expected real EncodingMap.size descriptor");
  const args = kind === "extra" ? [values.none] : [];
  if (kind === "keyword") keywords.items.set(values.string("unused"), values.none);
  limit(64);
  expectTerminal(() => method.value.invoke(map, args, keywords, meter));
});
