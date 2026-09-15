import { describe, expect, it } from "vitest";
import { createReversedBuiltin } from "./builtin-reversed.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { createRange } from "./integer-sequence.js";
import { PythonRuntimeError } from "./error.js";
import type { ReversedConstructionContext } from "./reversed-construction.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000, signal }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n }, keys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const call = (value: RuntimeValue) => createReversedBuiltin(v, meter).value.invoke([value], dictionary(), meter);
  const collect = (value: RuntimeValue) => { const iterator = runtimeIterate(value, v, meter), result: RuntimeValue[] = []; for (let n = iterator.next(); !n.done; n = iterator.next()) result.push(n.value); return result; };
  return { meter, v, dictionary, call, collect };
}

describe("concrete reversed builtin", () => {
  it("reverses exact sequences while retaining members and Python string code points", () => {
    const { v, call, collect } = fixture(), payload = v.list([]);
    expect(collect(call(v.list([v.true, payload])))).toEqual([payload, v.true]);
    expect(collect(call(v.tuple([v.true, payload])))).toEqual([payload, v.true]);
    expect(collect(call(v.bytes(new Uint8Array([0, 128, 255]))))).toEqual([v.integer(255), v.integer(128), v.integer(0)]);
    const text = v.stringPoints(new Uint32Array([0xd800, 0xdc00, 0x10000]));
    expect(collect(call(text))).toEqual([v.stringPoints(new Uint32Array([0x10000])), v.stringPoints(new Uint32Array([0xdc00])), v.stringPoints(new Uint32Array([0xd800]))]);
    expect(collect(call(v.tuple([])))).toEqual([]);
  });
  it("keeps list reverse cursors live but does not visit newly appended tail items", () => {
    const { meter, v, call } = fixture(), list = v.list([v.integer(1), v.integer(2), v.integer(3)]), iterator = runtimeIterate(call(list), v, meter);
    list.items.append(v.integer(4)); list.items.set(2n, v.integer(9)); expect(iterator.next().value).toEqual(v.integer(9));
    list.items.delete(0n); expect(iterator.next().value).toEqual(v.integer(9));
    expect(iterator.next().value).toEqual(v.integer(2)); expect(iterator.next().done).toBe(true);
    list.items.append(v.integer(5)); expect(iterator.next().done).toBe(true);
  });
  it("reverses huge ranges without asking for a machine-sized length", () => {
    const { meter, v, call } = fixture(), stop = 10n ** 80n;
    const iterator = runtimeIterate(call(v.range(createRange(3n, stop, 7n))), v, meter), last = 3n + ((stop - 4n) / 7n) * 7n;
    expect(iterator.next().value).toEqual(v.integer(last)); expect(iterator.next().value).toEqual(v.integer(last - 7n));
    const descending = runtimeIterate(call(v.range(createRange(8n, -5n, -3n))), v, meter);
    expect(descending.next().value).toEqual(v.integer(-4));
  });
  it("reverses dictionaries, proxies and all view kinds through live cursors", () => {
    const { meter, v, dictionary, call, collect } = fixture(), d = dictionary(), a = v.string("a"), b = v.string("b"); d.items.set(a, v.true); d.items.set(b, v.false);
    for (const source of [d, v.mappingProxy(d), v.dictionaryView(d, "dict_keys")]) expect(collect(call(source))).toEqual([b, a]);
    expect(collect(call(v.dictionaryView(d, "dict_values")))).toEqual([v.false, v.true]);
    expect(collect(call(v.dictionaryView(d, "dict_items")))).toEqual([v.tuple([b, v.false]), v.tuple([a, v.true])]);
    const iterator = runtimeIterate(call(d), v, meter); d.items.set(v.string("c"), v.none);
    expect(() => iterator.next()).toThrow("dictionary changed size during iteration");
  });
  it("checks arguments before protocols and rejects non-reversible builtins", () => {
    const { meter, v, dictionary, call } = fixture(), fn = createReversedBuiltin(v, meter), kwargs = dictionary(); kwargs.items.set(v.string("sequence"), v.none);
    expect(() => fn.value.invoke([], kwargs, meter)).toThrow("reversed() takes no keyword arguments");
    expect(() => fn.value.invoke([], dictionary(), meter)).toThrow("reversed expected 1 argument, got 0");
    expect(() => fn.value.invoke([v.none, v.none], dictionary(), meter)).toThrow("reversed expected 1 argument, got 2");
    expect(() => call(v.none)).toThrow("'NoneType' object is not reversible");
    expect(() => call(v.integer(1))).toThrow("'int' object is not reversible");
    expect(() => call(v.iterator({ next() { throw new Error("must not consume iterator"); } }))).toThrow("'iterator' object is not reversible");
  });
  it("preserves explicit guest method results and indexed fallback with callback ownership", () => {
    const { meter, v, dictionary, collect } = fixture(), source = v.cell({}), events: string[] = [];
    let method: (() => RuntimeValue) | null | undefined = () => v.none;
    const context: Omit<ReversedConstructionContext<RuntimeValue>, "wrap"> = {
      lookupReversed(value) { expect(this).toBe(context); expect(value).toBe(source); events.push("lookup"); return method; },
      hasSequenceItem() { expect(this).toBe(context); events.push("eligible"); return true; },
      typeName: () => "Custom", length() { expect(this).toBe(context); events.push("length"); return 3n; },
      getItem(value, index) { expect(this).toBe(context); expect(value).toBe(source); events.push(String(index)); if (index === 0n) throw new PythonRuntimeError("IndexError", "end"); return v.integer(index); },
      isIndexError: error => error instanceof PythonRuntimeError && error.name === "IndexError", isStopIteration: () => false
    };
    const builtin = createReversedBuiltin(v, meter, context);
    expect(collect(builtin.value.invoke([v.list([v.true])], dictionary(), meter))).toEqual([v.true]); expect(events).toEqual([]);
    expect(builtin.value.invoke([source], dictionary(), meter)).toBe(v.none); expect(events).toEqual(["lookup"]);
    method = null; expect(() => builtin.value.invoke([source], dictionary(), meter)).toThrow("'Custom' object is not reversible");
    method = undefined; events.length = 0;
    const result = builtin.value.invoke([source], dictionary(), meter); expect(events).toEqual(["lookup", "eligible", "length"]);
    expect(collect(result)).toEqual([v.integer(2), v.integer(1)]); expect(events).toEqual(["lookup", "eligible", "length", "2", "1", "0"]);
  });
  it("does not publish a custom result after cancellation", () => {
    const controller = new AbortController(), { meter, v, dictionary } = fixture(controller.signal), unused = (): never => { throw new Error("unexpected callback"); };
    const builtin = createReversedBuiltin(v, meter, { lookupReversed: () => () => { controller.abort(); return v.none; }, hasSequenceItem: unused, typeName: unused, length: unused, getItem: unused, isIndexError: unused, isStopIteration: unused });
    expect(() => builtin.value.invoke([v.cell({})], dictionary(), meter)).toThrow(ExecutionLimitError);
  });
  it("keeps lazy invocation policies separate and honors explicit overrides", () => {
    const { meter, v, dictionary, collect } = fixture(), source = v.cell({}), length = v.cell({}), item = v.cell({}), builtin = createReversedBuiltin(v, meter);
    const policy = (offset: number) => ({
      lookupSpecial(value: RuntimeValue, name: string) { expect(this).toBe(invocations[offset]); expect(value).toBe(source); return name === "__len__" ? length : name === "__getitem__" ? item : undefined; },
      hasSpecial(value: RuntimeValue, name: string) { expect(this).toBe(invocations[offset]); expect(value).toBe(source); expect(name).toBe("__getitem__"); return true; },
      call(method: RuntimeValue, args: readonly RuntimeValue[]) { expect(this).toBe(invocations[offset]); if (method === length) return v.integer(2); expect(method).toBe(item); expect(args[0].kind).toBe("int"); return v.integer(offset + Number((args[0] as Extract<RuntimeValue, { kind: "int" }>).value)); },
      isStopIteration: () => false
    });
    const invocations = [policy(0), policy(1)];
    const first = builtin.value.invoke([source], dictionary(), meter, invocations[0]);
    const second = builtin.value.invoke([source], dictionary(), meter, invocations[1]);
    expect(collect(second)).toEqual([v.integer(2), v.integer(1)]);
    expect(collect(first)).toEqual([v.integer(1), v.integer(0)]);
    const unused = (): never => { throw Error("unexpected fallback"); };
    const explicit = createReversedBuiltin(v, meter, { lookupReversed: () => () => v.true, hasSequenceItem: unused, length: unused, getItem: unused, isIndexError: unused, isStopIteration: unused, typeName: unused });
    expect(explicit.value.invoke([source], dictionary(), meter, { lookupSpecial: unused, call: unused, isStopIteration: unused })).toBe(v.true);
  });
  it.each(["lookup", "presence", "call"])("observes invocation cancellation during %s", phase => {
    const controller = new AbortController(), { meter, v, dictionary } = fixture(controller.signal), source = v.cell({}), method = v.cell({});
    const invocation = {
      lookupSpecial() { if (phase === "lookup") controller.abort(); return phase === "presence" ? undefined : method; },
      hasSpecial() { controller.abort(); return true; },
      call() { controller.abort(); return v.none; }, isStopIteration: () => false
    };
    expect(() => createReversedBuiltin(v, meter).value.invoke([source], dictionary(), meter, invocation)).toThrow(ExecutionLimitError);
  });
});
