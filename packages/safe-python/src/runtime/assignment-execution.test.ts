import { describe, expect, it } from "vitest";
import { parseModule } from "../module.js";
import { analyzeModule } from "../analysis.js";
import { executeAssignment, type AssignmentExecutionContext } from "./assignment-execution.js";
import { ExecutionBudget } from "./execution-budget.js";
import { unpackAssignment } from "./assignment-unpacking.js";

function fixture() {
  const events: string[] = [], names = new Map<string, unknown>();
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 10000 });
  const context: AssignmentExecutionContext<unknown> = {
    evaluate: expression => { const label = expression.kind === "name" ? expression.name : expression.kind; events.push(`eval:${label}`); if (label === "fail") throw new Error("evaluation failed"); return label === "rhs" ? [1, 2] : label; },
    store: (name, value) => { events.push(`store:${name}`); names.set(name, value); },
    resolve: target => { events.push(`resolve:${target.kind}`); return { set: value => { events.push(`set:${target.kind}`); names.set("reference", value); } }; },
    list: values => [...values],
    unpack: (value, before, after) => unpackAssignment((value as unknown[])[Symbol.iterator](), before, after, meter)
  };
  return { context, events, names, run: (source: string) => { const statement = parseModule(source).body[0]; if (statement.kind !== "assignment" && statement.kind !== "annotated-assignment") throw new Error("fixture"); executeAssignment(statement, context, meter); } };
}

describe("ordinary and annotated assignment execution", () => {
  it("meters traversal even when nested empty keys produce no expressions", () => {
    const state = fixture(), statement = parseModule("obj[()]: T").body[0];
    if (statement.kind !== "annotated-assignment" || statement.target.kind !== "subscript") throw new Error("fixture");
    let item = statement.target.items[0];
    if (item.kind !== "tuple") throw new Error("fixture");
    for (let i = 0; i < 1000; i++) item = { ...item, items: [item] };
    const node = { ...statement, target: { ...statement.target, items: [item] } };
    expect(() => executeAssignment(node, state.context, new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 1000 }))).toThrow("execution step limit exceeded");
    expect(state.events).toEqual(["eval:obj"]);
  });

  it("evaluates the RHS once before chained target resolution and unpacking", () => {
    const state = fixture(); state.run("obj.x = a, b = rhs");
    expect(state.events).toEqual(["eval:rhs", "resolve:attribute", "set:attribute", "store:a", "store:b"]);
    expect(state.names.get("reference")).toEqual([1, 2]);
    expect(state.names.get("a")).toBe(1); expect(state.names.get("b")).toBe(2);
  });

  it("does not touch targets when RHS evaluation fails", () => {
    const state = fixture(); expect(() => state.run("obj.x = fail")).toThrow("evaluation failed");
    expect(state.events).toEqual(["eval:fail"]);
  });

  it.each(["x", "obj.x", "obj[*items]"])("ignores annotation expressions during value assignment: %s", target => {
    const state = fixture(); state.run(`${target}: forbidden() = rhs`);
    expect(state.events[0]).toBe("eval:rhs");
    expect(state.events.some(event => event.includes("forbidden"))).toBe(false);
  });

  it.each(["x", "(x)"])("does not load or store valueless name annotations: %s", target => {
    const state = fixture(); state.run(`${target}: forbidden()`);
    expect(state.events).toEqual([]);
  });

  it("evaluates only the receiver of a valueless attribute annotation", () => {
    const state = fixture(); state.run("obj.x: forbidden()");
    expect(state.events).toEqual(["eval:obj"]);
  });

  it("flattens annotation key tuples without constructing them", () => {
    const state = fixture(); state.run("obj[(a, (b, c))]: forbidden()");
    expect(state.events).toEqual(["eval:obj", "eval:a", "eval:b", "eval:c"]);
  });

  it("evaluates slice bounds normally while omitting slice construction", () => {
    const state = fixture(); state.run("obj[(a, b):c:step, d]: forbidden()");
    expect(state.events).toEqual(["eval:obj", "eval:tuple", "eval:c", "eval:step", "eval:d"]);
  });

  it("keeps ordinary list expressions intact and omits absent slice bounds", () => {
    const state = fixture(); state.run("obj[[*items], :upper, ::step]: forbidden()");
    expect(state.events).toEqual(["eval:obj", "eval:list", "eval:upper", "eval:step"]);
  });

  it("stops after a key expression fails without resolving a store", () => {
    const state = fixture(); expect(() => state.run("obj[a, fail, b]: T")).toThrow("evaluation failed");
    expect(state.events).toEqual(["eval:obj", "eval:a", "eval:fail"]);
  });

  it.each(["obj[*items]: T", "obj[(a, (*items,))]: T"])("rejects valueless starred annotation keys during static validation: %s", source => {
    expect(() => analyzeModule(source, { filename: "annotations.py" })).toThrow(expect.objectContaining({ message: expect.stringContaining("can't use starred expression here") }));
  });

  it.each(["obj[*items]: T = rhs", "obj[[*items]]: T", "obj[(*items,):]: T", "obj[*items].x: T"])("accepts starred expressions in executable contexts: %s", source => {
    expect(() => analyzeModule(source)).not.toThrow();
  });
});
