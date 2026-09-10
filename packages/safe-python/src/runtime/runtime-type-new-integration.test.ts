import { expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue, type TypeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { compileProgram } from "./program-compilation.js";
import { executeRuntimeProgram, type RuntimeProgramHooks } from "./runtime-program.js";
import { CallStack } from "./call-stack.js";
import { PythonRuntimeError } from "./error.js";
import { createBuildClassBuiltin } from "./builtin-build-class.js";
import { createCallableBuiltin } from "./builtin-callable.js";
import { PythonKeyError } from "./runtime-dictionary-access.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";
import { createDictionaryFromKeysBuiltin } from "./builtin-dictionary-fromkeys.js";
import { constructRuntimeSet } from "./runtime-set.js";
import { constructRuntimeFrozenSet } from "./runtime-frozenset.js";
import { createHashBuiltin } from "./builtin-hash.js";
import { createRuntimeKeyOperations } from "./runtime-key-operations.js";
import { RuntimeExecutionKeys } from "./runtime-execution-keys.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000 }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const calls = new CallStack<object>(50, meter), keys = new RuntimeExecutionKeys(v, hash, meter, calls);
  const registry = new RuntimeTypeRegistry(v, keys, meter), native = new Map<string, TypeValue>();
  const globals = new Map<string, RuntimeValue>([["type", registry.type], ["object", registry.object], ["__name__", v.string("example")]]), events: string[] = [];
  const builtins = new Map<string, RuntimeValue>([["visit", v.builtinFunction({ name: "visit", invoke(args) { const value = args[0]; if (value.kind !== "str") throw Error("expected string"); events.push(String.fromCodePoint(...value.value)); return v.none; } })]]);
  builtins.set("__build_class__", createBuildClassBuiltin({ registry, keys }, v, meter));
  builtins.set("callable", createCallableBuiltin(v, meter));
  const unused = (): never => { throw Error("unexpected extension operation"); };
  const hooks: RuntimeProgramHooks = {
    expressions: () => ({ warn: unused }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }),
    callable: () => false, name: () => "guest()", keywordName: key => { if (key.kind !== "str") throw Error("expected string keyword"); return String.fromCodePoint(...key.value); }, invoke: unused,
    specialMethods: () => ({ slots: () => undefined, typeOf(value) {
      if (value.kind === "list") return registry.listType();
      if (value.kind === "method" || value.kind === "method-wrapper" || value.kind === "builtin_function_or_method") return registry.boundCallableType(value.kind);
      if (value.kind === "function" || value.kind === "method_descriptor" || value.kind === "classmethod_descriptor" || value.kind === "wrapper_descriptor" || value.kind === "getset_descriptor" || value.kind === "member_descriptor") return registry.descriptorType(value.kind);
      const existing = native.get(value.kind); if (existing !== undefined) return existing;
      const type = registry.publish(new RuntimeTypeLayout(value.kind === "none" ? "NoneType" : value.kind, [registry.object.value], v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), meter, { objectLayout: false, instanceDictionary: false }), registry.type);
      native.set(value.kind, type); return type;
    } })
  };
  function run(source: string) {
    executeRuntimeProgram(compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, v, meter), { values: v, globals, builtins, keys, hooks, calls }, meter);
  }
  return { v, meter, hash, keys, registry, globals, builtins, events, calls, run };
}

it("allocates list subclasses with native contents and independent instance dictionaries", () => {
  const state = fixture();
  state.run("list_type=type([])\nclass Child(list_type):\n pass\nitems=Child([1,2])\nitems.label=7\nitems.append(3)\ncorrect=type(items) is Child\nlabel=items.label\nresult=0\nfor item in items:\n result=result*10+item\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.globals.get("label")).toEqual(state.v.integer(7)); expect(state.globals.get("result")).toEqual(state.v.integer(123));
});

it("keeps list subclass overrides separate from explicit native slots", () => {
  const state = fixture();
  state.run("list_type=type([])\nclass Child(list_type):\n def __len__(self):\n  return 9\n def __iter__(self):\n  return [7].__iter__()\n def __getitem__(self,key):\n  return 8\nitems=Child([1,2])\nlength=items.__len__()\nnative_length=list_type.__len__(items)\nitem=items[0]\nnative_item=list_type.__getitem__(items,0)\nresult=0\nfor value in items:\n result=result*10+value\n");
  expect(state.globals.get("length")).toEqual(state.v.integer(9)); expect(state.globals.get("native_length")).toEqual(state.v.integer(2)); expect(state.globals.get("item")).toEqual(state.v.integer(8)); expect(state.globals.get("native_item")).toEqual(state.v.integer(1)); expect(state.globals.get("result")).toEqual(state.v.integer(7));
});

it("retains list subclass identity for in-place operations and exact list results for copies", () => {
  const state = fixture();
  state.run("list_type=type([])\nclass Child(list_type):\n pass\nitems=Child([1,2])\nother=Child([3])\njoined=items+other\ncopy=items.copy()\nrepeated=items*2\nalias=items\nitems+=other\nitems*=2\nsame=items is alias\nexact=type(joined) is list_type and type(copy) is list_type and type(repeated) is list_type\nresult=0\nfor value in items:\n result=result*10+value\nequal=items==[1,2,3,1,2,3]\n");
  expect(state.globals.get("same")).toBe(state.v.true); expect(state.globals.get("exact")).toBe(state.v.true); expect(state.globals.get("equal")).toBe(state.v.true); expect(state.globals.get("result")).toEqual(state.v.integer(123123));
});

it("stores declared slots alongside native list contents", () => {
  const state = fixture();
  state.run("list_type=type([])\nclass Child(list_type):\n __slots__=('label',)\nitems=Child([1])\nitems.label=7\nlabel=items.label\nitem=items[0]\n");
  expect(state.globals.get("label")).toEqual(state.v.integer(7)); expect(state.globals.get("item")).toEqual(state.v.integer(1));
  expect(() => state.run("items.extra=1\n")).toThrow("has no attribute 'extra'");
});

it("concatenates exact lists with list subclass payloads after reflected negotiation", () => {
  const state = fixture();
  state.run("list_type=type([])\nclass Child(list_type):\n pass\nclass Reflected(Child):\n def __radd__(self,other):\n  return 9\nitems=[1]+Child([2])\nresult=items[0]*10+items[1]\nreflected=[1]+Reflected([2])\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(12)); expect(state.globals.get("reflected")).toEqual(state.v.integer(9));
});

it("runs overridden list subclass initialization without implicit base initialization", () => {
  const state = fixture();
  state.run("class Child(type([])):\n def __init__(self,*,value):\n  self.append(value)\nitems=Child(value=7)\nresult=items[0]\nlength=items.__len__()\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(7)); expect(state.globals.get("length")).toEqual(state.v.integer(1));
  expect(() => state.run("items.native\n")).toThrow("has no attribute 'native'");
});

it.each(["items*1.0", "1.0*items", "items*=1.0"])("uses sequence repetition errors for list subclass expressions: %s", expression => {
  const state = fixture(); state.run("class Child(type([])):\n pass\nitems=Child([1,2])\n");
  expect(() => state.run(`${expression}\n`)).toThrow("can't multiply sequence by non-int of type 'float'");
  expect(() => state.run("items.__mul__(1.0)\n")).toThrow("'float' object cannot be interpreted as an integer");
});

it("retains native subclass concatenation errors for unrelated instances", () => {
  const state = fixture(); state.run("class Child(type([])):\n pass\nclass Other:\n pass\nitems=Child([1])\n");
  expect(() => state.run("items+Other()\n")).toThrow('can only concatenate list (not "Other") to list');
});

it("runs inherited subclass in-place concatenation before reflected addition", () => {
  const state = fixture(); state.run("class Child(type([])):\n pass\nclass Other:\n def __radd__(self,other):\n  visit('reflected')\n  return 9\nitems=Child([1])\n");
  expect(() => state.run("items+=Other()\n")).toThrow("'Other' object is not iterable"); expect(state.events).toEqual([]);
});

it.each(["__add__", "__mul__"])("does not restore a native sequence fallback after %s declines", name => {
  const state = fixture(), operator = name === "__add__" ? "+" : "*";
  state.globals.set("NotImplemented", state.v.notImplemented);
  state.run(`class Child(type([])):\n def ${name}(self,other):\n  return NotImplemented\nclass Other:\n def __index__(self):\n  visit('index')\n  return 2\nitems=Child([1])\n`);
  expect(() => state.run(`items${operator}Other()\n`)).toThrow(`unsupported operand type(s) for ${operator}: 'Child' and 'Other'`); expect(state.events).toEqual([]);
});

it.each(["+=", "*="])("uses ordinary result identity after a list subclass %s override declines", operator => {
  const state = fixture(), name = operator === "+=" ? "__iadd__" : "__imul__", argument = operator === "+=" ? "[2]" : "2";
  state.globals.set("NotImplemented", state.v.notImplemented);
  state.run(`class Child(type([])):\n def ${name}(self,other):\n  return NotImplemented\nitems=Child([1])\nalias=items\nitems${operator}${argument}\nsame=items is alias\nexact=type(items) is type([])\n`);
  expect(state.globals.get("same")).toBe(state.v.false); expect(state.globals.get("exact")).toBe(state.v.true);
});

it.each([["__mul__", "[1]*Child([1])", "list"], ["__rmul__", "Child([1])*Child([1])", "Child"], ["__rmul__", "Child([1])*[1]", "list"]])("activates paired numeric repetition when %s is overridden", (name, expression, type) => {
  const state = fixture(); state.globals.set("NotImplemented", state.v.notImplemented);
  state.run(`class Child(type([])):\n def ${name}(self,other):\n  return NotImplemented\n`);
  expect(() => state.run(`${expression}\n`)).toThrow(`'${type}' object cannot be interpreted as an integer`);
});

it.each(["append", "__len__", "__init__"])("binds inherited %s to the list subclass instance, not its payload", name => {
  const state = fixture();
  state.run(`class Child(type([])):\n pass\nitems=Child()\nreceiver=items.${name}.__self__ is items\n`);
  expect(state.globals.get("receiver")).toBe(state.v.true);
});

it.each(["", "[3,4]", "Source()"])("constructs exact native lists through the normal type lifecycle: %s", args => {
  const state = fixture();
  state.run(`class Source:\n def __iter__(self):\n  visit('iterate')\n  return [3,4].__iter__()\nlist_type=type([])\nitems=list_type(${args})\ncorrect_type=type(items) is list_type\nresult=0\nfor item in items:\n result=result*10+item\n`);
  expect(state.globals.get("correct_type")).toBe(state.v.true); expect(state.globals.get("result")).toEqual(state.v.integer(args === "" ? 0 : 34)); expect(state.events).toEqual(args === "Source()" ? ["iterate"] : []);
});

it("allocates fresh empty lists without initializing supplied new arguments", () => {
  const state = fixture();
  state.run("list_type=type([])\nfirst=list_type.__new__(list_type,[1,2],3,x=4)\nsecond=list_type.__new__(list_type)\ndistinct=first is not second\nlength=first.__len__()\n");
  expect(state.globals.get("distinct")).toBe(state.v.true); expect(state.globals.get("length")).toEqual(state.v.integer(0));
});

it.each([["", "list.__new__(): not enough arguments"], ["1", "list.__new__(X): X is not a type object (int)"], ["object", "list.__new__(object): object is not a subtype of list"]])("validates native list allocator receivers: %s", (args, message) => {
  expect(() => fixture().run(`type([]).__new__(${args})\n`)).toThrow(message);
});

it("rejects foreign registry types at the list allocation boundary", () => {
  const state = fixture(); state.globals.set("foreign", fixture().registry.listType());
  expect(() => state.run("type([]).__new__(foreign)\n")).toThrow("type is not owned by this list allocator");
  expect(state.calls.depth).toBe(0);
});

it("preserves original initializer failures through list type calls", () => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Source:\n def __iter__(self):\n  fail()\n");
  let thrown: unknown;
  try { state.run("type([])(Source())\n"); } catch (error) { thrown = error; }
  expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
});

it.each(["", "items", "[3,4]"])("reinitializes list storage through direct and bound slots: %s", args => {
  for (const direct of [false, true]) {
    const state = fixture(), call = direct ? `type(items).__init__(items${args ? "," + args : ""})` : `items.__init__(${args})`;
    state.run(`items=[1,2]\nanswer=${call}\nresult=0\nfor value in items:\n result=result*10+value\n`);
    expect(state.globals.get("answer")).toBe(state.v.none); expect(state.globals.get("result")).toEqual(state.v.integer(args === "[3,4]" ? 34 : 0));
  }
});

it("clears list storage before acquiring a guest initialization iterator", () => {
  const state = fixture();
  state.run("class Source:\n def __iter__(self):\n  if items==[]:\n   visit('empty')\n  return [3,4].__iter__()\nitems=[1,2]\nitems.__init__(Source())\nresult=items[0]*10+items[1]\n");
  expect(state.events).toEqual(["empty"]); expect(state.globals.get("result")).toEqual(state.v.integer(34));
});

it.each([["1,2", "list expected at most 1 argument, got 2"], ["x=1", "list() takes no keyword arguments"]])("validates list initializer arguments before clearing: %s", (args, message) => {
  const state = fixture(); state.run("items=[1,2]\n");
  expect(() => state.run(`items.__init__(${args})\n`)).toThrow(message);
  state.run("result=items[0]*10+items[1]\n"); expect(state.globals.get("result")).toEqual(state.v.integer(12));
});

it("leaves list storage empty when initialization receives a noniterable", () => {
  const state = fixture(); state.run("items=[1,2]\n");
  expect(() => state.run("type(items).__init__(items,1)\n")).toThrow("'int' object is not iterable");
  state.run("length=items.__len__()\n"); expect(state.globals.get("length")).toEqual(state.v.integer(0));
});

it.each(["iterate", "hint", "next"])("preserves original %s errors and initialization progress", phase => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run(`class Source:\n def __init__(self):\n  self.first=True\n def __iter__(self):\n  ${phase === "iterate" ? "fail()" : "return self"}\n def __len__(self):\n  ${phase === "hint" ? "fail()" : "return 2"}\n def __next__(self):\n  if self.first:\n   self.first=False\n   return 3\n  fail()\nitems=[1,2]\n`);
  let thrown: unknown;
  try { state.run("items.__init__(Source())\n"); } catch (error) { thrown = error; }
  expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
  state.run("result=0\nfor value in items:\n result=result*10+value\n"); expect(state.globals.get("result")).toEqual(state.v.integer(phase === "next" ? 3 : 0));
});

it("exposes canonical list initialization wrapper metadata", () => {
  const state = fixture(); state.run("items=[]\nmethod=items.__init__\nreceiver=method.__self__ is items\nname=method.__name__\n");
  expect(state.globals.get("receiver")).toBe(state.v.true); expect(state.globals.get("name")).toEqual(state.v.string("__init__"));
});

it.each(["__add__", "__iadd__", "__mul__", "__rmul__", "__imul__"])("exposes list %s with native result identity and guest conversion", name => {
  for (const direct of [false, true]) {
    const state = fixture(), argument = name === "__add__" ? "[3]" : name === "__iadd__" ? "Extra()" : "Count()";
    const call = direct ? `type(items).${name}(items,${argument})` : `items.${name}(${argument})`;
    state.run(`class Count:\n def __index__(self):\n  visit('index')\n  return 2\nclass Extra:\n def __iter__(self):\n  visit('iterate')\n  return [3].__iter__()\nitems=[1,2]\nanswer=${call}\nsame=answer is items\nresult=0\nfor item in answer:\n result=result*10+item\n`);
    expect(state.globals.get("same")).toBe(name === "__iadd__" || name === "__imul__" ? state.v.true : state.v.false);
    expect(state.globals.get("result")).toEqual(state.v.integer(name === "__add__" || name === "__iadd__" ? 123 : 1212));
    expect(state.events).toEqual(name === "__add__" ? [] : name === "__iadd__" ? ["iterate"] : ["index"]);
  }
});

it.each(["__add__", "__iadd__", "__mul__", "__rmul__", "__imul__"])("publishes canonical list %s metadata and argument validation", name => {
  const state = fixture(); state.run(`items=[]\nmethod=items.${name}\nreceiver=method.__self__ is items\n`);
  expect(state.globals.get("receiver")).toBe(state.v.true);
  expect(() => state.run("method()\n")).toThrow("expected 1 argument, got 0");
  expect(() => state.run("method(x=1)\n")).toThrow(`wrapper ${name}() takes no keyword arguments`);
});

it.each(["__mul__", "__rmul__", "__imul__"])("reports original operand type for %s overflow", name => {
  const state = fixture(); state.run("class Count:\n def __index__(self):\n  return 1<<100\nitems=[]\n");
  expect(() => state.run(`items.${name}(Count())\n`)).toThrow("cannot fit 'Count' into an index-sized integer");
});

it("retains native addition diagnostics without an invocation type policy", () => {
  const state = fixture(), slot = state.registry.listType().value.namespace.items.lookup(state.v.string("__add__"))?.value;
  if (slot?.kind !== "wrapper_descriptor") throw Error("expected wrapper");
  expect(() => slot.value.invoke(state.v.list([]), [state.v.none], state.v.dictionary(new OrderedKeyMap(state.keys, state.meter)), state.meter)).toThrow('can only concatenate list (not "NoneType") to list');
});

it.each(["__mul__", "__rmul__", "__imul__"])("preserves original guest index errors in %s", name => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Count:\n def __index__(self):\n  fail()\nitems=[1,2]\n");
  let thrown: unknown;
  try { state.run(`items.${name}(Count())\n`); } catch (error) { thrown = error; }
  expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
});

