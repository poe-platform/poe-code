import { describe, expect, it } from "vitest";
import { parseModule } from "../module.js";
import type { Expression } from "../ast.js";
import { deleteTargets, type DeletionContext } from "./deletion-targets.js";
import { ExecutionBudget } from "./execution-budget.js";

function targets(source: string) {
  const node = parseModule(`del ${source}`).body[0];
  if (node.kind !== "delete") throw new Error("fixture");
  return node.targets;
}
function fixture(maxSteps = 100000) {
  const names = new Map<string, unknown>([["a", 1], ["b", 2], ["c", 3]]), events: string[] = [];
  const context: DeletionContext = {
    removeName: name => { events.push(`delete:${name}`); if (!names.delete(name)) throw new Error(`missing:${name}`); },
    resolve: target => { events.push(`resolve:${target.kind}`); return { remove: () => { events.push(`remove:${target.kind}`); } }; }
  };
  const meter = new ExecutionBudget({ maxSteps, maxAllocatedBytes: 10000 });
  return { context, names, events, meter };
}

describe("deletion target traversal", () => {
  it("deletes nested tuple/list targets left to right without value unpacking", () => {
    const state = fixture();
    deleteTargets(targets("(a, [b, c])"), state.context, state.meter);
    expect(state.events).toEqual(["delete:a", "delete:b", "delete:c"]);
    expect(state.names.size).toBe(0);
  });

  it("preserves earlier deletions and skips later targets after failure", () => {
    const state = fixture();
    expect(() => deleteTargets(targets("a, (missing, b), c"), state.context, state.meter)).toThrow("missing:missing");
    expect([...state.names.keys()]).toEqual(["b", "c"]);
    expect(state.events).toEqual(["delete:a", "delete:missing"]);
  });

  it("resolves references only when reached and never reads the deleted value", () => {
    const state = fixture();
    deleteTargets(targets("a, obj.x, seq[key], b"), state.context, state.meter);
    expect(state.events).toEqual(["delete:a", "resolve:attribute", "remove:attribute", "resolve:subscript", "remove:subscript", "delete:b"]);
  });

  it("observes earlier deletions during later reference resolution", () => {
    const state = fixture();
    state.context.resolve = () => { expect(state.names.has("a")).toBe(false); throw new Error("receiver unavailable"); };
    expect(() => deleteTargets(targets("a, a.x, b"), state.context, state.meter)).toThrow("receiver unavailable");
    expect(state.names.has("b")).toBe(true);
  });

  it("accepts empty nested target lists", () => {
    const state = fixture();
    deleteTargets(targets("(), [], ([], ())"), state.context, state.meter);
    expect(state.events).toEqual([]);
  });

  it("does not recurse on deeply nested target trees", () => {
    let target: Expression = targets("a")[0];
    for (let i = 0; i < 10000; i++) target = { ...target, kind: "tuple", items: [target] };
    const state = fixture(); deleteTargets([target], state.context, state.meter);
    expect(state.events).toEqual(["delete:a"]);
  });

  it("checks limits after reference resolution and before deletion", () => {
    const state = fixture(2);
    expect(() => deleteTargets(targets("obj.x"), state.context, state.meter)).toThrow("execution step limit exceeded");
    expect(state.events).toEqual(["resolve:attribute"]);
  });
});
