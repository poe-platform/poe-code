import { describe, expect, it } from "vitest";
import { createLenBuiltin } from "./builtin-len.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { createRange } from "./integer-sequence.js";
import type { LengthProtocolContext } from "./length-protocol.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const len = createLenBuiltin(v, meter);
  return { v, meter, keywords, len, call: (...args: RuntimeValue[]) => len.value.invoke(args, keywords, meter) };
}

describe("concrete len builtin", () => {
  it.each(["int", "bool", "negative", "overflow", "float"])("validates invocation length-to-index conversion returning %s", mode => {
    const { v, meter, keywords, len } = fixture(), guest = v.cell({}), indexed = v.cell({}), lengthMethod = v.cell({}), indexMethod = v.cell({}), events: string[] = [];
    const result = mode === "bool" ? v.true : mode === "float" ? v.float(3) : v.integer(mode === "negative" ? -1n : mode === "overflow" ? 1n << 63n : 3n);
    const invocation = {
      lookupSpecial(value: RuntimeValue, name: string) {
        events.push(name); expect(value).toBe(name === "__len__" ? guest : indexed);
        return name === "__len__" ? lengthMethod : indexMethod;
      },
      call(method: RuntimeValue, args: readonly RuntimeValue[]) { expect(args).toEqual([]); return method === lengthMethod ? indexed : result; },
      isStopIteration: () => false, typeName: (value: RuntimeValue) => value.kind,
      warn(category: string, message: string) { expect(category).toBe("DeprecationWarning"); expect(message).toContain("strict subclass of int"); events.push("warning"); }
    };
    const run = () => len.value.invoke([guest], keywords, meter, invocation);
    if (mode === "negative") expect(run).toThrow("__len__() should return >= 0");
    else if (mode === "overflow") expect(run).toThrow("cannot fit 'int' into an index-sized integer");
    else if (mode === "float") expect(run).toThrow("__index__ returned non-int (type float)");
    else expect(run()).toEqual(v.integer(mode === "bool" ? 1 : 3));
    expect(events).toEqual(mode === "bool" ? ["__len__", "__index__", "warning"] : ["__len__", "__index__"]);
  });
  it.each([0n, 7n, -1n, 1n << 63n])("supports guest length slots returning %s", length => {
    const { v, meter, keywords } = fixture(), guest = v.cell({});
    const context: LengthProtocolContext<RuntimeValue> = {
      lookupLength(value) { expect(this).toBe(context); expect(value).toBe(guest); return () => v.integer(length); },
      integer: value => value.kind === "int" ? value.value : undefined, isExactInteger: value => value.kind === "int",
      lookupIndex: () => undefined, typeName: value => value === guest ? "Guest" : value.kind,
      warn: () => { throw Error("unexpected warning"); }
    };
    const len = createLenBuiltin(v, meter, context);
    const call = () => len.value.invoke([guest], keywords, meter);
    if (length < 0n) expect(call).toThrow("__len__() should return >= 0");
    else if (length >= 1n << 63n) expect(call).toThrow("cannot fit 'int' into an index-sized integer");
    else expect(call()).toBe(v.integer(length));
  });
  it("converts guest length through index and keeps native lengths on their exact paths", () => {
    const { v, meter, keywords } = fixture(), guest = v.cell({}), index = v.cell({}), events: string[] = [];
    const context: LengthProtocolContext<RuntimeValue> = {
      lookupLength: value => { expect(value).toBe(guest); return () => { events.push("len"); return index; }; },
      integer: value => value.kind === "int" ? value.value : undefined, isExactInteger: value => value.kind === "int",
      lookupIndex: value => { expect(value).toBe(index); return () => { events.push("index"); return v.integer(3); }; },
      typeName: () => "Guest", warn: () => { throw Error("unexpected warning"); }
    };
    const len = createLenBuiltin(v, meter, context);
    expect(len.value.invoke([guest], keywords, meter)).toBe(v.integer(3));
    expect(len.value.invoke([v.list([v.none])], keywords, meter)).toBe(v.integer(1));
    expect(events).toEqual(["len", "index"]);
  });
  it("uses guest type names for absent length slots", () => {
    const { v, meter, keywords } = fixture();
    const context: LengthProtocolContext<RuntimeValue> = {
      lookupLength: () => undefined, integer: () => undefined, isExactInteger: () => false,
      lookupIndex: () => undefined, typeName: () => "Guest", warn() {}
    };
    const len = createLenBuiltin(v, meter, context);
    expect(() => len.value.invoke([v.cell({})], keywords, meter)).toThrow("object of type 'Guest' has no len()");
  });
  it("returns exact lengths of sequences, strings, bytes and dictionaries", () => {
    const { v, call, keywords } = fixture();
    for (const [value, expected] of [[v.list([v.none]), 1], [v.tuple([v.none, v.true]), 2], [v.string("a😀"), 2], [v.bytes(new Uint8Array([0, 255, 1])), 3], [keywords, 0], [v.range(createRange(0n, 8n, 2n)), 4]] as const) expect(call(value)).toEqual(v.integer(expected));
  });
  it("reads live lengths without inspecting cyclic members", () => {
    const { v, call } = fixture(), list = v.list([]);
    list.items.append(list); expect(call(list)).toEqual(v.integer(1)); list.items.append(v.none); expect(call(list)).toEqual(v.integer(2));
  });
  it("checks keywords before positional arity or operand length", () => {
    const { v, call, keywords } = fixture();
    expect(() => call()).toThrow("len() takes exactly one argument (0 given)");
    expect(() => call(v.none, v.none)).toThrow("len() takes exactly one argument (2 given)");
    keywords.items.set(v.string("x"), v.none); expect(() => call()).toThrow("len() takes no keyword arguments");
  });
  it("rejects values without length without invoking builtin or iterator payloads", () => {
    const { v, call, len } = fixture();
    for (const value of [v.none, v.integer(1), v.slice({}), len, v.iterator({ next() { throw new Error("must not iterate"); } })]) {
      const name = value.kind === "none" ? "NoneType" : value.kind;
      expect(() => call(value)).toThrow(`object of type '${name}' has no len()`);
    }
  });
  it("rejects a range length outside the signed platform-size domain", () => {
    const { v, call } = fixture();
    expect(() => call(v.range(createRange(0n, 2n ** 100n, 1n)))).toThrow("Python int too large to convert to C ssize_t");
  });
});