it("preserves partial list extension and the original iterator error through __iadd__", () => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Cursor:\n def __init__(self):\n  self.first=True\n def __iter__(self):\n  return self\n def __next__(self):\n  if self.first:\n   self.first=False\n   return 3\n  fail()\nitems=[1,2]\n");
  let thrown: unknown;
  try { state.run("type(items).__iadd__(items,Cursor())\n"); } catch (error) { thrown = error; }
  expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
  state.run("result=items[0]*100+items[1]*10+items[2]\n"); expect(state.globals.get("result")).toEqual(state.v.integer(123));
});

it.each(["direct", "bound"])("reads list subscriptions through %s native descriptors and guest indices", mode => {
  const state = fixture(), call = mode === "direct" ? "type(items).__getitem__(items,index)" : "items.__getitem__(index)";
  state.run(`class Index:\n def __index__(self):\n  visit('index')\n  items.append(3)\n  return -1\nitems=[1,2]\nindex=Index()\nresult=${call}\n`);
  expect(state.globals.get("result")).toEqual(state.v.integer(3)); expect(state.events).toEqual(["index"]);
});

it.each(["direct", "bound"])("mutates list subscriptions through %s native descriptors and guest indices", mode => {
  const state = fixture(), set = mode === "direct" ? "type(items).__setitem__(items,index,9)" : "items.__setitem__(index,9)", del = mode === "direct" ? "type(items).__delitem__(items,index)" : "items.__delitem__(index)";
  state.run(`class Index:\n def __index__(self):\n  visit('index')\n  return -1\nitems=[1,2,3]\nindex=Index()\nassigned=${set}\nvalue=items[-1]\ndeleted=${del}\nlength=items.__len__()\n`);
  expect(state.globals.get("assigned")).toBe(state.v.none); expect(state.globals.get("deleted")).toBe(state.v.none); expect(state.globals.get("value")).toEqual(state.v.integer(9)); expect(state.globals.get("length")).toEqual(state.v.integer(2)); expect(state.events).toEqual(["index", "index"]);
});

it.each(["__getitem__", "__setitem__", "__delitem__"])("publishes canonical list %s binding metadata", name => {
  const state = fixture(); state.run(`items=[]\nmethod=items.${name}\nreceiver=method.__self__ is items\nname=method.__name__\n`);
  expect(state.globals.get("receiver")).toBe(state.v.true); expect(state.globals.get("name")).toEqual(state.v.string(name));
});

it.each(["direct", "bound"])("uses guest slice replacements and independent slice reads through %s slots", mode => {
  const state = fixture(); state.globals.set("key", state.v.slice({ lower: state.v.integer(1), upper: state.v.integer(3) }));
  const call = (name: string, extra = "") => mode === "direct" ? `type(items).${name}(items,key${extra})` : `items.${name}(key${extra})`;
  state.run(`class Replacement:\n def __iter__(self):\n  visit('iterate')\n  items.append(4)\n  return [7,8].__iter__()\nitems=[1,2,3]\ncopied=${call("__getitem__")}\nassigned=${call("__setitem__", ",Replacement()")}\nresult=0\nfor value in items:\n result=result*10+value\ndeleted=${call("__delitem__")}\nremaining=0\nfor value in items:\n remaining=remaining*10+value\ncopy_result=copied[0]*10+copied[1]\n`);
  expect(state.globals.get("result")).toEqual(state.v.integer(1784)); expect(state.globals.get("remaining")).toEqual(state.v.integer(14)); expect(state.globals.get("copy_result")).toEqual(state.v.integer(23)); expect(state.events).toEqual(["iterate"]); expect(state.globals.get("assigned")).toBe(state.v.none); expect(state.globals.get("deleted")).toBe(state.v.none);
});

it.each(["__getitem__", "__setitem__", "__delitem__"])("preserves index errors from explicit list %s", name => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Index:\n def __index__(self):\n  fail()\nitems=[1,2,3]\n");
  let thrown: unknown;
  try { state.run(`items.${name}(Index()${name === "__setitem__" ? ",9" : ""})\n`); } catch (error) { thrown = error; }
  expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
});

it.each(["direct", "bound"])("exposes live list length and iteration slots through %s calls", mode => {
  const state = fixture(), length = mode === "direct" ? "type(items).__len__(items)" : "items.__len__()", iterate = mode === "direct" ? "type(items).__iter__(items)" : "items.__iter__()";
  state.run(`items=[1,2]\nbefore=${length}\ncursor=${iterate}\nitems.append(3)\nafter=${length}\nresult=0\nfor value in cursor:\n result=result*10+value\n`);
  expect(state.globals.get("before")).toEqual(state.v.integer(2)); expect(state.globals.get("after")).toEqual(state.v.integer(3)); expect(state.globals.get("result")).toEqual(state.v.integer(123));
});

it.each(["direct", "bound"])("uses live guest equality and truth in %s list contains slots", mode => {
  const state = fixture(), call = mode === "direct" ? "type(items).__contains__(items,needle)" : "items.__contains__(needle)";
  state.run(`class Truth:\n def __bool__(self):\n  visit('truth')\n  return False\nclass Member:\n def __eq__(self,other):\n  visit('equal')\n  items.append(other)\n  return Truth()\nneedle=object()\nitems=[Member()]\nresult=${call}\n`);
  expect(state.globals.get("result")).toBe(state.v.true); expect(state.events).toEqual(["equal", "truth"]);
});

it.each(["__len__", "__iter__", "__contains__"])("retains list %s wrapper metadata and rejects invalid arguments", name => {
  const state = fixture(); state.run(`items=[]\nmethod=items.${name}\nreceiver=method.__self__ is items\nname=method.__name__\n`);
  expect(state.globals.get("receiver")).toBe(state.v.true); expect(state.globals.get("name")).toEqual(state.v.string(name));
  expect(() => state.run(`method(x=1)\n`)).toThrow(`wrapper ${name}() takes no keyword arguments`);
  expect(() => state.run("method(1,2)\n")).toThrow(`expected ${name === "__contains__" ? "1 argument" : "0 arguments"}, got 2`);
});

it("keeps a list slot iterator exhausted after later growth", () => {
  const state = fixture();
  state.run("items=[1,2]\ncursor=items.__iter__()\nfirst=0\nfor value in cursor:\n first=first*10+value\nitems.append(3)\nsecond=0\nfor value in cursor:\n second+=value\n");
  expect(state.globals.get("first")).toEqual(state.v.integer(12)); expect(state.globals.get("second")).toEqual(state.v.integer(0));
});

