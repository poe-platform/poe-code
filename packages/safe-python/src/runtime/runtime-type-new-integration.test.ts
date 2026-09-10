import { expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue, type TypeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { compileProgram } from "./program-compilation.js";
import { executeRuntimeProgram, type RuntimeProgramHooks } from "./runtime-program.js";
import { CallStack } from "./call-stack.js";
import { PythonRuntimeError } from "./error.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000 }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), native = new Map<string, TypeValue>();
  const globals = new Map<string, RuntimeValue>([["type", registry.type], ["object", registry.object], ["__name__", v.string("example")]]), events: string[] = [];
  const builtins = new Map<string, RuntimeValue>([["visit", v.builtinFunction({ name: "visit", invoke(args) { const value = args[0]; if (value.kind !== "str") throw Error("expected string"); events.push(String.fromCodePoint(...value.value)); return v.none; } })]]);
  const unused = (): never => { throw Error("unexpected extension operation"); };
  const hooks: RuntimeProgramHooks = {
    expressions: () => ({ warn: unused }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }),
    callable: () => false, name: () => "guest()", keywordName: unused, invoke: unused,
    specialMethods: () => ({ slots: () => undefined, typeOf(value) {
      if (value.kind === "function" || value.kind === "method_descriptor" || value.kind === "classmethod_descriptor" || value.kind === "wrapper_descriptor" || value.kind === "getset_descriptor" || value.kind === "member_descriptor") return registry.descriptorType(value.kind);
      const existing = native.get(value.kind); if (existing !== undefined) return existing;
      const type = registry.publish(new RuntimeTypeLayout(value.kind === "none" ? "NoneType" : value.kind, [registry.object.value], v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), meter, { objectLayout: false, instanceDictionary: false }), registry.type);
      native.set(value.kind, type); return type;
    } })
  };
  function run(source: string) {
    executeRuntimeProgram(compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, v, meter), { values: v, globals, builtins, keys, hooks, calls: new CallStack<object>(50, meter) }, meter);
  }
  return { v, meter, registry, globals, events, run };
}

it("constructs slotted classes through explicit type.__new__ and ordinary type calls", () => {
  const state = fixture();
  state.run("C=type.__new__(type,'C',(),{'__slots__':('x',)})\nD=type('D',(C,),{})\ninstance=D()\ninstance.x=7\nresult=instance.x\nmodule=C.__module__\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(7)); expect(state.globals.get("module")).toEqual(state.v.string("example"));
});

it("delegates only to a more-derived metaclass allocator and leaves initialization to type calls", () => {
  const state = fixture();
  state.run("def make(meta,name,bases,namespace):\n visit('new:'+name)\n return type.__new__(meta,name,bases,namespace)\ndef initialize(cls,name,bases,namespace):\n visit('init:'+name)\nMeta=type('Meta',(type,),{'__new__':make,'__init__':initialize})\nBase=type.__new__(Meta,'Base',(),{})\nC=type.__new__(type,'C',(Base,),{})\nD=type.__new__(Meta,'D',(),{})\nE=type('E',(Base,),{})\nselected=type(C) is Meta\n");
  expect(state.events).toEqual(["new:C", "new:E", "init:E"]); expect(state.globals.get("selected")).toBe(state.v.true);
});

it("uses ordinary metaclass attribute lookup when delegating a winning allocator", () => {
  const state = fixture();
  state.run("def read(cls,name):\n if name=='__new__': visit('read-new')\n return type.__getattribute__(cls,name)\ndef make(meta,name,bases,namespace):\n visit('new')\n return type.__new__(meta,name,bases,namespace)\nMM=type('MM',(type,),{'__getattribute__':read})\nMeta=type.__new__(MM,'Meta',(type,),{'__new__':make})\nBase=type.__new__(Meta,'Base',(),{})\nC=type.__new__(type,'C',(Base,),{})\n");
  expect(state.events).toEqual(["read-new", "new"]);
});

it("does not finalize or initialize an unrelated result from delegated allocation", () => {
  const state = fixture();
  state.run("def make(meta,name,bases,namespace):\n visit('new')\n return False\ndef initialize(cls,*args):\n visit('init')\nMeta=type('Meta',(type,),{'__new__':make,'__init__':initialize})\nBase=type.__new__(Meta,'Base',(),{})\nfirst=type.__new__(type,'C',(Base,),{})\nsecond=type('D',(Base,),{})\n");
  expect(state.events).toEqual(["new", "new"]); expect(state.globals.get("first")).toBe(state.v.false); expect(state.globals.get("second")).toBe(state.v.false);
});

it("detects metaclass conflicts before publishing a class cell", () => {
  const state = fixture(), cell = state.v.cell({}); state.globals.set("cell", cell);
  state.run("M1=type('M1',(type,),{})\nM2=type('M2',(type,),{})\nA=type.__new__(M1,'A',(),{})\nB=type.__new__(M2,'B',(),{})\n");
  expect(() => state.run("type.__new__(type,'C',(A,B),{'__classcell__':cell})\n")).toThrow("metaclass conflict");
  expect(cell.value.content).toBeUndefined();
});

it("runs set-name callbacks before the inherited subclass hook with class keywords", () => {
  const state = fixture();
  state.run("def set_name(self,owner,name):\n visit(name)\n owner.seen=name\ndef initialize(cls,*,flag):\n visit(flag)\nBase=type('Base',(),{'__init_subclass__':initialize})\nDescriptor=type('Descriptor',(),{'__set_name__':set_name})\ndescriptor=Descriptor()\nC=type.__new__(type,'C',(Base,),{'field':descriptor},flag='subclass')\nseen=C.seen\n");
  expect(state.events).toEqual(["field", "subclass"]); expect(state.globals.get("seen")).toEqual(state.v.string("field"));
});

it("rejects unresolved non-type bases without invoking their mro-entries hook", () => {
  const state = fixture(); state.run("Base=type('Base',(),{'__mro_entries__':None})\nbase=Base()\n");
  expect(() => state.run("type.__new__(type,'C',(base,),{})\n")).toThrow("type() doesn't support MRO entry resolution; use types.new_class()");
  expect(() => state.run("type.__new__(type,'C',(1,),{})\n")).toThrow("metaclass conflict");
});

it("keeps the published class cell and annotates set-name failures", () => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "set-name failed"), cell = state.v.cell({});
  state.globals.set("cell", cell); state.globals.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("def set_name(self,owner,name):\n fail()\nDescriptor=type('Descriptor',(),{'__set_name__':set_name})\ndescriptor=Descriptor()\n");
  expect(() => state.run("C=type('C',(),{'field':descriptor,'__classcell__':cell})\n")).toThrow(failure);
  expect(cell.value.content?.value.kind).toBe("type"); expect(state.globals.has("C")).toBe(false);
  expect(failure.notes).toEqual(["Error calling __set_name__ on 'Descriptor' instance 'field' in 'C'"]);
});
