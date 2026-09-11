import { describe, expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { compileClassBody, type ClassConstants } from "./class-compilation.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = (steps = 10000) => new ExecutionBudget({ maxSteps: steps, maxAllocatedBytes: 100000 });
function fixture(source = 'class C:\n "document"\n def f(self): self.x=1') {
  const analysis = analyzeModule(source), scope = analysis.scopes.children[0], events: string[] = [];
  const constants: ClassConstants<unknown> = {
    string: value => { events.push(`string:${value}`); return { text: value }; },
    integer: value => { events.push(`integer:${value}`); return { integer: value }; },
    tuple: values => { events.push("tuple"); return { items: [...values] }; }
  };
  const run = (stripDocstring = false, steps = 10000) => compileClassBody(scope, analysis, { stripDocstring }, constants, budget(steps));
  return { analysis, scope, constants, events, run };
}

describe("class code metadata compilation", () => {
  it.each([
    ["@(\n decorate\n)\nclass C:pass",2],
    ["@(\n (\n decorate\n )\n)\n@other\nclass C:pass",3]
  ])("uses the first decorator content line: %s",(source,line)=>{
    expect(fixture(source).run().firstLine).toEqual({integer:line});
  });
  it("materializes analyzer metadata and removes the leading docstring from executable statements", () => {
    const state = fixture(), code = state.run();
    expect(code.scope).toBe(state.scope);
    expect(code.qualifiedName).toEqual({ text: "C" });
    expect(code.firstLine).toEqual({ integer: 1 });
    expect(code.staticAttributes).toEqual({ items: [{ text: "x" }] });
    expect(code.docstring).toEqual({ value: { text: "document" } });
    expect(code.statements.map(statement => statement.kind)).toEqual(["function"]);
    expect(state.scope.scope.node.kind === "class" && state.scope.scope.node.body).toHaveLength(2);
  });
  it("uses lexical nested names and the first decorator line", () => {
    const state = fixture("def outer():\n @decorate\n class C: pass");
    const code = compileClassBody(state.scope.children[0], state.analysis, { stripDocstring: false }, state.constants, budget());
    expect(code.qualifiedName).toEqual({ text: "outer.<locals>.C" });
    expect(code.firstLine).toEqual({ integer: 2 });
  });
  it("cleans docstring indentation during compilation", () => {
    const code = fixture('class C:\n """  head\n\ttext\n """').run();
    expect(code.docstring).toEqual({ value: { text: "head\ntext\n" } });
  });
  it("strips docstrings without materializing their text", () => {
    const state = fixture(), code = state.run(true);
    expect(code.docstring).toBeUndefined();
    expect(state.events).not.toContain("string:document");
    expect(code.statements).toHaveLength(1);
  });
  it("preserves an empty docstring and a guest undefined string value", () => {
    const state = fixture('class C:\n ""'); state.constants.string = () => undefined;
    expect(state.run().docstring).toEqual({ value: undefined });
  });
  it("does not mistake bytes or formatted strings for docstrings", () => {
    for (const literal of ['b"text"', 'f"text"']) {
      const code = fixture(`class C:\n ${literal}`).run();
      expect(code.docstring).toBeUndefined(); expect(code.statements).toHaveLength(1);
    }
  });
  it("requires metadata for the exact scope identity", () => {
    const state = fixture(), other = fixture();
    expect(() => compileClassBody(state.scope, other.analysis, { stripDocstring: false }, state.constants, budget())).toThrow("missing analyzed class metadata");
    expect(state.events).toEqual([]);
  });
  it("rejects non-class scopes before allocation", () => {
    const state = fixture("def f(): pass");
    expect(() => state.run()).toThrow("class bodies require a class scope");
    expect(state.events).toEqual([]);
  });
  it("checks the entry budget before allocation", () => {
    const state = fixture(); expect(() => state.run(false, 0)).toThrow(ExecutionLimitError);
    expect(state.events).toEqual([]);
  });
  it("propagates constant allocation failure without producing code", () => {
    const state = fixture(), error = new Error("allocation");
    state.constants.tuple = () => { throw error; };
    expect(() => state.run()).toThrow(error);
  });
});