it.each(["equal", "truth"])("preserves original %s errors and unwinds list membership slots", phase => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run(`class Truth:\n def __bool__(self):\n  fail()\nclass Member:\n def __eq__(self,other):\n  ${phase === "equal" ? "fail()" : "return Truth()"}\nitems=[Member()]\n`);
  let thrown: unknown;
  try { state.run("items.__contains__(object())\n"); } catch (error) { thrown = error; }
  expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
});

it.each(["dict", "set"])("dispatches guest key protocols in ordinary %s displays across frames", kind => {
  const state = fixture();
  state.run(`class Key:\n def __hash__(self):\n  visit('hash')\n  return 7\n def __eq__(self,other):\n  visit('equal')\n  return True\nleft=Key()\nright=Key()\ndef make():\n return ${kind === "dict" ? "{left:1}" : "{left}"}\ndef merge(target):\n target|=${kind === "dict" ? "{right:2}" : "{right}"}\nresult=make()\nmerge(result)\nfound=right in result\n`);
  const result = state.globals.get("result")!;
  if (result.kind !== "dict" && result.kind !== "set") throw Error("expected collection");
  expect(result.items.size).toBe(1); expect(state.globals.get("found")).toBe(state.v.true);
  expect(state.events).toEqual(["hash", "hash", "equal", "hash", "equal"]);
});

it("exposes object equality as identity-or-NotImplemented without delegation", () => {
  const state = fixture();
  state.run("class Key:\n def __eq__(self,other):\n  visit('override')\n  return False\nleft=Key()\nright=Key()\nsame=object.__eq__(left,left)\ndifferent=object.__eq__(left,right)\nbound=object.__eq__.__get__(left,Key)(left)\nnative=object.__eq__([],[])\n");
  for (const name of ["same", "bound"]) expect(state.globals.get(name)).toBe(state.v.true);
  for (const name of ["different", "native"]) expect(state.globals.get(name)).toBe(state.v.notImplemented);
  expect(state.events).toEqual([]);
});

it.each(["key.method", "key.__getattribute__", "items.append"])("preserves native bound equality while explicit object equality uses identity for %s", expression => {
  const state = fixture();
  state.run(`class Key:\n def method(self):\n  pass\nkey=Key()\nitems=[]\nleft=${expression}\nright=${expression}\nequal=left==right\nunequal=left!=right\nbase=object.__eq__(left,right)\nslot=type(left).__eq__(left,right)\ndeclined=type(left).__eq__(left,None)\n`);
  expect(state.globals.get("equal")).toBe(state.v.true); expect(state.globals.get("unequal")).toBe(state.v.false);
  expect(state.globals.get("base")).toBe(state.v.notImplemented);
  expect(state.globals.get("slot")).toBe(state.v.true); expect(state.globals.get("declined")).toBe(state.v.notImplemented);
});

it.each(["key.method", "key.__getattribute__", "items.append"])("uses native callable hash slots for %s", expression => {
  const state = fixture(); state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.run(`class Key:\n def method(self):\n  pass\nkey=Key()\nitems=[]\nmethod=${expression}\nnormal=hash(method)\ndirect=type(method).__hash__(method)\nbound=type(method).__hash__.__get__(method,type(method))()\nidentity=object.__hash__(method)\nattribute=method.__hash__()\nequal=method.__eq__(method)\nunequal=method.__ne__(method)\n`);
  expect(state.globals.get("normal")).toEqual(state.v.integer(0)); expect(state.globals.get("direct")).toEqual(state.globals.get("normal"));
  expect(state.globals.get("bound")).toEqual(state.globals.get("normal")); expect(state.globals.get("identity")).toEqual(state.v.integer(17));
  expect(state.globals.get("attribute")).toEqual(state.globals.get("normal")); expect(state.globals.get("equal")).toBe(state.v.true); expect(state.globals.get("unequal")).toBe(state.v.false);
});

it("keeps nested callable hashes guest-aware in explicit native method hashing", () => {
  const state = fixture(); state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.builtins.set("bind", state.v.builtinFunction({ name: "bind", invoke(args) { return state.v.boundMethod(args[0], args[1]); } }));
  state.run("class Callable:\n def __call__(self):\n  pass\n def __hash__(self):\n  visit('hash')\n  return 9\nmethod=bind(Callable(),[])\nnormal=hash(method)\ndirect=type(method).__hash__(method)\n");
  expect(state.globals.get("normal")).toEqual(state.v.integer(24)); expect(state.globals.get("direct")).toEqual(state.v.integer(24)); expect(state.events).toEqual(["hash", "hash"]);
});

it("preserves nested hash exceptions through the native callable slot", () => {
  const state = fixture(), failure = new PythonRuntimeError("TypeError", "sentinel");
  state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.builtins.set("bind", state.v.builtinFunction({ name: "bind", invoke(args) { return state.v.boundMethod(args[0], args[1]); } }));
  state.run("class Callable:\n def __call__(self):\n  pass\n def __hash__(self):\n  fail()\nmethod=bind(Callable(),[])\n");
  for (const source of ["hash(method)\n", "type(method).__hash__(method)\n"]) {
    let thrown: unknown; try { state.run(source); } catch (error) { thrown = error; }
    expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
  }
});

it.each([["__eq__", false], ["__ne__", true], ["__lt__", true], ["__le__", true], ["__gt__", false], ["__ge__", false]] as const)("exposes native list comparison %s through direct and ordinary access", (name, expected) => {
  const state = fixture();
  state.run(`left=[1,2]\nright=[1,3]\ndirect=type(left).${name}(left,right)\nbound=left.${name}(right)\ndeclined=left.${name}((1,2))\nhash_slot=left.__hash__\n`);
  expect(state.globals.get("direct")).toBe(state.v.boolean(expected)); expect(state.globals.get("bound")).toBe(state.globals.get("direct"));
  expect(state.globals.get("declined")).toBe(state.v.notImplemented); expect(state.globals.get("hash_slot")).toBe(state.v.none);
});

it("preserves raw guest ordering results and identity shortcuts in list slots", () => {
  const state = fixture();
  state.run("marker=[]\nclass Key:\n def __eq__(self,other):\n  visit('equal')\n  return False\n def __lt__(self,other):\n  visit('less')\n  return marker\nleft=Key()\nright=Key()\nresult=[left].__lt__([right])\nraw=result is marker\nidentity=[left].__eq__([left])\n");
  expect(state.globals.get("raw")).toBe(state.v.true); expect(state.globals.get("identity")).toBe(state.v.true); expect(state.events).toEqual(["equal", "less"]);
});

it("observes live list mutation during explicit comparison", () => {
  const state = fixture();
  state.run("class Key:\n def __eq__(self,other):\n  visit('equal')\n  right.clear()\n  return True\nleft=[Key(),1]\nright=[Key(),2]\nresult=left.__eq__(right)\n");
  expect(state.globals.get("result")).toBe(state.v.false); expect(state.events).toEqual(["equal"]);
});

it.each(["equal", "truth", "less"])("preserves %s exceptions in explicit list comparison", phase => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run(`class Truth:\n def __bool__(self):\n  fail()\nclass Key:\n def __eq__(self,other):\n  ${phase === "equal" ? "fail()" : phase === "truth" ? "return Truth()" : "return False"}\n def __lt__(self,other):\n  fail()\nleft=[Key()]\nright=[Key()]\n`);
  let thrown: unknown; try { state.run("left.__lt__(right)\n"); } catch (error) { thrown = error; }
  expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
});

it.each(["items.sort", "type(items).sort"])("sorts through canonical %s with guest key, comparison and reverse truth", callee => {
  const state = fixture();
  state.run(`class Reverse:\n def __bool__(self):\n  visit('reverse')\n  return True\nclass Key:\n def __init__(self,value):\n  self.value=value\n def __lt__(self,other):\n  return self.value<other.value\ndef key(value):\n visit('key')\n return Key(value)\nitems=[1,3,2]\nresult=${callee}(${callee.startsWith("type") ? "items," : ""}key=key,reverse=Reverse())\nfirst=items[0]\nlast=items[2]\n`);
  expect(state.globals.get("result")).toBe(state.v.none); expect(state.globals.get("first")).toEqual(state.v.integer(3)); expect(state.globals.get("last")).toEqual(state.v.integer(1));
  expect(state.events).toEqual(["reverse", "key", "key", "key"]);
});

it("retains temporary-empty semantics through an extracted sort descriptor", () => {
  const state = fixture();
  state.run("items=[1,3,2]\nsorter=items.sort\ndef key(value):\n if items==[]:\n  visit('empty')\n return -value\n");
  state.run("sorter(key=key)\nfirst=items[0]\nlast=items[2]\n");
  expect(state.events).toEqual(["empty", "empty", "empty"]); expect(state.globals.get("first")).toEqual(state.v.integer(3)); expect(state.globals.get("last")).toEqual(state.v.integer(1));
});

it.each(["key", "comparison", "reverse"])("restores the list and preserves %s callback errors during sort", phase => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Key:\n def __lt__(self,other):\n  fail()\nclass Reverse:\n def __bool__(self):\n  fail()\ndef key(value):\n fail()\nitems=[Key(),Key(),Key()]\n");
  let thrown: unknown;
  try { state.run(`type(items).sort(items${phase === "key" ? ",key=key" : phase === "reverse" ? ",reverse=Reverse()" : ""})\n`); } catch (error) { thrown = error; }
  expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
  const items = state.globals.get("items")!; if (items.kind !== "list") throw Error("expected list"); expect(items.items.length).toBe(3);
});

it.each([
  ["1", "sort() takes no positional arguments"],
  ["1,2", "sort() takes no positional arguments"],
  ["1,2,3", "sort() takes at most 2 arguments (3 given)"],
  ["1,2,3,key=None", "sort() takes at most 2 arguments (4 given)"],
  ["1,key=None,reverse=False,x=1", "sort() takes at most 2 arguments (4 given)"],
  ["key=None,reverse=False,x=1", "sort() takes at most 2 keyword arguments (3 given)"]
])("validates sort argument counts before keyword-only arguments: %s", (args, message) => {
  expect(() => fixture().run(`[].sort(${args})\n`)).toThrow(message);
});

it.each(["append", "extend", "insert", "pop", "clear", "reverse", "copy", "count", "remove", "index", "__reversed__", "sort"])("retains canonical list %s binding metadata and key identity", name => {
  const state = fixture(); state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.run(`items=[]\nleft=items.${name}\nright=items.${name}\nresult={left:1,right:2}\nequal_hash=hash(left)==hash(right)\nreceiver=left.__self__ is items\nname=left.__name__\nqualified=left.__qualname__\n`);
  const result = state.globals.get("result")!;
  if (result.kind !== "dict") throw Error("expected dictionary");
  expect(result.items.size).toBe(1); expect(state.globals.get("equal_hash")).toBe(state.v.true); expect(state.globals.get("receiver")).toBe(state.v.true);
  expect(state.globals.get("name")).toEqual(state.v.string(name)); expect(state.globals.get("qualified")).toEqual(state.v.string(`list.${name}`));
});

it("calls canonical list descriptors with live guest iteration and equality", () => {
  const state = fixture();
  state.run("class Source:\n def __getitem__(self,index):\n  return [1,2][index]\nclass Key:\n def __eq__(self,other):\n  visit('equal')\n  return True\nitems=[]\ntype(items).extend(items,Source())\ntype(items).append(items,Key())\ncount=items.count(Key())\nsize=items.index(2)\n");
  expect(state.globals.get("count")).toEqual(state.v.integer(3)); expect(state.globals.get("size")).toEqual(state.v.integer(1));
  expect(state.events).toEqual(["equal", "equal", "equal"]);
});

