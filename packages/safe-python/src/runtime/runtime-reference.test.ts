import { describe, expect, it } from "vitest";
import { createRuntimeReferenceContinuation, resolveRuntimeReference } from "./runtime-reference.js";
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
  return { meter, v, names, events, context, writes,
    resolve: (source: string) => resolveRuntimeReference(parseExpression(source), context, writes, v, meter),
    continuation: (source: string) => createRuntimeReferenceContinuation(parseExpression(source), context, writes, v, meter)
  };
}

describe("resumable runtime references", () => {
  it("defers attribute access until after the yielded receiver is resolved", () => {
    const state = fixture(), { v, events, writes } = state, cursor = state.continuation("(yield 1).member");
    expect(events).toEqual([]); expect(cursor.next()).toEqual({ done: false, value: v.integer(1) });
    const step = cursor.next(v.none); if (!step.done) throw Error("reference not completed");
    expect(events).toEqual([]); step.value.set(v.true); expect(step.value.get()).toBe(v.true);
    writes.setAttribute = () => { throw Error("new setter"); };
    expect(() => step.value.set(v.false)).toThrow("new setter");
    step.value.remove(); expect(events).toEqual(["set:member", "get-attribute", "delete-attribute"]);
  });

  it("retains slice bounds and receiver identity while observing its current contents", () => {
    const state = fixture(), { v, names, events } = state, obj = v.list([v.integer(1), v.integer(2), v.integer(3)]);
    names.set("obj", obj); const cursor = state.continuation("obj[(yield 1):(yield 2)]");
    expect(cursor.next()).toEqual({ done: false, value: v.integer(1) });
    expect(cursor.next(v.integer(0))).toEqual({ done: false, value: v.integer(2) });
    names.set("obj", v.list([])); obj.items.set(0n, v.true);
    const step = cursor.next(v.integer(2)); if (!step.done) throw Error("reference not completed");
    const read = step.value.get(); if (read.kind !== "list") throw Error("expected slice");
    expect(read.items.snapshot()).toEqual([v.true, v.integer(2)]);
    step.value.set(v.tuple([v.false])); expect(obj.items.snapshot()).toEqual([v.false, v.integer(3)]);
    step.value.remove(); expect(obj.items.length).toBe(0); expect(events).toEqual(["load:obj"]);
  });

  it("does not publish a reference when target evaluation receives an error", () => {
    const state = fixture(), { v, names, events } = state, obj = v.list([v.true]); names.set("obj", obj);
    const cursor = state.continuation("obj[(yield 1)]"), failure = Error("injected");
    expect(cursor.next()).toEqual({ done: false, value: v.integer(1) });
    expect(() => cursor.throw(failure)).toThrow(failure);
    expect(obj.items.snapshot()).toEqual([v.true]); expect(events).toEqual(["load:obj"]);
    expect(cursor.next(v.none)).toEqual({ done: true, value: undefined });
  });

  it("checks fatal limits before resuming reference evaluation or creating its frame", () => {
    const state = fixture(), { v, meter, events, context, writes } = state;
    const cursor = state.continuation("(yield 1).member");
    expect(cursor.next()).toEqual({ done: false, value: v.integer(1) });
    expect(() => meter.checkpoint(10000)).toThrow(ExecutionLimitError);
    expect(() => cursor.next(v.none)).toThrow(ExecutionLimitError); expect(events).toEqual([]);
    expect(() => createRuntimeReferenceContinuation(parseExpression("obj.x"), context, writes, v,
      new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 351 }))).toThrow("execution allocation limit exceeded");
    expect(events).toEqual([]);
  });
});

describe("runtime target references", () => {
  it.each(["get","set","remove"] as const)("checks position callback failures before reference %s",operation=>{
    for(const mode of ["abort","throw","both"]){
      const state=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
      state.names.set("x",state.v.none);
      const reference=resolveRuntimeReference(parseExpression("(\n x\n).member"),state.context,{...state.writes,position(site){
        expect(site.start.line).toBe(3);
        if(mode!=="throw")controller.abort();
        if(mode!=="abort")throw Error("position failure");
      }},state.v,meter);
      state.events.length=0;
      expect(()=>operation==="set"?reference.set(state.v.true):reference[operation]()).toThrow(mode==="throw"?"position failure":"execution cancelled");
      expect(state.events).toEqual([]);
    }
  });
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
