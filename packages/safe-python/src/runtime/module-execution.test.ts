import { describe, expect, it } from "vitest";
import { analyzeModule,analyzeExpression } from "../analysis.js";
import type { Expression } from "../ast.js";
import { compileProgram } from "./program-compilation.js";
import { executeModule, type ModuleExecutionContext } from "./module-execution.js";
import { CallStack } from "./call-stack.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture(source = '"documentation"\nx=value', stripDocstring = false) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  const code = compileProgram<unknown>(analyzeModule(source), { stripDocstring }, { string: value => value, integer: value => value, tuple: values => [...values] }, meter).module;
  const globals = new Map<string, unknown>([["value", 42]]), events: string[] = [], calls = new CallStack<object>(10, meter);
  const context: ModuleExecutionContext<unknown> = {
    globals, builtins: new Map(), calls,
    body: frame => {
      expect(calls.current).toBe(frame);
      const evaluate = (expression: Expression): unknown => {
        if (expression.kind === "name") return frame.load(expression.name);
        if (expression.kind === "literal") return expression.value;
        throw new Error("unexpected expression");
      };
      return {
        evaluate, test: expression => Boolean(evaluate(expression)), iterate: value => (value as Iterable<unknown>)[Symbol.iterator](),
        assign: (target, value) => { if (target.kind !== "name") throw new Error("unexpected target"); frame.store(target.name, value); },
        execute: statement => {
          events.push(statement.kind);
          if (statement.kind === "assignment") {
            const value = evaluate(statement.value);
            for (const target of statement.targets) { if (target.kind !== "name") throw new Error("unexpected target"); frame.store(target.name, value); }
          } else if (statement.kind === "expression-statement") evaluate(statement.expression);
        }
      };
    }
  };
  const run = () => executeModule(code, context, meter);
  return { code, context, globals, events, calls, meter, run };
}

describe("compiled module execution", () => {
  it("returns expression values without storing docstrings or executing statements",()=>{
    const state=fixture("pass");
    const code=compileProgram(analyzeExpression("value"),{stripDocstring:false},{string:value=>value,integer:value=>value,tuple:values=>values},state.meter).module;
    expect(executeModule(code,state.context,state.meter)).toBe(42);
    expect(state.events).toEqual([]);expect(state.globals.has("__doc__")).toBe(false);
    expect(state.calls.depth).toBe(0);
  });
  it("restores the caller when expression evaluation fails",()=>{
    const state=fixture("pass"),caller={},leave=state.calls.enter(caller);
    const code=compileProgram(analyzeExpression("missing"),{stripDocstring:false},{string:value=>value,integer:value=>value,tuple:values=>values},state.meter).module;
    expect(()=>executeModule(code,state.context,state.meter)).toThrow("name 'missing' is not defined");
    expect(state.calls.current).toBe(caller);leave();
  });
  it("preserves fatal limits masked by expression callbacks",()=>{
    const state=fixture("pass");
    const code=compileProgram(analyzeExpression("value"),{stripDocstring:false},{string:value=>value,integer:value=>value,tuple:values=>values},state.meter).module;
    const context={...state.context,body:(frame:Parameters<typeof state.context.body>[0])=>({...state.context.body(frame),evaluate(){try{state.meter.checkpoint(10000);}catch{/* host callback masks the original failure */}throw new Error("callback failure");}})};
    expect(()=>executeModule(code,context,state.meter)).toThrow(ExecutionLimitError);
    expect(state.calls.depth).toBe(0);
  });
  it("stores the compiled docstring and executes ordinary statements", () => {
    const state = fixture(); state.run();
    expect(state.globals.get("__doc__")).toBe("documentation");
    expect(state.globals.get("x")).toBe(42);
    expect(state.events).toEqual(["assignment"]);
    expect(state.calls.depth).toBe(0);
  });
  it.each([false, true])("leaves existing doc metadata unchanged when no docstring is emitted: %s", strip => {
    const state = fixture(strip ? '"doc"\npass' : "pass", strip);
    state.globals.set("__doc__", "old"); state.run();
    expect(state.globals.get("__doc__")).toBe("old");
  });
  it("uses separate locals for metadata and ordinary stores", () => {
    const state = fixture(), locals = new Map<string, unknown>();
    executeModule(state.code, { ...state.context, locals: { lookup: name => locals.has(name) ? { value: locals.get(name) } : undefined, store: (name, value) => { locals.set(name, value); }, delete: name => locals.delete(name), isGuest: () => false } }, state.meter);
    expect(Object.fromEntries(locals)).toEqual({ __doc__: "documentation", x: 42 });
    expect(state.globals.has("x")).toBe(false);
  });
  it("restores the caller and preserves preceding mutations after statement failure", () => {
    const state = fixture('"doc"\nx=value\nmissing'), caller = {}, leave = state.calls.enter(caller);
    expect(() => state.run()).toThrow("name 'missing' is not defined");
    expect(state.globals.get("x")).toBe(42);
    expect(state.calls.current).toBe(caller); leave();
  });
  it("restores frames after fatal exhaustion during docstring storage", () => {
    const state = fixture();
    expect(() => executeModule(state.code, { ...state.context, locals: { lookup: () => undefined, store: () => state.meter.checkpoint(10000), delete: () => false, isGuest: () => true } }, state.meter)).toThrow(ExecutionLimitError);
    expect(state.calls.depth).toBe(0); expect(state.events).toEqual([]);
  });
  it("reuses compiled code with live globals across executions", () => {
    const state = fixture(); state.run(); state.globals.set("value", 99); state.run();
    expect(state.globals.get("x")).toBe(99); expect(state.calls.depth).toBe(0);
  });
});