it.each(["__lt__", "__le__", "__gt__", "__ge__"])("exposes non-delegating object ordering slot %s", name => {
  const state = fixture();
  state.run(`class Key:\n def ${name}(self,other):\n  visit('override')\n  return True\nkey=Key()\ndirect=object.${name}(key,key)\nbound=object.${name}.__get__(key,Key)(key)\nnative=object.${name}(1,2)\n`);
  for (const result of ["direct", "bound", "native"]) expect(state.globals.get(result)).toBe(state.v.notImplemented);
  expect(state.events).toEqual([]);
});

it.each(["__lt__", "__le__", "__gt__", "__ge__"])("validates object ordering arguments for %s", name => {
  const state = fixture();
  for (const [args, message] of [
    ["", `descriptor '${name}' of 'object' object needs an argument`],
    ["1", "expected 1 argument, got 0"], ["1,2,3", "expected 1 argument, got 2"],
    ["1,x=2", `wrapper ${name}() takes no keyword arguments`],
    ["1,2,3,x=4", `wrapper ${name}() takes no keyword arguments`]
  ]) expect(() => state.run(`object.${name}(${args})\n`)).toThrow(message);
  expect(state.calls.depth).toBe(0);
});

it("delegates object inequality only to receiver equality and preserves NotImplemented", () => {
  const state = fixture(); state.globals.set("NotImplemented", state.v.notImplemented);
  state.run("class Left:\n def __eq__(self,other):\n  visit('left')\n  return NotImplemented\nclass Right(Left):\n def __eq__(self,other):\n  visit('right')\n  return True\nleft=Left()\nright=Right()\ndirect=object.__ne__(left,right)\nbound=left.__ne__(right)\nnormal=left!=right\nnative=object.__ne__(1,2)\nunsupported=object.__ne__(1,'x')\n");
  expect(state.globals.get("direct")).toBe(state.v.notImplemented); expect(state.globals.get("bound")).toBe(state.v.notImplemented);
  expect(state.globals.get("normal")).toBe(state.v.false); expect(state.globals.get("native")).toBe(state.v.true); expect(state.globals.get("unsupported")).toBe(state.v.notImplemented);
  expect(state.events).toEqual(["left", "left", "right"]);
});

it.each(["1,1.0", "True,1j", "1.0,1j"])("preserves one-sided native numeric comparison for %s", pair => {
  const state = fixture();
  state.run(`result=object.__ne__(${pair})\n`);
  expect(state.globals.get("result")).toBe(state.v.notImplemented);
});

it("uses guest truth for object inequality and complete comparison for native members", () => {
  const state = fixture();
  state.run("class Truth:\n def __bool__(self):\n  visit('truth')\n  return False\nclass Key:\n def __eq__(self,other):\n  visit('equal')\n  return Truth()\n def __ne__(self,other):\n  visit('override')\n  return False\nleft=Key()\nright=Key()\ndirect=object.__ne__(left,right)\nnested=object.__ne__([left],[right])\n");
  expect(state.globals.get("direct")).toBe(state.v.true); expect(state.globals.get("nested")).toBe(state.v.true);
  expect(state.events).toEqual(["equal", "truth", "equal", "truth"]);
});

it.each(["equal", "truth"])("preserves errors from object inequality %s callbacks", phase => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run(`class Truth:\n def __bool__(self):\n  fail()\nclass Key:\n def __eq__(self,other):\n  ${phase === "equal" ? "fail()" : "return Truth()"}\nleft=Key()\n`);
  expect(() => state.run("object.__ne__(left,left)\n")).toThrow(failure); expect(state.calls.depth).toBe(0);
});

it("exposes object identity hashing through direct, bound and inherited slots", () => {
  const state = fixture();
  state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.run("class Key:\n def __eq__(self,other):\n  return False\n __hash__=object.__hash__\nkey=Key()\nkey.__hash__=None\ndirect=object.__hash__(key)\nbound=Key.__hash__.__get__(key,Key)()\nnormal=hash(key)\nclass_hash=hash(Key)\nnative=object.__hash__([])\nnumber=object.__hash__(7)\nnone=object.__hash__(None)\nresult={key:1}\nfound=key in result\n");
  for (const name of ["direct", "bound", "normal", "class_hash", "native", "number", "none"]) expect(state.globals.get(name)).toEqual(state.v.integer(17));
  expect(state.globals.get("found")).toBe(state.v.true);
});

it.each([
  ["object.__hash__()", "descriptor '__hash__' of 'object' object needs an argument"],
  ["object.__hash__([],1)", "expected 0 arguments, got 1"],
  ["object.__hash__([],x=1)", "wrapper __hash__() takes no keyword arguments"],
  ["object.__hash__([],1,x=1)", "wrapper __hash__() takes no keyword arguments"]
])("validates native identity hash calls: %s", (source, message) => {
  const state = fixture();
  expect(() => state.run(`${source}\n`)).toThrow(message); expect(state.calls.depth).toBe(0);
});

it("unwinds failed key callbacks and rebinds protocols for later module executions", () => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "hash failed");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Key:\n def __hash__(self):\n  fail()\nkey=Key()\ndef make():\n return {key:1}\n");
  expect(() => state.run("result=make()\n")).toThrow(failure); expect(state.calls.depth).toBe(0);
  const key = state.globals.get("key")!;
  expect(() => state.keys.hash(key)).toThrow("guest key hashing requires an active runtime frame");
  expect(() => state.keys.hash(state.v.tuple([key]))).toThrow("guest key hashing requires an active runtime frame");
  state.run("def good(self):\n visit('good')\n return 7\nKey.__hash__=good\nresult=make()\nfound=key in result\n");
  expect(state.globals.get("found")).toBe(state.v.true); expect(state.events).toEqual(["good", "good"]); expect(state.calls.depth).toBe(0);
});

it.each(["dict", "set"])("uses guest hash, reflected equality and truth for %s keys", kind => {
  const state = fixture(), { v, meter } = state;
  state.builtins.set("make", v.builtinFunction({ name: "make", invoke(_args, _keywords, _meter, invocation) {
    const items = new OrderedKeyMap<RuntimeValue, RuntimeValue>(createRuntimeKeyOperations(v, state.hash, meter, invocation), meter);
    return kind === "dict" ? v.dictionary(items) : v.set(items);
  } }));
  state.run(`class Truth:\n def __bool__(self):\n  visit('truth')\n  return True\nclass Key:\n def __hash__(self):\n  visit('hash')\n  return 7\n def __eq__(self,other):\n  visit('base')\n  return False\nclass Child(Key):\n __hash__=Key.__hash__\n def __eq__(self,other):\n  visit('child')\n  return Truth()\nleft=Key()\nright=Child()\nresult=make()\n${kind === "dict" ? "result[left]=1\nresult[right]=2" : "result.add(left)\nresult.add(right)"}\nfound=right in result\n`);
  const result = state.globals.get("result")!;
  if (result.kind !== "dict" && result.kind !== "set") throw Error("expected collection");
  expect(result.items.size).toBe(1); expect(state.globals.get("found")).toBe(v.true);
  expect(state.events).toEqual(["hash", "hash", "child", "truth", "hash", "child", "truth"]);
});

it("calls instance type slots and reflects callability without binding the descriptor", () => {
  const state = fixture(), { v } = state;
  state.run("class C:\n def __call__(self,value,*,extra):\n  return value+extra\ninstance=C()\ninstance.__call__=None\nrecognized=callable(instance)\nresult=instance(7,extra=2)\n");
  expect(state.globals.get("recognized")).toBe(v.true); expect(state.globals.get("result")).toEqual(v.integer(9));
});

it("expands custom keyword mappings through keys and live item lookup", () => {
  const state = fixture(), { v } = state;
  state.run("class Mapping:\n def keys(self):\n  visit('keys')\n  return ['left','right']\n def __getitem__(self,key):\n  visit(key)\n  return 7\ndef target(*,left,right):\n return left+right\nresult=target(**Mapping())\n");
  expect(state.globals.get("result")).toEqual(v.integer(14)); expect(state.events).toEqual(["keys", "left", "right"]);
});

it("unpacks custom mappings into dictionary displays with overwrite semantics", () => {
  const state = fixture();
  state.run("class Mapping:\n def keys(self):\n  visit('keys')\n  return ['left','right']\n def __getitem__(self,key):\n  visit(key)\n  return 7\nresult={'left':1,**Mapping(),'right':9}\nleft=result['left']\nright=result['right']\n");
  expect(state.globals.get("left")).toEqual(state.v.integer(7)); expect(state.globals.get("right")).toEqual(state.v.integer(9)); expect(state.events).toEqual(["keys", "left", "right"]);
});

it("uses one keys lookup and live non-string keys for display unpacking", () => {
  const state = fixture();
  state.run("names=[1,2,1]\ndef keys():\n visit('keys')\n return names\nclass Descriptor:\n def __get__(self,instance,owner):\n  visit('bind')\n  return keys\nclass Mapping:\n keys=Descriptor()\n def __init__(self):\n  self.count=0\n def __getitem__(self,key):\n  visit('get')\n  names[1]=3\n  self.count+=1\n  return self.count\nresult={**Mapping()}\nfirst=result[1]\nsecond=result[3]\n");
  expect(state.events).toEqual(["bind", "keys", "get", "get", "get"]); expect(state.globals.get("first")).toEqual(state.v.integer(3)); expect(state.globals.get("second")).toEqual(state.v.integer(2));
});

it.each(["lookup", "keys", "get"])("preserves display unpacking error boundaries during %s", stage => {
  for (const name of ["AttributeError", "KeyError", "TypeError", "host"]) {
    const state = fixture();
    const failure = name === "KeyError" ? new PythonKeyError(state.v.string("sentinel"), state.meter) : name === "host" ? new Error("host failure") : new PythonRuntimeError(name, "sentinel");
    state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
    const lookup = stage === "lookup" ? "class Descriptor:\n def __get__(self,instance,owner):\n  fail()\n" : "";
    const keys = stage === "lookup" ? " keys=Descriptor()\n" : ` def keys(self):\n  ${stage === "keys" ? "fail()" : "return ['left']"}\n`;
    expect(() => state.run(`${lookup}class Mapping:\n${keys} def __getitem__(self,key):\n  fail()\nresult={**Mapping(),'later':visit('later')}\n`)).toThrow(name === "AttributeError" ? "'Mapping' object is not a mapping" : failure);
    expect(state.events).toEqual([]); expect(state.globals.has("result")).toBe(false);
  }
});

it("does not accept iterable pairs as display mappings", () => {
  const state = fixture();
  expect(() => state.run("class Pairs:\n def __getitem__(self,index):\n  visit('get')\n  return ('left',7)\nresult={**Pairs()}\n")).toThrow("'Pairs' object is not a mapping");
  expect(state.events).toEqual([]);
});

it("updates dictionaries in place from guest mappings and retains identity", () => {
  const state = fixture();
  state.run("class Mapping:\n def keys(self):\n  visit('keys')\n  return ['left','right']\n def __getitem__(self,key):\n  visit(key)\n  return 7\nresult={'left':1}\nalias=result\nresult|=Mapping()\nleft=result['left']\nright=result['right']\n");
  expect(state.globals.get("result")).toBe(state.globals.get("alias")); expect(state.globals.get("left")).toEqual(state.v.integer(7)); expect(state.globals.get("right")).toEqual(state.v.integer(7));
  expect(state.events).toEqual(["keys", "left", "right"]);
});

it("updates dictionaries through native methods using guest mapping protocols", () => {
  const state = fixture();
  state.run("class Mapping:\n def keys(self):\n  visit('keys')\n  return ['left','right']\n def __getitem__(self,key):\n  visit(key)\n  return 7\nresult={}\nreturned=result.update(Mapping(),right=9)\nleft=result['left']\nright=result['right']\n");
  expect(state.globals.get("returned")).toBe(state.v.none); expect(state.globals.get("left")).toEqual(state.v.integer(7)); expect(state.globals.get("right")).toEqual(state.v.integer(9)); expect(state.events).toEqual(["keys", "left", "right"]);
});

