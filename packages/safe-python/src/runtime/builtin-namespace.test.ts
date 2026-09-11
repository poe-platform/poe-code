import { describe, expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { LexicalFrame } from "./lexical-frame.js";
import { ClassFrame } from "./class-frame.js";
import { ModuleFrame } from "./module-frame.js";
import { ExecutionBudget,ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { compileProgram } from "./program-compilation.js";
import { createFunctionState } from "./function-state.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });

describe("builtin namespace protocols", () => {
  it("reads function module metadata intrinsically before selecting builtins",()=>{
    const program=compileProgram<unknown>(analyzeModule("def f():pass"),{stripDocstring:false},{string:value=>value,integer:value=>value,tuple:values=>values},budget());
    const events:unknown[]=[],module={},builtins={};
    const globals={lookup(name:string,access?:"intrinsic"){events.push([name,access]);return {value:name==="__name__"?module:builtins};},store(){},delete:()=>false};
    const state=createFunctionState([...program.functions.values()][0],new Map(),{globals,builtins:new Map(),none:null,resolveBuiltins(value){events.push(value);return new Map();}},budget());
    expect(state.module).toBe(module);
    expect(events).toEqual([["__name__","intrinsic"],["__builtins__","intrinsic"],builtins]);
  });
  it.each([false,true])("preserves cancellation from module lookup before builtin selection (throws=%s)",throws=>{
    const program=compileProgram<unknown>(analyzeModule("def f():pass"),{stripDocstring:false},{string:value=>value,integer:value=>value,tuple:values=>values},budget());
    const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}),events:string[]=[];
    const globals={lookup(name:string){events.push(name);if(name==="__name__"){controller.abort();if(throws)throw Error("module failed");}return undefined;},store(){},delete:()=>false};
    expect(()=>createFunctionState([...program.functions.values()][0],new Map(),{globals,builtins:new Map(),none:null},meter)).toThrow(ExecutionLimitError);
    expect(events).toEqual(["__name__"]);
  });
  it.each(["module", "function", "class"])("supports builtin mapping lookup in %s frames", kind => {
    const analysis = analyzeModule(kind === "module" ? "x" : `${kind === "function" ? "def f():" : "class C:"}\n x\n missing`);
    const globals = new Map<string, unknown>(), values = new Map<string, unknown>([["x", undefined]]), events: string[] = [];
    const namespaces = { globals, builtins: { lookup: (name: string) => { events.push(name); return values.has(name) ? { value: values.get(name) } : undefined; } } };
    const frame = kind === "module" ? new ModuleFrame(analysis.scopes, namespaces, budget())
      : kind === "function" ? new LexicalFrame(analysis.scopes.children[0], namespaces, budget())
      : new ClassFrame(analysis.scopes.children[0], { ...namespaces, locals: { lookup: () => undefined, store: () => {}, delete: () => false, isGuest: () => true } }, budget());
    expect(frame.load("x")).toBeUndefined();
    values.set("x", 42); expect(frame.load("x")).toBe(42);
    expect(() => frame.load("missing")).toThrow("name 'missing' is not defined");
    expect(events).toEqual(["x", "x", "missing"]);
    globals.set("x", 9); expect(frame.load("x")).toBe(9);
    expect(events).toHaveLength(3);
  });

  it.each(["module", "function", "class"])("preserves non-missing builtin protocol failures in %s frames", kind => {
    const analysis = analyzeModule(kind === "module" ? "x" : `${kind === "function" ? "def f():" : "class C:"}\n x`);
    const error = new PythonRuntimeError("TypeError", "'NoneType' object is not subscriptable");
    const namespaces = { globals: new Map(), builtins: { lookup: () => { throw error; } } };
    const frame = kind === "module" ? new ModuleFrame(analysis.scopes, namespaces, budget())
      : kind === "function" ? new LexicalFrame(analysis.scopes.children[0], namespaces, budget())
      : new ClassFrame(analysis.scopes.children[0], { ...namespaces, locals: { lookup: () => undefined, store: () => {}, delete: () => false, isGuest: () => true } }, budget());
    expect(() => frame.load("x")).toThrow(error);
  });

  it("selects globals.__builtins__ once per function definition without performing a lookup", () => {
    const program = compileProgram<unknown>(analyzeModule("def f(): return x"), { stripDocstring: false }, { string: value => value, integer: value => value, tuple: values => [...values] }, budget());
    const code = [...program.functions.values()][0], original = {}, replacement = {}, events: unknown[] = [];
    const globals = new Map<string, unknown>([["__builtins__", original]]), fallback = new Map<string, unknown>();
    const context = {
      globals, builtins: fallback, none: null,
      resolveBuiltins: (value: unknown) => { events.push(value); return { lookup: (name: string) => { events.push(name); return { value }; } }; }
    };
    const first = createFunctionState(code, new Map(), context, budget());
    expect(events).toEqual([original]);
    globals.set("__builtins__", replacement);
    const second = createFunctionState(code, new Map(), context, budget());
    expect(new LexicalFrame(code.scope, first, budget()).load("x")).toBe(original);
    expect(new LexicalFrame(code.scope, second, budget()).load("x")).toBe(replacement);
    expect(events).toEqual([original, replacement, "x", "x"]);
    globals.delete("__builtins__");
    expect(createFunctionState(code, new Map(), context, budget()).builtins).toBe(fallback);
  });

  it("passes an explicitly present undefined builtin value to the resolver", () => {
    const program = compileProgram<unknown>(analyzeModule("def f(): pass"), { stripDocstring: false }, { string: value => value, integer: value => value, tuple: values => [...values] }, budget());
    const code = [...program.functions.values()][0], selected = new Map<string, unknown>(), seen: unknown[] = [];
    const value = createFunctionState(code, new Map(), { globals: new Map([["__builtins__", undefined]]), builtins: new Map(), none: null,
      resolveBuiltins: value => { seen.push(value); return selected; } }, budget());
    expect(value.builtins).toBe(selected); expect(seen).toEqual([undefined]);
  });
});
