import { describe, expect, it } from "vitest";
import { parseExpression } from "../expression.js";
import { evaluateExpression } from "./expression-evaluation.js";
import { createRuntimeExpressionContext } from "./runtime-expression-context.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { ExecutionBudget } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const names = new Map<string, RuntimeValue>(), events: string[] = [];
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const dictionaryKeys = { hash: (key: RuntimeValue) => { events.push("hash"); return runtimeHash(key, hash, meter); }, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const unused = (): never => { throw new Error("unused hook"); };
  const context = createRuntimeExpressionContext(v, {
    load(name) { events.push(`load:${name}`); const value = names.get(name); if (value === undefined) throw new Error(`missing:${name}`); return value; },
    store: unused, attribute: unused, beginCall: unused, beginSet: unused, warn: unused, dictionaryKeys
  }, meter);
  return { v, names, events, run: (source: string) => evaluateExpression(parseExpression(source), context, meter) };
}

describe("runtime dictionary displays", () => {
  it("creates distinct empty values and nested dictionaries", () => {
    const { v, run } = fixture();
    const a = run("{}"), b = run("{}"); expect(a.kind).toBe("dict"); expect(a).not.toBe(b);
    expect(run("{'a': {'b': [1, 2]}}['a']['b']")).toEqual(v.list([v.integer(1), v.integer(2)]));
  });
  it("retains original keys and shares values across mapping unpacking", () => {
    const { v, run, names } = fixture(), source = run("{1: [2], 'x': 3}"); names.set("source", source);
    const result = run("{**source, True: source[1], 'z': 4, **source}");
    if (source.kind !== "dict" || result.kind !== "dict") throw new Error("dictionary expected");
    expect(result.items.snapshot().map(([key]) => key)).toEqual([v.integer(1), v.string("x"), v.string("z")]);
    expect(result.items.lookup(v.true)?.value).toBe(source.items.lookup(v.true)?.value);
    expect(result.items).not.toBe(source.items);
  });
  it("reuses source hashes for exact dictionaries in the same policy domain", () => {
    const { run, names, events } = fixture(); names.set("source", run("{1: 2, 3: 4}")); events.length = 0;
    run("{**source, **source}"); expect(events).toEqual(["load:source", "load:source"]);
  });
  it("rejects non-mappings without accepting iterable pairs", () => {
    const { run } = fixture();
    for (const [source, kind] of [["[]", "list"], ["[(1, 2)]", "list"], ["None", "NoneType"], ["()", "tuple"], ["1", "int"]]) {
      expect(() => run(`{**${source}, missing: 2}`)).toThrow(`'${kind}' object is not a mapping`);
    }
  });
  it("finishes small-run evaluation before hashing, then stops on invalid keys", () => {
    const { v, run, names, events } = fixture(); names.set("bad", v.list([])); names.set("value", v.true);
    expect(() => run("{bad: value, 2: value, **missing}")).toThrow("cannot use 'list' as a dict key (unhashable type: 'list')");
    expect(events).toEqual(["load:bad", "load:value", "load:value", "hash"]);
  });
  it("preserves chunked literal construction for large explicit runs", () => {
    const { run, v } = fixture();
    for (const count of [15, 16, 17, 18, 34, 35]) {
      const result = run(`{${Array.from({ length: count }, (_,i) => `${i}: ${i + 1}`).join(",")}}`);
      if (result.kind !== "dict") throw new Error("dictionary expected");
      expect(result.items.size).toBe(count); expect(result.items.lookup(v.integer(count - 1))?.value).toEqual(v.integer(count));
    }
  });
});