it("constructs dictionary keys from guest sequences without consulting length hints", () => {
  const state = fixture();
  state.builtins.set("fromkeys", createDictionaryFromKeysBuiltin(state.v, state.keys, state.meter));
  state.run("class Source:\n def __getitem__(self,index):\n  visit('get')\n  return ('left','right','left')[index]\n def __len__(self):\n  visit('length')\n  return 3\npayload=[]\nresult=fromkeys(Source(),payload)\nleft=result['left']\nright=result['right']\n");
  expect(state.globals.get("left")).toBe(state.globals.get("payload")); expect(state.globals.get("right")).toBe(state.globals.get("payload")); expect(state.events).toEqual(["get", "get", "get", "get"]);
});

it.each([
  ["update", [1, 2, 3]], ["intersection_update", [2]], ["difference_update", [1]], ["symmetric_difference_update", [1, 3]],
  ["union", [1, 2, 3]], ["intersection", [2]], ["difference", [1]], ["symmetric_difference", [1, 3]]
] as const)("runs set %s with guest iterable sources", (method, expected) => {
  const state = fixture();
  state.run(`class Source:\n def __getitem__(self,index):\n  visit('get')\n  return (2,3)[index]\nreceiver={1,2}\nreturned=receiver.${method}(Source())\n`);
  const returned = state.globals.get("returned")!, receiver = state.globals.get("receiver")!;
  const result = returned.kind === "none" ? receiver : returned; if (result.kind !== "set") throw Error("expected set");
  expect(result.items.snapshot().map(([key]) => Number((key as { value: bigint }).value)).sort()).toEqual(expected);
  expect(state.events).toEqual(["get", "get", "get"]);
});

it.each(["isdisjoint", "issubset", "issuperset"])("runs set %s with guest iterable sources", method => {
  const state = fixture();
  state.run(`class Source:\n def __getitem__(self,index):\n  visit('get')\n  return (2,3)[index]\nresult={1,2}.${method}(Source())\n`);
  expect(state.globals.get("result")).toBe(state.v.false);
});

it("expands guest iterables in starred set displays", () => {
  const state = fixture();
  state.run("class Source:\n def __getitem__(self,index):\n  visit('get')\n  return (2,3,2)[index]\n def __len__(self):\n  visit('length')\n  return 3\nresult={1,*Source(),4}\n");
  const result = state.globals.get("result")!; if (result.kind !== "set") throw Error("expected set");
  expect(result.items.size).toBe(4); expect(state.events).toEqual(["get", "get", "get", "get"]);
});

it.each(["keys", "items"])("checks dictionary %s view disjointness against guest iterables", kind => {
  const state = fixture(), entries = kind === "keys" ? "(2,3)" : "((2,20),(3,30))";
  state.run(`class Source:\n def __getitem__(self,index):\n  visit('get')\n  return ${entries}[index]\nresult={1:10,2:20}.${kind}().isdisjoint(Source())\n`);
  expect(state.globals.get("result")).toBe(state.v.false); expect(state.events).toEqual(["get"]);
});

it.each(["keys", "items"])("combines dictionary %s views with forward and reflected guest iterables", kind => {
  for (const [operator, size] of [["|", 3], ["&", 1], ["-", 1], ["^", 2]] as const) for (const reflected of [false, true]) {
    const state = fixture(), entries = kind === "keys" ? "(2,3)" : "((2,20),(3,30))";
    state.run(`class Source:\n def __getitem__(self,index):\n  visit('get')\n  return ${entries}[index]\nview={1:10,2:20}.${kind}()\nresult=${reflected ? `Source()${operator}view` : `view${operator}Source()`}\n`);
    const result = state.globals.get("result")!; if (result.kind !== "set") throw Error("expected set"); expect(result.items.size).toBe(size); expect(state.events).toEqual(["get", "get", "get"]);
  }
});

it.each(["keys", "items"])("observes backing dictionary mutations during %s view iteration", kind => {
  const state = fixture(), key = kind === "keys" ? "3" : "(3,30)";
  state.run(`mapping={1:10}\nview=mapping.${kind}()\nclass Source:\n def __getitem__(self,index):\n  visit('get')\n  mapping[3]=30\n  return (${key},)[index]\ndisjoint=view.isdisjoint(Source())\nresult=view&Source()\n`);
  expect(state.globals.get("disjoint")).toBe(state.v.false);
  const result = state.globals.get("result")!; if (result.kind !== "set") throw Error("expected set"); expect(result.items.size).toBe(1); expect(state.events).toEqual(["get", "get", "get"]);
});

it("retains guest numeric precedence around dictionary view union", () => {
  const state = fixture();
  state.run("class Source:\n def __getitem__(self,index):\n  visit('get')\n  return (2,)[index]\n def __or__(self,other):\n  visit('forward')\n  return 77\n def __ror__(self,other):\n  visit('reflected')\n  return 88\nview={1:10}.keys()\nleft=view|Source()\nright=Source()|view\n");
  expect(state.globals.get("left")?.kind).toBe("set"); expect(state.globals.get("right")).toEqual(state.v.integer(77)); expect(state.events).toEqual(["get", "get", "forward"]);
});

it("uses guest equality and truth for dictionary item view disjointness", () => {
  const state = fixture();
  state.run("class Truth:\n def __bool__(self):\n  visit('truth')\n  return True\nclass Value:\n def __eq__(self,other):\n  visit('equal')\n  return Truth()\nleft=Value()\nright=Value()\nresult={1:left}.items().isdisjoint([(1,right)])\n");
  expect(state.globals.get("result")).toBe(state.v.false); expect(state.events).toEqual(["equal", "truth"]);
});

it("disables inherited hashing when a class defines equality without a hash", () => {
  const state = fixture();
  state.run("class Base:\n def __hash__(self):\n  return 7\nclass Equal(Base):\n def __eq__(self,other):\n  return True\nresult=Equal.__dict__['__hash__']\n");
  expect(state.globals.get("result")).toBe(state.v.none);
});

it("dispatches guest hash methods for direct and nested immutable values", () => {
  const state = fixture(); state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.run("class Value:\n def __hash__(self):\n  visit('hash')\n  return 7\nvalue=Value()\ndirect=hash(value)\nnested=hash((value,value))\nexpected=hash((7,7))\n");
  expect(state.globals.get("direct")).toEqual(state.v.integer(7)); expect(state.globals.get("nested")).toEqual(state.globals.get("expected")); expect(state.events).toEqual(["hash", "hash", "hash"]);
});

it("honors disabled and live hash slots while ignoring instance shadows", () => {
  const state = fixture(); state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.run("class Value:\n def __hash__(self):\n  return 7\nvalue=Value()\nvalue.__hash__=None\nfirst=hash(value)\nValue.__hash__=None\n");
  expect(state.globals.get("first")).toEqual(state.v.integer(7)); expect(() => state.run("hash(value)\n")).toThrow("unhashable type: 'Value'");
  state.run("def replacement(self):\n return -1\nValue.__hash__=replacement\nrestored=hash(value)\nclass Equal:\n __eq__=None\n");
  expect(state.globals.get("restored")).toEqual(state.v.integer(-2)); expect(() => state.run("hash((Equal(),))\n")).toThrow("unhashable type: 'Equal'");
});

it("binds hash descriptors and distinguishes disabled results from invalid return values", () => {
  const state = fixture(); state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.run("def target():\n visit('call')\n return True\nclass Descriptor:\n def __get__(self,instance,owner):\n  visit('bind')\n  return target\nclass Value:\n __hash__=Descriptor()\nresult=hash(Value())\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(1)); expect(state.events).toEqual(["bind", "call"]);
  state.run("def disabled(self,instance,owner):\n return None\nDescriptor.__get__=disabled\n"); expect(() => state.run("hash(Value())\n")).toThrow("unhashable type: 'Value'");
  state.run("def bad(self):\n return 1.5\nValue.__hash__=bad\n"); expect(() => state.run("hash(Value())\n")).toThrow("__hash__ method should return an integer");
});

it("uses metaclass hash slots and normalizes oversized hash results", () => {
  const state = fixture(); state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.run("class Meta(type):\n def __hash__(self):\n  visit('meta')\n  return 2**100\nclass Value(metaclass=Meta):\n pass\nresult=hash(Value)\nexpected=hash(2**100)\n");
  expect(state.globals.get("result")).toEqual(state.globals.get("expected")); expect(state.events).toEqual(["meta"]);
});

it("preserves guest hash exceptions and explicit extension precedence", () => {
  const state = fixture(), failure = new PythonRuntimeError("TypeError", "hash failed");
  state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash)); state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Value:\n def __hash__(self):\n  fail()\nvalue=Value()\n");
  expect(() => state.run("hash(value)\n")).toThrow(failure); expect(() => state.run("hash((value,))\n")).toThrow(failure);
  const value = state.globals.get("value")!;
  state.builtins.set("custom", createHashBuiltin(state.v, state.meter, { ...state.hash, guestHash: candidate => candidate !== value ? undefined : { lookupHash: () => () => state.v.integer(19), integer: result => result.kind === "int" ? result.value : undefined, typeName: () => "Value" } }));
  state.run("result=custom(value)\n"); expect(state.globals.get("result")).toEqual(state.v.integer(19));
});

it("treats missing hash descriptors as unhashable without masking hash-body errors", () => {
  const state = fixture(), failure = new PythonRuntimeError("AttributeError", "hash attribute missing");
  state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash)); state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Descriptor:\n def __get__(self,instance,owner):\n  visit('bind')\n  fail()\nclass Value:\n __hash__=Descriptor()\nvalue=Value()\n");
  expect(() => state.run("hash(value)\n")).toThrow("unhashable type: 'Value'"); expect(() => state.run("hash((value,))\n")).toThrow("unhashable type: 'Value'");
  state.run("def body(self):\n fail()\nValue.__hash__=body\n");
  expect(() => state.run("hash(value)\n")).toThrow(failure); expect(state.events).toEqual(["bind", "bind"]);
});

it.each(["TypeError", "ValueError", "host"])("preserves %s failures from hash descriptor binding", name => {
  const state = fixture(), failure = name === "host" ? new Error("host failure") : new PythonRuntimeError(name, "binding failed");
  state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash)); state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Descriptor:\n def __get__(self,instance,owner):\n  fail()\nclass Value:\n __hash__=Descriptor()\nvalue=Value()\n");
  expect(() => state.run("hash(value)\n")).toThrow(failure); expect(() => state.run("hash((value,))\n")).toThrow(failure);
});

it("publishes automatic hash disabling before descriptor initialization and preserves inheritance", () => {
  const state = fixture();
  state.run("class Descriptor:\n def __set_name__(self,owner,name):\n  self.hash=owner.__dict__['__hash__']\nmarker=Descriptor()\nclass Equal:\n __eq__=None\n field=marker\nclass Child(Equal):\n pass\nseen=marker.hash\ninherited=Child.__hash__\nowned=Child.__dict__.get('__hash__','absent')\n");
  expect(state.globals.get("seen")).toBe(state.v.none); expect(state.globals.get("inherited")).toBe(state.v.none); expect(state.globals.get("owned")).toEqual(state.v.string("absent"));
});

it("preserves explicit hash declarations and does not normalize late equality assignments", () => {
  const state = fixture();
  state.run("class Base:\n def __hash__(self):\n  return 7\nclass Explicit(Base):\n __eq__=None\n __hash__=Base.__hash__\nclass Late(Base):\n pass\nLate.__eq__=None\nexplicit=Explicit.__hash__\ninherited=Late.__hash__\noriginal=Base.__hash__\nowned=Late.__dict__.get('__hash__','absent')\nclass OnlyNe:\n __ne__=None\nne_hash=OnlyNe.__dict__.get('__hash__','absent')\n");
  expect(state.globals.get("explicit")).toBe(state.globals.get("original")); expect(state.globals.get("inherited")).toBe(state.globals.get("original"));
  expect(state.globals.get("owned")).toEqual(state.v.string("absent")); expect(state.globals.get("ne_hash")).toEqual(state.v.string("absent"));
});

