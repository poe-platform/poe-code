import { describe, expect, it } from "vitest";
import { parseModule } from "../module.js";
import { parseExpression } from "../expression.js";
import type { Expression } from "../ast.js";
import { assignTargets, type AssignmentContext } from "./assignment-targets.js";
import { unpackAssignment } from "./assignment-unpacking.js";
import { ExecutionBudget } from "./execution-budget.js";

function targets(source: string) {
  const statement = parseModule(`${source} = rhs`).body[0];
  if (statement.kind !== "assignment") throw new Error("invalid fixture");
  return statement.targets;
}
const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 });

function environment(meter = budget()) {
  const names = new Map<string, unknown>(), events: string[] = [];
  const context: AssignmentContext<unknown> = {
    store: (name, value) => { events.push(`store:${name}`); names.set(name, value); },
    unpack: (value, before, after) => { events.push("unpack"); return unpackAssignment((value as Iterable<unknown>)[Symbol.iterator](), before, after, meter); },
    list: values => { events.push("list"); return [...values]; },
    resolve: target => {
      events.push(`resolve:${target.kind}`);
      if (target.object.kind !== "name") throw new Error("unsupported fixture receiver");
      const object = names.get(target.object.name) as Record<string, unknown>;
      const key = target.kind === "attribute" ? target.name : target.items[0].kind === "name" ? String(names.get(target.items[0].name)) : "0";
      return { set: value => { events.push(`set:${key}`); object[key] = value; } };
    }
  };
  return { context, names, events, meter };
}

describe("assignment target traversal", () => {
  it.each(["a = b", "a, b"])("charges queued target records before any child stores: %s", source => {
    // Reserve the continuation before testing queued-target allocations.
    const { context, names, meter } = environment(new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 224 + 72 }));
    context.unpack = () => ({ leading: [1, 2], starred: undefined, trailing: [] });
    expect(() => assignTargets(targets(source), [1, 2], context, meter)).toThrow("execution allocation limit exceeded");
    expect(names.size).toBe(0);
  });
  it.each(["store", "set", "unpack"])("observes cancellation from the final %s callback", callback => {
    const controller = new AbortController();
    const { context, meter } = environment(new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000, signal: controller.signal }));
    context.store = () => { controller.abort(); };
    context.resolve = () => ({ set: () => { controller.abort(); } });
    context.unpack = () => { controller.abort(); return { leading: [], starred: undefined, trailing: [] }; };
    const target = callback === "store" ? targets("a") : callback === "set" ? targets("obj.x") : targets("[]");
    expect(() => assignTargets(target, [], context, meter)).toThrow("execution cancelled");
  });
  it("assigns chained targets left to right using the same RHS identity", () => {
    const { context, names, events, meter } = environment(), value = {};
    assignTargets(targets("a = b"), value, context, meter);
    expect(names.get("a")).toBe(value);
    expect(names.get("b")).toBe(value);
    expect(events).toEqual(["store:a", "store:b"]);
  });

  it("unpacks each level before storing that level's children", () => {
    const { context, names, events, meter } = environment();
    assignTargets(targets("a, (b, c)"), [1, [2, 3]], context, meter);
    expect([...names]).toEqual([["a", 1], ["b", 2], ["c", 3]]);
    expect(events).toEqual(["unpack", "store:a", "unpack", "store:b", "store:c"]);
  });

  it("retains earlier stores when a later nested unpack fails", () => {
    const { context, names, meter } = environment();
    expect(() => assignTargets(targets("a, (b, c)"), [1, [2]], context, meter)).toThrow("not enough values to unpack");
    expect([...names]).toEqual([["a", 1]]);
  });

  it("creates a starred list before storing any child", () => {
    const { context, names, events, meter } = environment();
    assignTargets(targets("a, *b, c"), [1, 2, 3, 4], context, meter);
    expect([...names]).toEqual([["a", 1], ["b", [2, 3]], ["c", 4]]);
    expect(events).toEqual(["unpack", "list", "store:a", "store:b", "store:c"]);
    context.list = () => { throw new Error("allocation failed"); };
    names.clear();
    expect(() => assignTargets(targets("a, *b"), [1, 2], context, meter)).toThrow("allocation failed");
    expect(names.size).toBe(0);
  });

  it("supports a nested target inside the starred target", () => {
    const { context, names, meter } = environment();
    assignTargets(targets("a, *[b, c]"), [1, 2, 3], context, meter);
    expect([...names]).toEqual([["a", 1], ["b", 2], ["c", 3]]);
  });

  it("resolves a subscript only after preceding names have been stored", () => {
    const { context, names, events, meter } = environment();
    const array = [0, 0]; names.set("array", array); names.set("i", 0);
    assignTargets(targets("i, array[i]"), [1, 9], context, meter);
    expect(array).toEqual([0, 9]);
    expect(events).toEqual(["unpack", "store:i", "resolve:subscript", "set:1"]);
  });

  it("resolves attributes in target order and preserves undefined values", () => {
    const { context, names, meter } = environment();
    const object = {}; names.set("obj", object);
    assignTargets(targets("obj.x = a"), undefined, context, meter);
    expect(Object.hasOwn(object, "x")).toBe(true);
    expect(names.has("a")).toBe(true);
  });

  it("does not recurse on the host stack for deep target trees", () => {
    const leaf = parseExpression("a"); let target: Expression = leaf, value: unknown = 1;
    for (let i = 0; i < 5000; i++) { target = { ...leaf, kind: "tuple", items: [target] }; value = [value]; }
    // Each level now accounts for its temporary unpack result and array slots.
    const { context, names, meter } = environment(new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }));
    assignTargets([target], value, context, meter);
    expect(names.get("a")).toBe(1);
  });

  it("checks budgets after reference resolution and before mutation", () => {
    const meter = new ExecutionBudget({ maxSteps: 3, maxAllocatedBytes: 1000 });
    const { context, names, events } = environment(meter), object = {};
    names.set("obj", object);
    expect(() => assignTargets(targets("obj.x"), 1, context, meter)).toThrow("execution step limit exceeded");
    expect(events).toEqual(["resolve:attribute"]);
    expect(object).toEqual({});
  });
});
