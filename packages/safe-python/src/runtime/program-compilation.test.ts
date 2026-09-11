import { describe, expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = (maxSteps = 10000) => new ExecutionBudget({ maxSteps, maxAllocatedBytes: 100000 });
const constants = { string: (value: string): unknown => value, integer: (value: number): unknown => value, tuple: (values: readonly unknown[]): unknown => [...values] };

describe("whole-program code preparation", () => {
  it("shares one literal source identity across all nested code",()=>{
    const analysis=analyzeModule("def outer():\n class C:\n  def method(self):return lambda:1\n return C"),filename="../folder/🐍.py",allocated:string[]=[];
    const program=compileProgram(analysis,{stripDocstring:false,filename},{...constants,string(value){allocated.push(value);return {value};}},budget());
    expect(program.module.source?.filename).toEqual({value:filename});
    expect(Object.isFrozen(program.module.source)).toBe(true);
    for(const code of [...program.functions.values(),...program.classes.values(),...program.classFunctions.values()])expect(code.source).toBe(program.module.source);
    expect(allocated.filter(value=>value===filename)).toHaveLength(1);
  });
  it("prepares module, nested function, lambda and class code from one analysis", () => {
    const analysis = analyzeModule('"module doc"\ndef outer(x=lambda: 1):\n class C:\n  def method(self): self.x=1');
    const program = compileProgram(analysis, { stripDocstring: false }, constants, budget());
    expect(program.module.scope).toBe(analysis.scopes);
    expect(program.module.docstring).toEqual({ value: "module doc" });
    expect(program.module.statements.map(statement => statement.kind)).toEqual(["function"]);
    expect([...program.functions.values()].map(code => code.qualifiedName)).toEqual(["<lambda>", "outer", "outer.<locals>.C.method"]);
    expect([...program.classes.values()].map(code => [code.qualifiedName, code.staticAttributes])).toEqual([["outer.<locals>.C", ["x"]]]);
    for (const [node, code] of program.functions) expect(code.scope.scope.node).toBe(node);
    for (const [node, code] of program.classes) expect(code.scope.scope.node).toBe(node);
  });
  it("prepares lambda bodies nested inside comprehension scopes", () => {
    const analysis = analyzeModule("xs=[lambda: 1 for x in []]\nys=(lambda: 2 for y in [])");
    const program = compileProgram(analysis, { stripDocstring: false }, constants, budget());
    expect([...program.functions.values()].map(code => code.qualifiedName)).toEqual(["<lambda>", "<genexpr>.<lambda>"]);
    expect([...program.comprehensions!.values()].map(scope => scope.scope.kind)).toEqual(["comprehension", "comprehension"]);
    for(const code of program.functions.values())expect(code.comprehensions).toBe(program.comprehensions);
  });
  it("rejects invalid nested docstrings even in uncalled and unreachable definitions", () => {
    for (const definition of ['def f():\n "\\ud800"', 'class C:\n "\\ud800"']) {
      const analysis = analyzeModule('marker()\nif False:\n '+definition.split('\n').join('\n '));
      expect(() => compileProgram(analysis, { stripDocstring: false }, constants, budget())).toThrow("surrogates not allowed");
    }
  });
  it("applies docstring stripping to the entire program", () => {
    const analysis = analyzeModule('"\\ud800"\nclass C:\n "\\ud800"\n def f():\n  "\\ud800"');
    const program = compileProgram(analysis, { stripDocstring: true }, constants, budget());
    expect(program.module.docstring).toBeUndefined();
    for (const code of [...program.functions.values(), ...program.classes.values()]) expect(code.docstring).toBeUndefined();
  });
  it("preserves guest undefined docstring constants", () => {
    const analysis = analyzeModule('"doc"');
    const program = compileProgram(analysis, { stripDocstring: false }, { ...constants, string: () => undefined }, budget());
    expect(program.module.docstring).toEqual({ value: undefined });
  });
  it("does not mutate or execute the analyzed module", () => {
    const analysis = analyzeModule('"doc"\nmissing()');
    const first = compileProgram(analysis, { stripDocstring: false }, constants, budget());
    const second = compileProgram(analysis, { stripDocstring: false }, constants, budget());
    expect(analysis.module.body).toHaveLength(2);
    expect(first.module.statements).toHaveLength(1);
    expect(first).not.toBe(second);
    expect(first.module.statements).not.toBe(second.module.statements);
  });
  it("checks the entry budget before constant allocation", () => {
    const analysis = analyzeModule('"doc"');
    expect(() => compileProgram(analysis, { stripDocstring: false }, constants, budget(0))).toThrow(ExecutionLimitError);
  });
});
