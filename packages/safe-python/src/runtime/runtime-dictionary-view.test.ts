import { describe, expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeMembership } from "./runtime-membership.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeIndex } from "./runtime-index.js";
import { runtimeMutateItem } from "./runtime-mutation.js";
import { createLenBuiltin } from "./builtin-len.js";
import { iterateRuntimeDictionaryView } from "./runtime-dictionary-view.js";
import { createRuntimeDictionaryMethod } from "./runtime-dictionary-method.js";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { executeRuntimeProgram, type RuntimeProgramHooks } from "./runtime-program.js";
import { CallStack } from "./call-stack.js";
import { readRuntimeDictionaryViewAttribute } from "./runtime-dictionary-view-attributes.js";
import { createReversedBuiltin } from "./builtin-reversed.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000 }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (k: RuntimeValue) => runtimeHash(k, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const source = dictionary(), key = v.string("x");
  const collect = (iterator: Iterator<RuntimeValue>) => { const result: RuntimeValue[] = []; for (let next = iterator.next(); !next.done; next = iterator.next()) result.push(next.value); return result; };
  return { meter, v, hash, keys, dictionary, source, key, collect };
}

describe("live dictionary views", () => {
  it("runs bound mapping methods and live view iteration in assembled programs", () => {
    const { meter, v, keys } = fixture(), globals = new Map<string, RuntimeValue>(), unused = (): never => { throw new Error("unexpected object hook"); };
    const hooks: RuntimeProgramHooks = {
      expressions: () => ({ attribute(receiver, name) {
        if ((receiver.kind === "dict" || receiver.kind === "mappingproxy") &&
            (name === "get" || name === "copy" || name === "keys" || name === "values" || name === "items" || name === "__reversed__")) {
          return createRuntimeDictionaryMethod(receiver, name, v, meter);
        }
        if (receiver.kind === "dict_keys" || receiver.kind === "dict_values" || receiver.kind === "dict_items") {
          return readRuntimeDictionaryViewAttribute(receiver, name, v, meter) ?? unused();
        }
        return unused();
      }, beginSet: unused, warn: unused }),
      statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }), callable: () => false, invoke: unused, name: unused, keywordName: unused
    };
    const code = 'd = {"x": 2}\nview = d.items()\nbefore = len(view)\nd["y"] = 3\nafter = len(view)\ntotal = 0\nfor key, value in view:\n    total += value\ncopied = d.copy()\ndel d["x"]\nremaining = len(view)\nfound = copied.get("x", 99)\nmatching = copied.keys() == {"x": 0, "y": 0}.keys()\nlive_value = view.mapping.get("y")\ndisjoint = d.keys().isdisjoint(["absent"])\nreverse_total = 0\nfor key, value in reversed(view):\n    reverse_total += value\n';
    const program = compileProgram<RuntimeValue>(analyzeModule(code), { stripDocstring: false }, v, meter);
    executeRuntimeProgram(program, { globals, builtins: new Map([["len", createLenBuiltin(v, meter)], ["reversed", createReversedBuiltin(v, meter)]]), values: v, keys, calls: new CallStack<object>(10, meter), hooks }, meter);
    for (const [name, value] of [["before", 1], ["after", 2], ["remaining", 1], ["total", 5], ["found", 2], ["live_value", 3], ["reverse_total", 3]] as const) expect(globals.get(name)).toEqual(v.integer(value));
    expect(globals.get("matching")).toBe(v.true);
    expect(globals.get("disjoint")).toBe(v.true);
  });
  it("iterates live keys, values and fresh item tuples in both directions", () => {
    const { meter, v, source, key, collect } = fixture(), payload = v.list([]), next = v.string("y");
    const keys = v.dictionaryView(source, "dict_keys"), values = v.dictionaryView(source, "dict_values"), items = v.dictionaryView(source, "dict_items");
    expect(Object.isFrozen(keys)).toBe(true); expect(runtimeTruth(keys, meter)).toBe(false);
    source.items.set(key, payload); source.items.set(next, v.true);
    expect(collect(runtimeIterate(keys, v, meter))).toEqual([key, next]);
    expect(collect(runtimeIterate(values, v, meter))).toEqual([payload, v.true]);
    const first = collect(runtimeIterate(items, v, meter)), second = collect(runtimeIterate(items, v, meter));
    expect(first).toEqual([v.tuple([key, payload]), v.tuple([next, v.true])]); expect(first[0]).not.toBe(second[0]);
    expect(collect(iterateRuntimeDictionaryView(items, v, meter, true))).toEqual([...first].reverse());
    source.items.delete(key); expect(collect(runtimeIterate(values, v, meter))).toEqual([v.true]);
  });
  it("captures iterator size at construction and reads replacement values lazily", () => {
    const { meter, v, source, key } = fixture(); source.items.set(key, v.true);
    const view = v.dictionaryView(source, "dict_values"), iterator = runtimeIterate(view, v, meter);
    source.items.set(key, v.false); expect(iterator.next().value).toBe(v.false);
    source.items.set(v.string("y"), v.none); expect(() => iterator.next()).toThrow("dictionary changed size during iteration");
  });
  it("distinguishes key, value and item containment including unhashable values", () => {
    const { meter, v, source, key } = fixture(), payload = v.list([]); source.items.set(key, payload);
    const keys = v.dictionaryView(source, "dict_keys"), values = v.dictionaryView(source, "dict_values"), items = v.dictionaryView(source, "dict_items");
    expect(runtimeMembership("in", key, keys, v, meter)).toBe(v.true);
    expect(() => runtimeMembership("in", payload, keys, v, meter)).toThrow("cannot use 'list' as a dict key");
    expect(runtimeMembership("in", v.list([]), values, v, meter)).toBe(v.true);
    expect(runtimeMembership("in", v.tuple([key, v.list([])]), items, v, meter)).toBe(v.true);
    expect(runtimeMembership("in", v.list([key, payload]), items, v, meter)).toBe(v.false);
    expect(runtimeMembership("in", v.tuple([key]), items, v, meter)).toBe(v.false);
    expect(() => runtimeMembership("in", v.tuple([payload, v.none]), items, v, meter)).toThrow("cannot use 'list' as a dict key");
  });
  it("uses identity shortcuts for values and item values but not view equality", () => {
    const { meter, v, source, key } = fixture(), nan = v.float(NaN); source.items.set(key, nan);
    const values = v.dictionaryView(source, "dict_values"), items = v.dictionaryView(source, "dict_items");
    expect(runtimeMembership("in", nan, values, v, meter)).toBe(v.true);
    expect(runtimeMembership("in", v.tuple([key, nan]), items, v, meter)).toBe(v.true);
    expect(runtimeComparison("==", values, values, v, meter)).toBe(v.true);
    expect(runtimeComparison("==", values, v.dictionaryView(source, "dict_values"), v, meter)).toBe(v.false);
  });
  it("compares key/item views as sets without requiring hashable item values", () => {
    const { meter, v, source, key, dictionary } = fixture(), other = dictionary();
    source.items.set(key, v.list([])); other.items.set(key, v.list([]));
    for (const kind of ["dict_keys", "dict_items"] as const) {
      const a = v.dictionaryView(source, kind), b = v.dictionaryView(other, kind);
      expect(runtimeComparison("==", a, b, v, meter)).toBe(v.true);
      expect(runtimeComparison("<=", a, b, v, meter)).toBe(v.true);
      expect(runtimeComparison("<", a, b, v, meter)).toBe(v.false);
      other.items.set(v.string("extra"), v.false);
      expect(runtimeComparison("<", a, b, v, meter)).toBe(v.true);
      expect(runtimeComparison(">", b, a, v, meter)).toBe(v.true);
      other.items.delete(v.string("extra"));
    }
    const items = v.dictionaryView(source, "dict_items");
    source.items.set(key, items); other.items.set(key, v.dictionaryView(other, "dict_items"));
    expect(() => runtimeComparison("==", items, v.dictionaryView(other, "dict_items"), v, meter, 20)).toThrow("maximum recursion depth exceeded");
  });
  it("uses live length and correct hashing and rejects subscription/mutation", () => {
    const { meter, v, source, key, hash, dictionary } = fixture(); source.items.set(key, v.none);
    for (const kind of ["dict_keys", "dict_values", "dict_items"] as const) {
      const view = v.dictionaryView(source, kind);
      expect(createLenBuiltin(v, meter).value.invoke([view], dictionary(), meter)).toEqual(v.integer(1));
      expect(runtimeTruth(view, meter)).toBe(true);
      if (kind === "dict_values") expect(runtimeHash(view, hash, meter)).toBe(17n);
      else expect(() => runtimeHash(view, hash, meter)).toThrow(`unhashable type: '${kind}'`);
      expect(() => runtimeIndex(view, v.integer(0), v, meter)).toThrow(`'${kind}' object is not subscriptable`);
      expect(() => runtimeMutateItem(view, key, { kind: "delete" }, v, meter)).toThrow(`'${kind}' object does not support item deletion`);
    }
  });
  it("binds dictionary/proxy read methods to their original live storage", () => {
    const { meter, v, source, key, dictionary, collect } = fixture(); source.items.set(key, v.list([]));
    for (const receiver of [source, v.mappingProxy(source)]) {
      const get = createRuntimeDictionaryMethod(receiver, "get", v, meter);
      expect(get.value.invoke([key], dictionary(), meter)).toBe(source.items.lookup(key)!.value);
      expect(get.value.invoke([v.none], dictionary(), meter)).toBe(v.none);
      expect(get.value.invoke([v.none, v.true], dictionary(), meter)).toBe(v.true);
      const copied = createRuntimeDictionaryMethod(receiver, "copy", v, meter).value.invoke([], dictionary(), meter);
      expect(copied.kind).toBe("dict"); if (copied.kind !== "dict") throw new Error("expected dict");
      expect(copied.items).not.toBe(source.items); expect(copied.items.lookup(key)!.value).toBe(source.items.lookup(key)!.value);
      for (const name of ["keys", "values", "items"] as const) {
        const method = createRuntimeDictionaryMethod(receiver, name, v, meter), view = method.value.invoke([], dictionary(), meter);
        expect(view.kind).toBe(`dict_${name}`); expect(view).not.toBe(method.value.invoke([], dictionary(), meter));
        expect(collect(runtimeIterate(view, v, meter))).toHaveLength(1);
        expect(() => method.value.invoke([v.none], dictionary(), meter)).toThrow(`${receiver.kind}.${name}() takes no arguments (1 given)`);
      }
      const reversed = createRuntimeDictionaryMethod(receiver, "__reversed__", v, meter).value.invoke([], dictionary(), meter);
      expect(collect(runtimeIterate(reversed, v, meter))).toEqual([key]);
      expect(() => get.value.invoke([], dictionary(), meter)).toThrow("get expected at least 1 argument, got 0");
      expect(() => get.value.invoke([key, v.none, v.none], dictionary(), meter)).toThrow("get expected at most 2 arguments, got 3");
      const kwargs = dictionary(); kwargs.items.set(key, v.none);
      expect(() => get.value.invoke([key], kwargs, meter)).toThrow(`${receiver.kind}.get() takes no keyword arguments`);
    }
  });
});