it("accounts for equality and hash member slots before automatic hash disabling", () => {
  const state = fixture();
  state.run("class EqualSlot:\n __slots__=('__eq__',)\nclass HashSlot:\n __slots__=('__hash__',)\n __eq__=None\ndisabled=EqualSlot.__dict__['__hash__']\nmember=HashSlot.__dict__['__hash__']\n");
  expect(state.globals.get("disabled")).toBe(state.v.none); expect(state.globals.get("member")?.kind).toBe("member_descriptor");
});

it.each(["&", "^"])("uses guest value equality in dictionary items %s", operator => {
  const state = fixture();
  state.run(`class Value:\n def __eq__(self,other):\n  visit('equal')\n  return True\n def __hash__(self):\n  return 1\nleft=Value()\nright=Value()\nresult={1:left}.items()${operator}{1:right}.items()\n`);
  const result = state.globals.get("result")!; if (result.kind !== "set") throw Error("expected set"); expect(result.items.size).toBe(operator === "&" ? 1 : 0); expect(state.events).toEqual(["equal"]);
});

it("retains identity shortcuts for dictionary item view comparisons", () => {
  const state = fixture();
  state.run("class Value:\n def __eq__(self,other):\n  visit('equal')\n  return False\n def __hash__(self):\n  return 1\nvalue=Value()\nleft={1:value}.items()\nright={1:value}.items()\ndisjoint=left.isdisjoint(right)\ncommon=left&right\ndifferent=left^right\n");
  expect(state.globals.get("disjoint")).toBe(state.v.false); expect(state.events).toEqual([]);
  const common = state.globals.get("common")!, different = state.globals.get("different")!;
  if (common.kind !== "set" || different.kind !== "set") throw Error("expected sets"); expect(common.items.size).toBe(1); expect(different.items.size).toBe(0);
});

it.each(["left.isdisjoint(right)", "left&right", "left^right"])("propagates guest truth failures during %s", expression => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "truth failed");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Truth:\n def __bool__(self):\n  visit('truth')\n  fail()\nclass Value:\n def __eq__(self,other):\n  visit('equal')\n  return Truth()\nleft={1:Value()}.items()\nright={1:Value()}.items()\nresult=99\n");
  expect(() => state.run(`result=${expression}\n`)).toThrow(failure); expect(state.globals.get("result")).toEqual(state.v.integer(99)); expect(state.events).toEqual(["equal", "truth"]);
});

it.each([["set", constructRuntimeSet], ["frozenset", constructRuntimeFrozenSet]] as const)("constructs %s through active guest iteration", (name, construct) => {
  const state = fixture();
  state.builtins.set(name, state.v.builtinFunction({ name, invoke(args, keywords, meter, context) { return construct(args, keywords, state.v, state.keys, meter, context?.iteration); } }));
  state.run(`class Source:\n def __getitem__(self,index):\n  visit('get')\n  return (2,3,2)[index]\n def __len__(self):\n  visit('length')\n  return None\nresult=${name}(Source())\n`);
  const result = state.globals.get("result")!; if (result.kind !== "set" && result.kind !== "frozenset") throw Error("expected set storage");
  expect(result.kind).toBe(name); expect(result.items.size).toBe(2); expect(state.events).toEqual(["get", "get", "get", "get"]);
  state.events.length = 0;
  expect(() => state.run(`${name}(Source(),None)\n`)).toThrow(`${name} expected at most 1 argument, got 2`);
  expect(() => state.run(`${name}(Source(),extra=1)\n`)).toThrow(`${name}() takes no keyword arguments`); expect(state.events).toEqual([]);
});

it.each(["{1,*Source(),visit('later')}", "set(Source())", "frozenset(Source())"])("does not publish failed set construction through %s", expression => {
  const state = fixture();
  for (const [name, construct] of [["set", constructRuntimeSet], ["frozenset", constructRuntimeFrozenSet]] as const) {
    state.builtins.set(name, state.v.builtinFunction({ name, invoke(args, keywords, meter, context) { return construct(args, keywords, state.v, state.keys, meter, context?.iteration); } }));
  }
  state.run("class Source:\n def __getitem__(self,index):\n  visit('get')\n  return (2,[],3)[index]\nresult=99\n");
  expect(() => state.run(`result=${expression}\n`)).toThrow("unhashable type: 'list'");
  expect(state.globals.get("result")).toEqual(state.v.integer(99)); expect(state.events).toEqual(["get", "get"]);
});

it.each([
  ["update", 3, [1, 2, 3]], ["difference_update", 2, [1]], ["intersection_update", 2, [1, 2]], ["symmetric_difference_update", 3, [1, 2]]
] as const)("preserves set %s failure semantics for guest iteration", (method, first, expected) => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "iteration failed");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  expect(() => state.run(`class Source:\n def __getitem__(self,index):\n  visit('get')\n  if index==1:\n   fail()\n  return ${first}\nreceiver={1,2}\nreceiver.${method}(Source())\n`)).toThrow(failure);
  const receiver = state.globals.get("receiver")!; if (receiver.kind !== "set") throw Error("expected set");
  expect(receiver.items.snapshot().map(([key]) => Number((key as { value: bigint }).value)).sort()).toEqual(expected); expect(state.events).toEqual(["get", "get"]);
});

it.each(["union", "intersection", "difference", "symmetric_difference", "isdisjoint", "issubset", "issuperset"])("retains frozenset receiver semantics for guest %s", method => {
  const state = fixture();
  state.run("class Source:\n def __getitem__(self,index):\n  visit('get')\n  return (2,3)[index]\noriginal={1,2}\n");
  const original = state.globals.get("original")!; if (original.kind !== "set") throw Error("expected set");
  state.globals.set("frozen", state.v.frozenSet(original.items));
  state.run(`result=frozen.${method}(Source())\n`);
  expect(state.globals.get("result")?.kind).toBe(method.startsWith("is") ? "bool" : "frozenset"); expect(original.items.size).toBe(2);
});

it("exposes fromkeys on dictionary instances without copying their entries", () => {
  const state = fixture();
  state.run("original={'old':1}\nfromkeys=original.fromkeys\nresult=fromkeys(('left','right'),7)\nleft=result['left']\nright=result['right']\nold=original['old']\n");
  expect(state.globals.get("left")).toEqual(state.v.integer(7)); expect(state.globals.get("right")).toEqual(state.v.integer(7)); expect(state.globals.get("old")).toEqual(state.v.integer(1));
  expect(state.globals.get("result")).not.toBe(state.globals.get("original"));
});

it("stops fromkeys on an invalid key without closing or exhausting a guest cursor", () => {
  const state = fixture();
  state.builtins.set("finish", state.v.builtinFunction({ name: "finish", invoke() { throw new PythonRuntimeError("StopIteration", ""); } }));
  state.run("class Source:\n def __init__(self):\n  self.index=0\n def __iter__(self):\n  visit('iter')\n  return self\n def __length_hint__(self):\n  visit('hint')\n  return 3\n def __next__(self):\n  visit('next')\n  if self.index==3:\n   finish()\n  key=('left',[],'right')[self.index]\n  self.index+=1\n  return key\n def close(self):\n  visit('close')\nsource=Source()\n");
  expect(() => state.run("{}.fromkeys(source)\n")).toThrow("unhashable type: 'list'");
  state.run("result={}.fromkeys(source,7)\nright=result['right']\n"); expect(state.globals.get("right")).toEqual(state.v.integer(7));
  expect(state.events).toEqual(["iter", "next", "next", "iter", "next", "next"]);
});

it("validates fromkeys arguments before guest iteration and leaves proxies unchanged", () => {
  const state = fixture();
  state.run("class Source:\n def __getitem__(self,index):\n  visit('get')\n  return 'left'\nsource=Source()\noriginal={}\n");
  expect(() => state.run("{}.fromkeys(source,None,None)\n")).toThrow("fromkeys expected at most 2 arguments, got 3");
  expect(() => state.run("{}.fromkeys(source,value=7)\n")).toThrow("dict.fromkeys() takes no keyword arguments");
  expect(state.events).toEqual([]);
  const original = state.globals.get("original")!; if (original.kind !== "dict") throw Error("expected dictionary");
  state.globals.set("proxy", state.v.mappingProxy(original)); expect(() => state.run("proxy.fromkeys\n")).toThrow("'mappingproxy' object has no attribute 'fromkeys'");
});

it("checks update arity before mapping effects but validates keywords after writes", () => {
  const state = fixture();
  state.run("class Mapping:\n def keys(self):\n  visit('keys')\n  return ['left']\n def __getitem__(self,key):\n  visit(key)\n  return 7\nresult={}\n");
  expect(() => state.run("result.update(Mapping(),None)\n")).toThrow("update expected at most 1 argument, got 2"); expect(state.events).toEqual([]);
  expect(() => state.run("result.update(Mapping(),**{1:2})\n")).toThrow("keywords must be strings"); expect(state.events).toEqual(["keys", "left"]);
  state.run("left=result['left']\n"); expect(state.globals.get("left")).toEqual(state.v.integer(7));
});

it("retains partial method updates and does not apply keywords after mapping failure", () => {
  const state = fixture(), failure = new PythonRuntimeError("AttributeError", "mapping failed");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  expect(() => state.run("class Mapping:\n def keys(self):\n  return ['left','right']\n def __getitem__(self,key):\n  visit(key)\n  if key=='right':\n   fail()\n  return 7\nresult={}\nresult.update(Mapping(),left=9)\n")).toThrow(failure);
  state.run("left=result['left']\n"); expect(state.globals.get("left")).toEqual(state.v.integer(7)); expect(state.events).toEqual(["left", "right"]);
});

it("allows extracted update methods to consume guest sequence pairs", () => {
  const state = fixture();
  state.run("class Source:\n def __getitem__(self,index):\n  visit('get')\n  return (('left',7),('right',9))[index]\nresult={}\nupdate=result.update\nreturned=update(Source())\nleft=result['left']\nright=result['right']\n");
  expect(state.globals.get("returned")).toBe(state.v.none); expect(state.globals.get("left")).toEqual(state.v.integer(7)); expect(state.globals.get("right")).toEqual(state.v.integer(9)); expect(state.events).toEqual(["get", "get", "get"]);
});

it("passes guest protocols through dictionary construction before keyword overrides", () => {
  const state = fixture();
  state.builtins.set("make", state.v.builtinFunction({ name: "make", invoke(args, _keywords, meter, context) { return constructRuntimeDictionary(args, new Map([["left", state.v.integer(9)]]), state.v, state.keys, meter, context); } }));
  state.run("class Mapping:\n def keys(self):\n  visit('keys')\n  return ['left','right']\n def __getitem__(self,key):\n  visit(key)\n  return 7\nresult=make(Mapping())\nleft=result['left']\nright=result['right']\n");
  expect(state.globals.get("left")).toEqual(state.v.integer(9)); expect(state.globals.get("right")).toEqual(state.v.integer(7)); expect(state.events).toEqual(["keys", "left", "right"]);
});

it("looks up mapping keys twice and overwrites repeated live keys", () => {
  const state = fixture();
  state.run("def names():\n visit('keys')\n return ['left','left']\nclass Descriptor:\n def __get__(self,instance,owner):\n  visit('bind')\n  return names\nclass Mapping:\n keys=Descriptor()\n def __init__(self):\n  self.count=0\n def __getitem__(self,key):\n  visit(key)\n  self.count+=1\n  return self.count\nresult={}\nresult|=Mapping()\nvalue=result['left']\n");
  expect(state.events).toEqual(["bind", "bind", "keys", "left", "left"]); expect(state.globals.get("value")).toEqual(state.v.integer(2));
});

it("updates dictionaries from guest sequences containing guest pair sequences", () => {
  const state = fixture();
  state.builtins.set("finish", state.v.builtinFunction({ name: "finish", invoke() { throw new PythonRuntimeError("IndexError", ""); } }));
  state.run("class Row:\n def __getitem__(self,index):\n  visit('row')\n  if index==0:\n   return 'left'\n  if index==1:\n   return 7\n  finish()\nclass Source:\n def __getitem__(self,index):\n  visit('source')\n  if index==0:\n   return Row()\n  finish()\nresult={}\nresult|=Source()\nvalue=result['left']\n");
  expect(state.events).toEqual(["source", "row", "row", "row", "source"]); expect(state.globals.get("value")).toEqual(state.v.integer(7));
});

