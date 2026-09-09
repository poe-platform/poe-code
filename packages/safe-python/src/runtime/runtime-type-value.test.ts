import { describe, expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeLayout, resolveRuntimeTypeAttribute } from "./runtime-type-layout.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeBinary } from "./runtime-binary.js";
import { readClassAttribute } from "./class-attributes.js";
import { createFunctionState } from "./function-state.js";
import { compileProgram } from "./program-compilation.js";
import { analyzeModule } from "../analysis.js";
import { executeRuntimeProgram, type RuntimeProgramHooks } from "./runtime-program.js";
import { CallStack } from "./call-stack.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000 }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n }, keys = { hash: (k: RuntimeValue) => runtimeHash(k, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const namespace = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const rootLayout = new RuntimeTypeLayout("object", [], namespace(), meter), typeLayout = new RuntimeTypeLayout("type", [rootLayout], namespace(), meter);
  const type = v.type(typeLayout, "self"), root = v.type(rootLayout, type), cls = v.type(new RuntimeTypeLayout("C", [rootLayout], namespace(), meter), type);
  return { meter, v, type, root, cls, keys, namespace };
}

describe("concrete runtime type records", () => {
  it("bootstraps self-typed type while retaining explicit metaclass and layout identity", () => {
    const { type, root, cls } = fixture();
    expect(type.kind).toBe("type"); expect(type.metaclass).toBe(type); expect(root.metaclass).toBe(type); expect(cls.metaclass).toBe(type);
    expect(type.value.mro).toEqual([type.value, root.value]); expect(cls.value.bases).toEqual([root.value]);
    expect(Object.isFrozen(type)).toBe(true); expect(Object.isFrozen(cls)).toBe(true);
  });
  it("preserves live namespaces without exposing properties through host lookup", () => {
    const { cls, v, meter } = fixture(); cls.value.namespace.items.set(v.string("x"), v.true);
    expect(resolveRuntimeTypeAttribute(cls.value, v.string("x"), { slots: () => undefined }, v, meter)?.attribute.value).toBe(v.true);
    expect(Object.hasOwn(cls, "x")).toBe(false);
  });
  it("retains custom metaclass relationships without running construction hooks", () => {
    const { type, root, v, meter, namespace } = fixture();
    const meta = v.type(new RuntimeTypeLayout("Meta", [type.value], namespace(), meter), type);
    const cls = v.type(new RuntimeTypeLayout("C", [root.value], namespace(), meter), meta);
    expect(cls.metaclass).toBe(meta); expect(meta.metaclass).toBe(type); expect(cls.value.bases[0]).toBe(root.value);
  });
  it("uses type identity rather than equal layouts or names as dictionary keys", () => {
    const { cls, type, v, meter, namespace } = fixture(), dictionary = namespace();
    const other = v.type(new RuntimeTypeLayout("C", cls.value.bases, namespace(), meter), type);
    dictionary.items.set(cls, v.integer(1)); dictionary.items.set(other, v.integer(2)); dictionary.items.set(cls, v.integer(3));
    expect(dictionary.items.size).toBe(2); expect(dictionary.items.lookup(cls)?.value).toEqual(v.integer(3)); expect(dictionary.items.lookup(other)?.value).toEqual(v.integer(2));
  });
  it("uses intrinsic identity equality and hashing without traversing type cycles", () => {
    const { type, cls, v, meter } = fixture();
    expect(runtimeComparison("==", type, type, v, meter).value).toBe(true); expect(runtimeComparison("!=", type, cls, v, meter).value).toBe(true);
    const seen: RuntimeValue[] = [];
    expect(runtimeHash(type, { none: v.none, identity: value => { seen.push(value); return -1n; }, string: () => 2n, bytes: () => 3n }, meter)).toBe(-2n);
    expect(seen).toEqual([type]); expect(runtimeTruth(type, meter)).toBe(true);
  });
  it("declines unsupported intrinsic ordering, numeric and iteration operations", () => {
    const { type, cls, v, meter } = fixture();
    expect(() => runtimeComparison("<", type, cls, v, meter)).toThrow("'type' and 'type'");
    expect(runtimeBinary("+", type, v.integer(1), v, meter)).toBe(v.notImplemented);
    expect(() => runtimeIterate(type, v, meter)).toThrow("'type' object is not iterable");
  });
  it("supplies a real type owner to inherited function descriptors", () => {
    const { root, cls, type, v, meter } = fixture();
    const program = compileProgram<RuntimeValue>(analyzeModule("def f(): return 1\n"), { stripDocstring: false }, v, meter), code = program.functions.values().next().value!;
    const fn = v.function(createFunctionState(code, new Map(), { globals: new Map(), builtins: new Map(), none: v.none }, meter)); root.value.namespace.items.set(v.string("f"), fn);
    const result = readClassAttribute(cls, type, undefined, () => resolveRuntimeTypeAttribute(cls.value, v.string("f"), { slots: () => undefined }, v, meter)?.attribute, meter);
    expect(result?.value).toBe(fn);
  });
  it("dispatches type calls to the explicit object policy even when generic callability says false", () => {
    const { cls, v, keys, meter } = fixture(), globals = new Map<string, RuntimeValue>([["C", cls]]), unused = (): never => { throw new Error("unexpected hook"); };
    const hooks: RuntimeProgramHooks = { expressions: () => ({ attribute: unused, beginSet: unused, warn: unused }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, name: () => "C()", keywordName: unused,
      invoke(value, positional) { expect(value).toBe(cls); expect(positional).toEqual([v.integer(3)]); return v.integer(7); } };
    const program = compileProgram<RuntimeValue>(analyzeModule("result = C(3)\n"), { stripDocstring: false }, v, meter);
    executeRuntimeProgram(program, { globals, builtins: new Map(), values: v, keys, calls: new CallStack<object>(10, meter), hooks }, meter);
    expect(globals.get("result")).toEqual(v.integer(7));
  });
  it("charges type allocation before publishing a bootstrap record", () => {
    const { cls } = fixture(), meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 160 }), v = new RuntimeValues(meter);
    expect(() => v.type(cls.value, "self")).toThrow(ExecutionLimitError);
  });
});
