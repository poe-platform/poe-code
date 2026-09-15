import { describe, expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { executeClassBody, type ClassBodyContext } from "./class-body.js";
import { CallStack } from "./call-stack.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { compileClassBody } from "./class-compilation.js";

function fixture(source = 'class C:\n "documentation"\n marker', failure?: string) {
  const analysis = analyzeModule(source), scope = analysis.scopes.children[0];
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  const calls = new CallStack<object>(10, meter), locals = new Map<string, unknown>(), events: string[] = [];
  const globals = new Map<string, unknown>([["__name__", "module"]]);
  const error = new PythonRuntimeError("ValueError", "failure");
  const step = (event: string) => { events.push(event); if (event === failure) throw error; };
  const context: ClassBodyContext<unknown> = {
    globals, builtins: new Map(),
    locals: {
      lookup: name => { step(`get:${name}`); return locals.has(name) ? { value: locals.get(name) } : undefined; },
      store: (name, value) => { step(`set:${name}`); locals.set(name, value); },
      delete: name => locals.delete(name), isGuest: error => error instanceof PythonRuntimeError
    },
    calls, cell: value => value,
    body: frame => {
      expect(calls.current).toBe(frame);
      return {
        evaluate: () => { throw new Error("unexpected expression"); },
        test: () => true, iterate: () => [][Symbol.iterator](), assign: () => { throw new Error("unexpected assignment"); },
        execute: stmt => { step("suite"); if (stmt.kind === "function") expect(frame.capture(scope.children[0]).get("__class__")).toBe(frame.classCell); }
      };
    }
  };
  const compile = (stripDocstring = false) => compileClassBody(scope, analysis, { stripDocstring }, { string: value => value, integer: value => value, tuple: values => [...values] }, meter);
  const run = (stripDocstring = false) => executeClassBody(compile(stripDocstring), context, meter);
  return { scope, context, calls, locals, globals, events, error, compile, run, meter };
}

describe("class suite execution", () => {
  it("reuses compiled constants while creating fresh class cells for every activation", () => {
    const state = fixture('class C:\n "documentation"\n def method(self): return __class__');
    const code = state.compile();
    const first = executeClassBody(code, state.context, state.meter);
    const attributes = state.locals.get("__static_attributes__");
    state.globals.set("__name__", "another_module");
    state.locals.clear();
    const second = executeClassBody(code, state.context, state.meter);
    expect(first).not.toBe(second);
    expect(state.locals.get("__classcell__")).toBe(second);
    expect(state.locals.get("__static_attributes__")).toBe(attributes);
    expect(attributes).toBe(code.staticAttributes);
    expect(state.locals.get("__module__")).toBe("another_module");
    expect(state.locals.get("__doc__")).toBe(code.docstring!.value);
    expect(state.calls.depth).toBe(0);
  });

  it("installs metadata around the suite in Python order", () => {
    const state = fixture();
    expect(state.run()).toBeUndefined();
    expect(state.events).toEqual(["get:__name__", "set:__module__", "set:__qualname__", "set:__firstlineno__", "set:__doc__", "suite", "set:__static_attributes__"]);
    expect(Object.fromEntries(state.locals)).toEqual({ __module__: "module", __qualname__: "C", __firstlineno__: 1, __doc__: "documentation", __static_attributes__: [] });
    expect(state.calls.depth).toBe(0);
  });

  it("reads module identity through the prepared namespace", () => {
    const state = fixture(); state.locals.set("__name__", "prepared");
    state.run(); expect(state.locals.get("__module__")).toBe("prepared");
  });

  it("uses the first decorator line without executing decorators again", () => {
    const state = fixture("\n@decorator\nclass C: pass");
    state.run(); expect(state.locals.get("__firstlineno__")).toBe(2);
  });

  it("strips leading docstrings without evaluating or assigning them", () => {
    const state = fixture(); state.run(true);
    expect(state.locals.has("__doc__")).toBe(false);
    expect(state.events).not.toContain("doc");
    expect(state.events.filter(event => event === "suite")).toHaveLength(1);
  });

  it("cleans docstring indentation while retaining surrounding blank lines", () => {
    const state = fixture('class C:\n """  heading\n\ttext\n\t  deeper\n """');
    state.run();
    expect(state.locals.get("__doc__")).toBe("heading\ntext\n  deeper\n");
  });

  it("stores and returns the shared cell after the final metadata store", () => {
    const state = fixture("class C:\n def method(self): return __class__");
    const cell = state.run();
    expect(cell).toBeDefined(); expect(cell!.content).toBeUndefined();
    expect(state.locals.get("__classcell__")).toBe(cell);
    expect(state.events.slice(-2)).toEqual(["set:__static_attributes__", "set:__classcell__"]);
  });

  it.each(["get:__name__", "set:__module__", "set:__qualname__", "set:__firstlineno__", "set:__doc__", "suite", "set:__static_attributes__"])("restores active frames after %s fails", failure => {
    const state = fixture(undefined, failure), caller = {};
    const leave = state.calls.enter(caller);
    expect(() => state.run()).toThrow(state.error);
    expect(state.events.at(-1)).toBe(failure);
    expect(state.calls.current).toBe(caller); expect(state.calls.depth).toBe(1); leave();
  });

  it("restores frames after fatal exhaustion inside the suite", () => {
    const state = fixture("class C: marker");
    state.context.body = () => ({ evaluate: () => 0, test: () => true, iterate: () => [][Symbol.iterator](), assign: () => {}, execute: () => state.meter.checkpoint(10000) });
    expect(() => state.run()).toThrow(ExecutionLimitError);
    expect(state.calls.depth).toBe(0);
    expect(state.locals.has("__static_attributes__")).toBe(false);
  });

  it("rejects non-class scopes before effects", () => {
    const state = fixture("def f(): pass");
    expect(() => state.run()).toThrow("class bodies require a class scope");
    expect(state.events).toEqual([]);
  });
});