it("preserves prior mapping writes and the original exception on update failure", () => {
  const state = fixture(), failure = new PythonRuntimeError("AttributeError", "lookup failed");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  expect(() => state.run("class Mapping:\n def keys(self):\n  return ['left','right']\n def __getitem__(self,key):\n  visit(key)\n  if key=='right':\n   fail()\n  return 7\nresult={}\nresult|=Mapping()\n")).toThrow(failure);
  state.run("value=result['left']\n"); expect(state.globals.get("value")).toEqual(state.v.integer(7)); expect(state.events).toEqual(["left", "right"]);
});

it("retains live list keys during custom keyword expansion", () => {
  const state = fixture();
  state.run("class Mapping:\n def keys(self):\n  self.names=['left','old']\n  return self.names\n def __getitem__(self,key):\n  visit(key)\n  self.names[1]='right'\n  return 7\ndef target(*,left,right):\n return left+right\nresult=target(**Mapping())\n");
  expect(state.events).toEqual(["left", "right"]); expect(state.globals.get("result")).toEqual(state.v.integer(14));
});

it("materializes custom key iterators before retrieving mapping values", () => {
  const state = fixture();
  state.builtins.set("finish", state.v.builtinFunction({ name: "finish", invoke() { throw new PythonRuntimeError("StopIteration", ""); } }));
  state.run("class Cursor:\n def __init__(self):\n  self.i=0\n def __iter__(self):\n  visit('iter')\n  return self\n def __length_hint__(self):\n  visit('hint')\n  return 2\n def __next__(self):\n  visit('next')\n  self.i+=1\n  if self.i>2:\n   finish()\n  if self.i==1:\n   return 'left'\n  return 'right'\nclass Mapping:\n def keys(self):\n  visit('keys')\n  return Cursor()\n def __getitem__(self,key):\n  visit(key)\n  return 7\ndef target(**kwargs):\n pass\ntarget(**Mapping())\n");
  expect(state.events).toEqual(["keys", "iter", "iter", "hint", "next", "next", "next", "left", "right"]);
});

it("rejects duplicate mapping keys before retrieving their values", () => {
  const state = fixture();
  expect(() => state.run("class Mapping:\n def keys(self):\n  return ['left','left']\n def __getitem__(self,key):\n  visit(key)\n  return 7\ndef target(**kwargs):\n pass\ntarget(**Mapping())\n")).toThrow("guest() got multiple values for keyword argument 'left'");
  expect(state.events).toEqual(["left"]);
});

it.each(["keys", "get"])("translates mapping protocol exceptions from %s", stage => {
  for (const name of ["AttributeError", "KeyError", "TypeError", "ValueError"]) {
    const state = fixture();
    state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw name === "KeyError" ? new PythonKeyError(state.v.string("left"), state.meter) : new PythonRuntimeError(name, "sentinel"); } }));
    const source = `class Mapping:\n def keys(self):\n  ${stage === "keys" ? "fail()" : "return ['left']"}\n def __getitem__(self,key):\n  fail()\ndef target(**kwargs):\n pass\ntarget(**Mapping())\n`;
    const expected = name === "AttributeError" ? "guest() argument after ** must be a mapping, not Mapping" : name === "KeyError" ? "guest() got multiple values for keyword argument 'left'" : "sentinel";
    expect(() => state.run(source)).toThrow(expected);
  }
});

it("reports non-iterable mapping keys with owned type names", () => {
  const state = fixture();
  expect(() => state.run("class Mapping:\n def keys(self):\n  return None\ndef target(**kwargs):\n pass\ntarget(**Mapping())\n")).toThrow("Mapping.keys() returned a non-iterable (type NoneType)");
});

it("honors call and descriptor overrides on native method-wrapper subclasses", () => {
  const state = fixture(), { v, registry } = state;
  state.globals.set("staticmethod", registry.methodDecoratorType("staticmethod"));
  state.globals.set("classmethod", registry.methodDecoratorType("classmethod"));
  state.run("def target():\n return 1\nclass Static(staticmethod):\n def __call__(self):\n  return 7\n def __get__(self,instance,owner):\n  return 9\nclass Class(classmethod):\n def __call__(self):\n  return 11\n def __get__(self,instance,owner):\n  return 13\nstatic=Static(target)\nclassed=Class(target)\nstatic_result=static()\nclass_result=classed()\nrecognized=callable(classed)\nclass Owner:\n first=static\n second=classed\nfirst=Owner.first\nsecond=Owner().second\n");
  expect(state.globals.get("static_result")).toEqual(v.integer(7)); expect(state.globals.get("class_result")).toEqual(v.integer(11)); expect(state.globals.get("recognized")).toBe(v.true);
  expect(state.globals.get("first")).toEqual(v.integer(9)); expect(state.globals.get("second")).toEqual(v.integer(13));
});

it("retains inherited wrapper behavior while observing disabled and live overrides", () => {
  const state = fixture(), { v, registry } = state;
  state.globals.set("staticmethod", registry.methodDecoratorType("staticmethod")); state.globals.set("classmethod", registry.methodDecoratorType("classmethod"));
  state.run("def target(*args):\n return 7\nclass Static(staticmethod):\n pass\nclass Class(classmethod):\n pass\nstatic=Static(target)\nclassed=Class(target)\nresult=static()\nclass_callable=callable(classed)\nclass Owner:\n first=static\n second=classed\nfirst=Owner.first()\nsecond=Owner.second()\nStatic.__call__=None\n");
  expect(state.globals.get("result")).toEqual(v.integer(7)); expect(state.globals.get("first")).toEqual(v.integer(7)); expect(state.globals.get("second")).toEqual(v.integer(7)); expect(state.globals.get("class_callable")).toBe(v.false);
  expect(() => state.run("static()\n")).toThrow("'NoneType' object is not callable");
  state.run("Static.__get__=None\n"); expect(() => state.run("Owner.first\n")).toThrow("'NoneType' object is not callable");
  state.run("del Static.__get__\ndel Static.__call__\nrestored=static()\n"); expect(state.globals.get("restored")).toEqual(v.integer(7));
});

it("does not unwrap subclass overrides inside staticmethod and bound-method calls", () => {
  const state = fixture(), { v, registry } = state; state.globals.set("staticmethod", registry.methodDecoratorType("staticmethod"));
  state.run("def target(*args):\n return 1\nclass Static(staticmethod):\n def __call__(self,*args):\n  return 9\nwrapped=Static(target)\nouter=staticmethod(wrapped)\nresult=outer()\nclass Owner:\n pass\n");
  const wrapped = state.globals.get("wrapped")!, owner = state.globals.get("Owner")!;
  state.globals.set("bound", v.boundMethod(wrapped, owner)); state.run("bound_result=bound()\n");
  expect(state.globals.get("result")).toEqual(v.integer(9)); expect(state.globals.get("bound_result")).toEqual(v.integer(9));
});

it("honors data-descriptor slots added by a method-wrapper subclass", () => {
  const state = fixture(), { v, registry } = state; state.globals.set("staticmethod", registry.methodDecoratorType("staticmethod"));
  state.run("def target():\n return 1\nclass Static(staticmethod):\n def __get__(self,instance,owner):\n  return instance.value\n def __set__(self,instance,value):\n  instance.value=value\nclass Owner:\n field=Static(target)\ninstance=Owner()\ninstance.__dict__['field']=99\ninstance.field=7\nresult=instance.field\n");
  expect(state.globals.get("result")).toEqual(v.integer(7));
});

it("distinguishes absent and disabled call slots and observes live class changes", () => {
  const state = fixture(), { v } = state;
  state.run("class C:\n pass\ninstance=C()\nabsent=callable(instance)\ninstance.__call__=None\nshadow=callable(instance)\nC.__call__=None\ndisabled=callable(instance)\n");
  expect(state.globals.get("absent")).toBe(v.false); expect(state.globals.get("shadow")).toBe(v.false); expect(state.globals.get("disabled")).toBe(v.true);
  expect(() => state.run("instance()\n")).toThrow("'NoneType' object is not callable");
  state.run("del C.__call__\n"); expect(() => state.run("instance()\n")).toThrow("'C' object is not callable");
});

it("binds custom call descriptors only during invocation", () => {
  const state = fixture(), { v } = state;
  state.run("def target(value):\n visit('target')\n return value\nclass Descriptor:\n def __get__(self,instance,owner):\n  visit('bind')\n  return target\nclass C:\n __call__=Descriptor()\ninstance=C()\nrecognized=callable(instance)\n");
  expect(state.globals.get("recognized")).toBe(v.true); expect(state.events).toEqual([]);
  state.run("result=instance(7)\n"); expect(state.globals.get("result")).toEqual(v.integer(7)); expect(state.events).toEqual(["bind", "target"]);
  expect(() => state.run("instance(**{1:2})\n")).toThrow("keywords must be strings");
  expect(state.events).toEqual(["bind", "target", "bind"]);
  state.run("C.__call__=None\n");
  expect(() => state.run("instance(**{1:2})\n")).toThrow("'NoneType' object is not callable");
});

it("bounds recursive instance calls and restores the shared call stack", () => {
  const state = fixture(), { v } = state;
  state.run("class C:\n def __call__(self):\n  return self()\ninstance=C()\n");
  expect(() => state.run("instance()\n")).toThrow("maximum recursion depth exceeded");
  expect(state.calls.depth).toBe(0);
  state.run("def replacement(self):\n return 7\nC.__call__=replacement\nresult=instance()\n");
  expect(state.globals.get("result")).toEqual(v.integer(7));
});

it("applies owned data-descriptor precedence for reads, writes and deletion", () => {
  const state = fixture(), { v } = state;
  state.run("class Descriptor:\n def __get__(self,instance,owner):\n  if instance is None:\n   return owner\n  return instance.value\n def __set__(self,instance,value):\n  visit('set')\n  instance.value=value\n def __delete__(self,instance):\n  visit('delete')\n  instance.value=None\nclass C:\n field=Descriptor()\ninstance=C()\ninstance.__dict__['field']=99\ninstance.field=7\nresult=instance.field\nowner=C.field is C\ndel instance.field\nremoved=instance.field\n");
  expect(state.globals.get("result")).toEqual(v.integer(7)); expect(state.globals.get("owner")).toBe(v.true); expect(state.globals.get("removed")).toBe(v.none);
  expect(state.events).toEqual(["set", "delete"]);
});

it("reports missing paired descriptor mutation methods", () => {
  const state = fixture();
  state.run("class SetOnly:\n def __set__(self,instance,value):\n  pass\nclass DeleteOnly:\n def __delete__(self,instance):\n  pass\nclass C:\n setter=SetOnly()\n deleter=DeleteOnly()\ninstance=C()\n");
  expect(() => state.run("del instance.setter\n")).toThrow("__delete__");
  expect(() => state.run("instance.deleter=7\n")).toThrow("__set__");
});

it("bounds descriptor-binding recursion before entering a function body", () => {
  const state = fixture();
  state.run("class Descriptor:\n pass\ndescriptor=Descriptor()\nDescriptor.__get__=descriptor\nclass C:\n __call__=descriptor\ninstance=C()\n");
  expect(() => state.run("instance()\n")).toThrow("maximum recursion depth exceeded"); expect(state.calls.depth).toBe(0);
});

it("constructs ordinary class statements through the concrete builtin builder", () => {
  const state = fixture(), { v } = state;
  state.run("def decorate(cls):\n visit(cls.__name__)\n return cls\n@decorate\nclass C:\n __slots__=('field',)\n def owner(self):\n  return __class__\ninstance=C()\ninstance.field=7\nresult=instance.field\nowner=instance.owner() is C\n");
  expect(state.globals.get("result")).toEqual(v.integer(7)); expect(state.globals.get("owner")).toBe(v.true);
  expect(state.events).toEqual(["C"]); expect(state.globals.has("__slots__")).toBe(false);
});

