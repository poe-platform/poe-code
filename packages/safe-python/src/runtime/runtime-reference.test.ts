import { describe, expect, it } from "vitest";
import { resolveRuntimeReference } from "./runtime-reference.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { createRuntimeExpressionContext } from "./runtime-expression-context.js";
import { parseExpression } from "../expression.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const names = new Map<string, RuntimeValue>(), events: string[] = [];
  let attribute = v.none as RuntimeValue;
  const unused = (): never => { throw new Error("unused"); };
  const context = createRuntimeExpressionContext(v, {
    load: name => { events.push(`load:${name}`); return names.get(name)!; }, store: (name, value) => { names.set(name, value); },
    attribute: () => { events.push("get-attribute"); return attribute; },
    beginCall: unused, beginSet: unused, beginDictionary: unused, warn: unused
  }, meter);
  const writes = {
    deleteName(name: string) { names.delete(name); },
    setAttribute(object: RuntimeValue, name: string, value: RuntimeValue) { events.push(`set:${name}`); attribute = value; },
    deleteAttribute() { events.push("delete-attribute"); attribute = v.none; }
  };
  return { meter, v, names, events, context, writes, resolve: (source: string) => resolveRuntimeReference(parseExpression(source), context, writes, v, meter) };
}

describe("runtime target references", () => {
  it("defers name reads and retains the binding destination", () => {
    const { v, names, events, resolve } = fixture(); names.set("x", v.true);
    const reference = resolve("x"); expect(events).toEqual([]);
    expect(reference.get()).toBe(v.true); reference.set(v.false); expect(names.get("x")).toBe(v.false);
    reference.remove(); expect(names.has("x")).toBe(false);
  });
  it("retains list receiver/key identity when names change", () => {
    const { v, names, resolve, events } = fixture(), original = v.list([v.true]), replacement = v.list([v.none]);
    names.set("x", original); names.set("key", v.integer(0));
    const reference = resolve("x[key]"); names.set("x", replacement); names.set("key", v.integer(1));
    expect(reference.get()).toBe(v.true); reference.set(v.false); expect(reference.get()).toBe(v.false);
    reference.remove(); expect(original.items.length).toBe(0); expect(replacement.items.get(0n)).toBe(v.none);
    expect(events).toEqual(["load:x", "load:key"]);
  });
  it("does not read a subscription before slice assignment or deletion", () => {
    const { v, names, resolve } = fixture(), list = v.list([v.integer(1), v.integer(2), v.integer(3)]); names.set("x", list);
    const reference = resolve("x[1:]"); reference.set(v.tuple([v.true]));
    expect(list.items.snapshot()).toEqual([v.integer(1), v.true]); reference.remove(); expect(list.items.length).toBe(1);
  });
  it("defers attribute lookup and uses current mutation hooks", () => {
    const { v, names, resolve, events, writes } = fixture(); names.set("x", v.none);
    const reference = resolve("x.member"); expect(events).toEqual(["load:x"]);
    reference.set(v.true); expect(reference.get()).toBe(v.true);
    writes.setAttribute = () => { throw new Error("changed hook"); };
    expect(() => reference.set(v.false)).toThrow("changed hook"); reference.remove();
    expect(events).toEqual(["load:x", "set:member", "get-attribute", "delete-attribute"]);
  });
  it("rejects nonreference targets as host validation faults", () => {
    const { resolve } = fixture(); expect(() => resolve("1 + 2")).toThrow("invalid reference target: binary");
  });
  it("prevents retained references from operating after fatal budget exhaustion", () => {
    const { meter, v, names, events, resolve } = fixture(); names.set("x", v.true);
    const reference = resolve("x");
    expect(() => meter.checkpoint(10000)).toThrow(ExecutionLimitError);
    expect(() => reference.get()).toThrow(ExecutionLimitError);
    expect(() => reference.set(v.false)).toThrow(ExecutionLimitError);
    expect(() => reference.remove()).toThrow(ExecutionLimitError);
    expect(names.get("x")).toBe(v.true); expect(events).toEqual([]);
  });
});
