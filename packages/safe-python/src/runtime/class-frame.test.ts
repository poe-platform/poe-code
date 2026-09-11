import { describe, expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { LexicalFrame, type LexicalCell } from "./lexical-frame.js";
import { ClassFrame, type ClassNamespaces } from "./class-frame.js";
import {FrameLocalsMapping} from "./frame-locals-mapping.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
function fixture(source: string) {
  const analysis = analyzeModule(source);
  let scope = analysis.scopes.children[0];
  while (scope.scope.kind !== "class") scope = scope.children[0];
  const globals = new Map<string, unknown>(), builtins = new Map<string, unknown>(), locals = new Map<string, unknown>();
  const closure = new Map<string, LexicalCell<unknown>>([...scope.free].map(([name, owner]) => [name, { owner, content: { value: 10 } }]));
  const events: string[] = [];
  const namespaces: ClassNamespaces<unknown> = {
    globals, builtins, closure,
    locals: {
      lookup: name => { events.push(`get:${name}`); return locals.has(name) ? { value: locals.get(name) } : undefined; },
      store: (name, value) => { events.push(`set:${name}`); locals.set(name, value); },
      delete: name => { events.push(`delete:${name}`); return locals.delete(name); },
      isGuest: error => error instanceof PythonRuntimeError
    }
  };
  const frame = new ClassFrame(scope, namespaces, budget());
  return { frame, scope, globals, builtins, locals, closure, events, namespaces };
}

describe("class body namespace storage", () => {
  it("reflects duplicate owned and free cells in physical order without merging them",()=>{
    const state=fixture("def outer(__class__):\n class C:\n  seen=__class__\n  def method(self):return __class__"),view=state.frame.reflectLocals();
    const mapping=new FrameLocalsMapping(view,{name:(name:string)=>name,hash:()=>1n,equal:(a:string,b:string)=>a===b},budget());
    expect(mapping.lookup("__class__")).toEqual({value:10});
    expect(mapping.entries()).toEqual([["__class__",10]]);
    mapping.set("__class__",11);
    expect(state.frame.classCell!.content).toEqual({value:11});
    expect(state.closure.get("__class__")!.content).toEqual({value:10});
    expect(mapping.lookup("__class__")).toEqual({value:11});
    expect(mapping.entries()).toEqual([["__class__",11],["__class__",10]]);
    expect(mapping.size).toBe(2);
    expect(view.snapshot().get("__class__")).toBe(11);
    expect(()=>mapping.delete("__class__")).toThrow("cannot remove local variables");
    delete state.frame.classCell!.content;
    expect(mapping.lookup("__class__")).toEqual({value:10});
    expect(mapping.size).toBe(1);
  });
  it("falls back from unbound class locals to globals and builtins", () => {
    const state = fixture("class C:\n x=x");
    state.builtins.set("x", 1); state.globals.set("x", 2);
    expect(state.frame.load("x")).toBe(2);
    state.frame.store("x", undefined);
    expect(state.frame.load("x")).toBeUndefined();
    state.frame.delete("x"); state.globals.delete("x");
    expect(state.frame.load("x")).toBe(1);
    expect(() => state.frame.delete("x")).toThrow(expect.objectContaining({ name: "NameError" }));
  });

  it("looks in the class mapping before an implicitly captured free cell", () => {
    const state = fixture("def outer():\n x=1\n class C:\n  y=x");
    state.locals.set("x", null); state.globals.set("x", 99);
    expect(state.frame.load("x")).toBeNull();
    state.locals.delete("x");
    expect(state.frame.load("x")).toBe(10);
    delete state.closure.get("x")!.content;
    expect(() => state.frame.load("x")).toThrow(expect.objectContaining({ name: "NameError", message: "cannot access free variable 'x' where it is not associated with a value in enclosing scope" }));
  });

  it("reads nonlocals through the class mapping but writes and deletes their cells", () => {
    const state = fixture("def outer():\n x=1\n class C:\n  nonlocal x\n  x=x\n  del x");
    state.locals.set("x", 99);
    expect(state.frame.load("x")).toBe(99);
    state.frame.store("x", undefined);
    expect(state.closure.get("x")!.content).toEqual({ value: undefined });
    expect(state.frame.load("x")).toBe(99);
    state.frame.delete("x");
    expect(() => state.frame.delete("x")).toThrow(expect.objectContaining({ name: "NameError" }));
    expect(state.locals.get("x")).toBe(99);
    expect(state.events).toEqual(["get:x", "get:x"]);
  });

  it("bypasses locals and closures for explicit globals", () => {
    const state = fixture("def outer():\n x=1\n class C:\n  global x\n  x=x");
    state.locals.set("x", 99); state.builtins.set("x", 2);
    expect(state.frame.load("x")).toBe(2);
    state.frame.store("x", 3);
    expect(state.globals.get("x")).toBe(3);
    state.frame.delete("x");
    expect(state.events).toEqual([]);
  });

  it("does not promote descendant globals to class declarations", () => {
    const state = fixture("class C:\n x=1\n def f(): global x");
    state.frame.store("x", 2);
    expect(state.locals.get("x")).toBe(2);
    expect(state.globals.has("x")).toBe(false);
  });

  it("does not use forwarded method cells for a locally bound class name", () => {
    const state = fixture("def outer():\n x=1\n class C:\n  x=x\n  def f(): return x");
    state.globals.set("x", 8);
    expect(state.frame.load("x")).toBe(8);
    state.frame.store("x", 9);
    const method = new LexicalFrame(state.scope.children[0], { ...state.namespaces, closure: state.frame.capture(state.scope.children[0]) }, budget());
    expect(method.load("x")).toBe(10);
    expect(state.frame.load("x")).toBe(9);
  });

  it("keeps the class-construction cell separate from a namespace __class__ entry", () => {
    const state = fixture("class C:\n __class__=1\n def f(): return __class__");
    const cell = state.frame.classCell!;
    expect(cell.owner).toBe(state.scope.scope);
    expect(cell.content).toBeUndefined();
    state.frame.store("__class__", 20);
    expect(cell.content).toBeUndefined();
    const method = new LexicalFrame(state.scope.children[0], { ...state.namespaces, closure: state.frame.capture(state.scope.children[0]) }, budget());
    expect(() => method.load("__class__")).toThrow(expect.objectContaining({ name: "NameError" }));
    const createdClass = {};
    cell.content = { value: createdClass };
    expect(method.load("__class__")).toBe(createdClass);
    expect(state.frame.load("__class__")).toBe(20);
  });

  it("can keep an enclosing __class__ cell and its own class cell simultaneously", () => {
    const state = fixture("def outer():\n __class__=1\n class C:\n  y=__class__\n  def f(): return __class__");
    expect(state.frame.load("__class__")).toBe(10);
    expect(state.frame.classCell).not.toBe(state.closure.get("__class__"));
    state.frame.classCell!.content = { value: 20 };
    const method = new LexicalFrame(state.scope.children[0], { ...state.namespaces, closure: state.frame.capture(state.scope.children[0]) }, budget());
    expect(method.load("__class__")).toBe(20);
    expect(state.frame.load("__class__")).toBe(10);
  });

  it("mangles private names and allows compiler-injected metadata stores", () => {
    const state = fixture("class C:\n __x=1");
    state.frame.store("__x", 2); state.frame.store("__module__", "example");
    expect(state.locals.get("_C__x")).toBe(2);
    expect(state.frame.load("__x")).toBe(2);
    expect(state.locals.get("__module__")).toBe("example");
    expect(state.frame.classCell).toBeUndefined();
  });

  it("does not swallow mapping read failures while a free cell is available", () => {
    const state = fixture("def outer():\n x=1\n class C: y=x");
    const error = new PythonRuntimeError("ValueError", "mapping failed");
    state.namespaces.locals.lookup = () => { throw error; };
    expect(() => state.frame.load("x")).toThrow(error);
  });

  it("normalizes guest deletion failures but preserves fatal limits", () => {
    const state = fixture("class C: x=1");
    state.namespaces.locals.delete = () => { throw new PythonRuntimeError("ValueError", "mapping failed"); };
    expect(() => state.frame.delete("x")).toThrow(expect.objectContaining({ name: "NameError" }));
    state.namespaces.locals.delete = () => { throw new ExecutionLimitError("steps"); };
    state.namespaces.locals.isGuest = () => true;
    expect(() => state.frame.delete("x")).toThrow(ExecutionLimitError);
  });

  it("rejects missing closure cells and unrelated scope captures", () => {
    const state = fixture("def outer():\n x=1\n class C: y=x");
    expect(() => new ClassFrame(state.scope, { ...state.namespaces, closure: new Map() }, budget())).toThrow("missing or invalid closure cell: x");
    expect(() => state.frame.capture(analyzeModule("def f(): pass").scopes.children[0])).toThrow("cannot capture an unrelated scope");
  });

  it("rejects module scopes rather than silently changing name semantics", () => {
    const state = fixture("class C: pass");
    expect(() => new ClassFrame(analyzeModule("pass").scopes, state.namespaces, budget())).toThrow("class frames require a class scope");
  });
});