it("dispatches ordinary subscription reads, writes, augmentation and deletion to guest slots", () => {
  const state = fixture(), { v } = state;
  state.run("class Mapping:\n def __getitem__(self,key):\n  visit('get:'+key)\n  return self.value\n def __setitem__(self,key,value):\n  visit('set:'+key)\n  self.value=value\n def __delitem__(self,key):\n  visit('del:'+key)\n  self.value=None\nmapping=Mapping()\nmapping['field']=7\nmapping['field']+=2\nresult=mapping['field']\ndel mapping['field']\nremoved=mapping.value\n");
  expect(state.globals.get("result")).toEqual(v.integer(9)); expect(state.globals.get("removed")).toBe(v.none);
  expect(state.events).toEqual(["set:field", "get:field", "set:field", "get:field", "del:field"]);
});

it("binds inherited class subscription and prioritizes the metaclass item slot", () => {
  const state = fixture(), { v } = state;
  state.run("class Base:\n def __class_getitem__(cls,key):\n  visit(key)\n  return cls\nclass Child(Base):\n pass\nselected=Child['class'] is Child\nclass Meta(type):\n def __getitem__(cls,key):\n  visit(key)\n  return 7\nclass C(Base,metaclass=Meta):\n pass\nresult=C['meta']\n");
  expect(state.globals.get("selected")).toBe(v.true); expect(state.globals.get("result")).toEqual(v.integer(7));
  expect(state.events).toEqual(["class", "meta"]);
});

it("passes tuple and slice keys unchanged and ignores instance method shadows", () => {
  const state = fixture(), { v } = state;
  state.run("class C:\n def __getitem__(self,key):\n  return key\ninstance=C()\ninstance.__getitem__=None\ntuple_key=instance[1,2]\nslice_key=instance[1:5:2]\n");
  expect(state.globals.get("tuple_key")).toEqual(v.tuple([v.integer(1), v.integer(2)]));
  expect(state.globals.get("slice_key")).toMatchObject({ kind: "slice", start: v.integer(1), stop: v.integer(5), step: v.integer(2) });
});

it("does not fall back past disabled metaclass subscription or class subscription", () => {
  const state = fixture();
  state.run("class C:\n __class_getitem__=None\nclass Meta(type):\n __getitem__=None\nclass D(metaclass=Meta):\n def __class_getitem__(cls,key):\n  visit('must not call')\n");
  expect(() => state.run("C[1]\n")).toThrow("type 'C' is not subscriptable");
  expect(() => state.run("D[1]\n")).toThrow("'NoneType' object is not callable"); expect(state.events).toEqual([]);
});

it("reports missing paired mutation slots separately from unsupported subscriptions", () => {
  const state = fixture();
  state.run("class Plain:\n pass\nclass SetOnly:\n def __setitem__(self,key,value):\n  pass\nclass DeleteOnly:\n def __delitem__(self,key):\n  pass\nplain=Plain()\nsetter=SetOnly()\ndeleter=DeleteOnly()\n");
  expect(() => state.run("plain[1]\n")).toThrow("'Plain' object is not subscriptable");
  expect(() => state.run("plain[1]=2\n")).toThrow("'Plain' object does not support item assignment");
  expect(() => state.run("del plain[1]\n")).toThrow("'Plain' object doesn't support item deletion");
  expect(() => state.run("del setter[1]\n")).toThrow("__delitem__");
  expect(() => state.run("deleter[1]=2\n")).toThrow("__setitem__");
});

it("re-resolves the setter after an augmented read changes the class", () => {
  const state = fixture(), { v } = state;
  state.run("def replacement(self,key,value):\n visit('new setter')\n self.value=value\nclass C:\n def __getitem__(self,key):\n  C.__setitem__=replacement\n  return 7\n def __setitem__(self,key,value):\n  visit('old setter')\ninstance=C()\ninstance[1]+=2\nresult=instance.value\n");
  expect(state.events).toEqual(["new setter"]); expect(state.globals.get("result")).toEqual(v.integer(9));
});

it("executes prepared class bodies without leaking locals and keeps class closure cells", () => {
  const state = fixture(), { v, registry } = state;
  state.builtins.set("__build_class__", v.builtinFunction({ name: "__build_class__", invoke(args, keywords, meter, invocation) {
    const namespace = v.dictionary(registry.object.value.namespace.items.emptyCopy());
    if (args[0].kind !== "function") throw Error("expected body");
    const cell = invocation!.executeClassBody!(args[0], namespace);
    const result = invocation!.call(registry.type, [args[1], v.tuple(args.slice(2)), namespace], keywords);
    if (cell !== undefined) expect(cell.content?.value).toBe(result);
    return result;
  } }));
  state.run("def outer(value):\n class C:\n  field=value\n  def owner(self):\n   return __class__\n return C\nC=outer(7)\nresult=C.field\nowner=C().owner() is C\n");
  expect(state.globals.get("result")).toEqual(v.integer(7)); expect(state.globals.get("owner")).toBe(v.true);
  expect(state.globals.has("field")).toBe(false); expect(state.globals.has("__qualname__")).toBe(false);
});

it("orders native builder preparation, body, allocation, initialization and decoration", () => {
  const state = fixture(), { v, registry } = state;
  state.globals.set("classmethod", registry.methodDecoratorType("classmethod"));
  state.run("class Meta(type):\n @classmethod\n def __prepare__(meta,name,bases,*,flag):\n  visit('prepare:'+flag)\n  return {'seed':7}\n def __new__(meta,name,bases,namespace,*,flag):\n  visit('new:'+flag)\n  return type.__new__(meta,name,bases,namespace)\n def __init__(cls,name,bases,namespace,*,flag):\n  visit('init:'+flag)\ndef decorate(cls):\n visit('decorate')\n return cls\n@decorate\nclass C(metaclass=Meta,flag='value'):\n visit('body')\n field=seed\nresult=C.field\n");
  expect(state.events).toEqual(["prepare:value", "body", "new:value", "init:value", "decorate"]);
  expect(state.globals.get("result")).toEqual(v.integer(7));
});

it("resolves MRO entries before preparation and records the original base tuple", () => {
  const state = fixture(), { v } = state;
  state.run("class Base:\n pass\nclass Proxy:\n def __mro_entries__(self,bases):\n  visit('resolve')\n  return (Base,)\nproxy=Proxy()\nclass C(proxy):\n __orig_bases__=None\noriginal=C.__orig_bases__[0] is proxy\nresolved=C.__bases__[0] is Base\n");
  expect(state.events).toEqual(["resolve"]); expect(state.globals.get("original")).toBe(v.true); expect(state.globals.get("resolved")).toBe(v.true);
});

it("allows non-type metaclasses and arbitrary results without class-cell checks", () => {
  const state = fixture();
  state.run("def meta(name,bases,namespace,*,flag):\n visit(flag)\n return False\nclass C(metaclass=meta,flag='construct'):\n def owner(self):\n  return __class__\n");
  expect(state.events).toEqual(["construct"]); expect(state.globals.get("C")).toBe(state.v.false);
});

it("checks preparation mapping flags before executing the body", () => {
  const state = fixture(); state.globals.set("classmethod", state.registry.methodDecoratorType("classmethod"));
  state.run("class Meta(type):\n @classmethod\n def __prepare__(meta,*args):\n  return None\n");
  expect(() => state.run("class C(metaclass=Meta):\n visit('body')\n")).toThrow("Meta.__prepare__() must return a mapping, not NoneType");
  state.run("class SequenceMeta(type):\n @classmethod\n def __prepare__(meta,*args):\n  return []\n");
  expect(() => state.run("class C(metaclass=SequenceMeta):\n visit('body')\n")).toThrow("list indices must be integers or slices, not str");
  expect(state.events).toEqual([]); expect(state.globals.has("C")).toBe(false);
});

it("diagnoses a metaclass that drops the captured class cell", () => {
  const state = fixture();
  state.run("class Meta(type):\n def __new__(meta,name,bases,namespace):\n  namespace.pop('__classcell__')\n  return type.__new__(meta,name,bases,namespace)\n");
  expect(() => state.run("class C(metaclass=Meta):\n def owner(self):\n  return __class__\n")).toThrow("__class__ not set defining 'C' as <class 'example.C'>. Was __classcell__ propagated to type.__new__?");
  expect(state.globals.has("C")).toBe(false);
});

it("rejects a metaclass result inconsistent with the captured class cell", () => {
  const state = fixture();
  state.run("class Other:\n pass\nclass Meta(type):\n def __new__(meta,name,bases,namespace):\n  created=type.__new__(meta,name,bases,namespace)\n  return Other\n");
  expect(() => state.run("class C(metaclass=Meta):\n def owner(self):\n  return __class__\n")).toThrow("__class__ set to <class 'example.C'> defining 'C' as <class 'example.Other'>");
  expect(state.globals.has("C")).toBe(false);
});

it("prepares independent namespaces through inherited native class-method binding", () => {
  const state = fixture();
  state.run("Meta=type('Meta',(type,),{})\nfirst=type.__prepare__()\nsecond=Meta.__prepare__(None,False,1,unexpected=True)\nfirst['field']=7\nC=type.__new__(Meta,'C',(),first)\nresult=C.field\nindependent=first is not second\nowner=Meta.__prepare__.__self__ is Meta\ndoc=Meta.__prepare__.__doc__\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(7));
  expect(state.globals.get("independent")).toBe(state.v.true); expect(state.globals.get("owner")).toBe(state.v.true);
  expect(state.globals.get("second")).toMatchObject({ kind: "dict", items: { size: 0 } });
  expect(state.globals.get("doc")).toEqual(state.v.string("Create the namespace for the class statement"));
});

it("executes custom prepared mapping slots in order and replaces deletion failures", () => {
  const state = fixture(), { v } = state, events: string[] = [];
  const keyName = (key: RuntimeValue) => { if (key.kind !== "str") throw Error("expected name"); return String.fromCodePoint(...key.value); };
  state.globals.set("read", v.builtinFunction({ name: "read", invoke(args) {
    const key = keyName(args[0]); events.push("get:" + key);
    if (key === "supplied") return v.integer(17);
    throw new PythonRuntimeError("KeyError", key);
  } }));
  state.globals.set("write", v.builtinFunction({ name: "write", invoke(args) { events.push("set:" + keyName(args[0])); return v.none; } }));
  state.globals.set("remove", v.builtinFunction({ name: "remove", invoke(args) { events.push("del:" + keyName(args[0])); throw new PythonRuntimeError("ValueError", "denied"); } }));
  state.run("def get(self,key):\n return read(key)\ndef set(self,key,value):\n return write(key,value)\ndef delete(self,key):\n return remove(key)\nMapping=type('Mapping',(),{'__getitem__':get,'__setitem__':set,'__delitem__':delete})\nnamespace=Mapping()\n");
  state.builtins.set("__build_class__", v.builtinFunction({ name: "__build_class__", invoke(args, _keywords, _meter, invocation) {
    if (args[0].kind !== "function") throw Error("expected body");
    invocation!.executeClassBody!(args[0], state.globals.get("namespace")!); return v.none;
  } }));
  expect(() => state.run("class C:\n field=supplied\n del field\n")).toThrow("name 'field' is not defined");
  expect(events).toEqual(["get:__name__", "set:__module__", "set:__qualname__", "set:__firstlineno__", "get:supplied", "set:field", "del:field"]);
  expect(state.globals.has("C")).toBe(false);
});

it("keeps optimized function bodies independent of a supplied class namespace", () => {
  const state = fixture(), { v } = state, cell = v.cell({}); state.globals.set("cell", cell);
  state.globals.set("execute", v.builtinFunction({ name: "execute", invoke(args, _keywords, _meter, invocation) {
    if (args[0].kind !== "function") throw Error("expected body");
    const result = invocation!.executeClassBody!(args[0], v.none); return result === cell.value ? v.true : v.false;
  } }));
  state.run("def body():\n local=7\n return cell\nresult=execute(body)\n");
  expect(state.globals.get("result")).toBe(v.true); expect(state.globals.has("local")).toBe(false);
  state.run("def requires(value):\n return value\n");
  expect(() => state.run("execute(requires)\n")).toThrow("missing 1 required positional argument");
});

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
