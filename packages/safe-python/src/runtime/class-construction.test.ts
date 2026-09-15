import { describe, expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import type { LexicalCell } from "./lexical-frame.js";
import { constructClass, type ClassConstructionContext } from "./class-construction.js";

function fixture() {
  const result = { type: true, text: "<class 'C'>" }, events: string[] = [];
  const prepared = { metaclass: {}, namespace: {}, keywords: new Map<string, unknown>([["flag", 1]]) };
  const bases = {};
  const cell: LexicalCell<unknown> = { owner: analyzeModule("class C: pass").scopes.children[0].scope };
  const context: ClassConstructionContext<unknown> = {
    call: (meta, name, receivedBases, namespace, keywords) => {
      events.push("call");
      expect([meta, name, receivedBases, namespace, keywords]).toEqual([prepared.metaclass, "C", bases, prepared.namespace, prepared.keywords]);
      return result;
    },
    isType: value => value === result,
    reprName: name => { events.push("name"); return `'${name}'`; },
    repr: value => { events.push(value === result ? "result" : "cell"); return value === result ? result.text : "wrong"; }
  };
  const run = (captured: LexicalCell<unknown> | undefined = cell, maxSteps = 1000) => constructClass(
    "C", bases, prepared, captured, context, new ExecutionBudget({ maxSteps, maxAllocatedBytes: 10000 })
  );
  return { result, prepared, bases, cell, context, events, run };
}

describe("class construction completion", () => {
  it("calls the selected metaclass and accepts its matching captured class", () => {
    const state = fixture();
    const call = state.context.call;
    state.context.call = (...args) => { const result = call(...args); state.cell.content = { value: result }; return result; };
    expect(state.run()).toBe(state.result);
    expect(state.events).toEqual(["call"]);
  });

  it("does not require a class cell when no methods captured it", () => {
    const state = fixture();
    expect(constructClass("C", state.bases, state.prepared, undefined, state.context, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 1000 }))).toBe(state.result);
    expect(state.events).toEqual(["call"]);
  });

  it.each([undefined, null, 0, {}])("accepts arbitrary non-type metaclass results: %s", result => {
    const state = fixture();
    state.context.call = () => result;
    expect(state.run()).toBe(result);
    expect(state.events).toEqual([]);
  });

  it("reports an unpopulated captured cell after metaclass success", () => {
    const state = fixture();
    expect(() => state.run()).toThrow(expect.objectContaining({ name: "RuntimeError", message: "__class__ not set defining 'C' as <class 'C'>. Was __classcell__ propagated to type.__new__?" }));
    expect(state.events).toEqual(["call", "name", "result"]);
  });

  it("reports a mismatched populated cell without using guest equality", () => {
    const state = fixture();
    state.cell.content = { value: {} };
    expect(() => state.run()).toThrow(expect.objectContaining({ name: "TypeError", message: "__class__ set to wrong defining 'C' as <class 'C'>" }));
    expect(state.events).toEqual(["call", "cell", "name", "result"]);
  });

  it("distinguishes a populated undefined value from an empty cell", () => {
    const state = fixture();
    state.cell.content = { value: undefined };
    expect(() => state.run()).toThrow(expect.objectContaining({ name: "TypeError" }));
    expect(state.events).toContain("cell");
  });

  it("does not roll back metaclass side effects when cell validation fails", () => {
    const state = fixture();
    state.context.call = () => { state.cell.content = { value: 123 }; return state.result; };
    expect(() => state.run()).toThrow(expect.objectContaining({ name: "TypeError" }));
    expect(state.cell.content).toEqual({ value: 123 });
  });

  it("does not validate or format a cell after metaclass failure", () => {
    const state = fixture(), error = new Error("metaclass failed");
    state.context.call = () => { throw error; };
    expect(() => state.run()).toThrow(error);
    expect(state.events).toEqual([]);
  });

  it.each(["name", "cell", "result"])("propagates %s representation failures", stage => {
    const state = fixture(), error = new Error("repr failed");
    state.cell.content = { value: {} };
    if (stage === "name") state.context.reprName = () => { throw error; };
    else state.context.repr = value => { if ((value === state.result ? "result" : "cell") === stage) throw error; return "wrong"; };
    expect(() => state.run()).toThrow(error);
  });

  it("checks limits before calling the metaclass", () => {
    const state = fixture();
    expect(() => state.run(state.cell, 0)).toThrow(ExecutionLimitError);
    expect(state.events).toEqual([]);
  });

  it("checks limits between metaclass success and representation effects", () => {
    const state = fixture();
    expect(() => state.run(state.cell, 1)).toThrow(ExecutionLimitError);
    expect(state.events).toEqual(["call"]);
  });
});
