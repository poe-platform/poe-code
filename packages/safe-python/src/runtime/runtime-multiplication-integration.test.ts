import { expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { executeRuntimeProgram, type RuntimeProgramHooks } from "./runtime-program.js";
import { RuntimeValues, type RuntimeValue, type TypeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout, type RuntimeTypeLayoutOptions } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { createRepresentationBuiltin } from "./builtin-representation.js";
import { createSumBuiltin } from "./builtin-sum.js";
import { createPowBuiltin } from "./builtin-pow.js";
import { createDivmodBuiltin } from "./builtin-divmod.js";
import { createIterBuiltin, createNextBuiltin } from "./builtin-iteration.js";
import { PythonRuntimeError } from "./error.js";
import { CallStack } from "./call-stack.js";
import { createRange } from "./integer-sequence.js";
import { createSortedBuiltin } from "./builtin-sorted.js";
import { createAttributeMutationBuiltin } from "./builtin-attribute-mutation.js";
import { createAttributeLookupBuiltin } from "./builtin-attribute-lookup.js";
import { getRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";
import { allocateRuntimeType } from "./runtime-type-allocation.js";
import { finalizeRuntimeType } from "./runtime-type-finalization.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), types = new Map<RuntimeValue, TypeValue>();
  let functionType: TypeValue | undefined;
  const globals = new Map<string, RuntimeValue>(), events: string[] = [];
  const builtins = new Map<string, RuntimeValue>([["NotImplemented", v.notImplemented], ["repr", createRepresentationBuiltin("repr", v, meter)], ["visit", v.builtinFunction({ name: "visit", invoke(args) {
    const value = args[0]; if (value.kind !== "str") throw Error("expected event string");
    events.push(String.fromCodePoint(...value.value)); return v.none;
  } })]]);
  const unused = (): never => { throw Error("unexpected guest operation"); };
  const hooks: RuntimeProgramHooks = {
    specialMethods: () => ({ typeOf(value) {
      const type = types.get(value); if (type !== undefined) return type;
      if (value.kind === "list") return registry.listType();
      if (value.kind === "dict") return registry.dictionaryType();
      if (value.kind === "int") return registry.integerType();
      if (value.kind === "method" || value.kind === "method-wrapper" || value.kind === "builtin_function_or_method") return registry.boundCallableType(value.kind);
      throw Error(`unexpected type lookup: ${value.kind}`);
    }, slots: () => undefined }),
    expressions: () => ({ warn: unused }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }),
    callable: () => false, name: () => "method()", keywordName: unused, invoke: unused
  };
  function type(name: string, base = registry.object, options: RuntimeTypeLayoutOptions = {}, metaclass = registry.type): TypeValue {
    return registry.publish(new RuntimeTypeLayout(name, [base.value], v.dictionary(new OrderedKeyMap(keys, meter)), meter, options), metaclass);
  }
  function method(owner: TypeValue, name: string, source: string) {
    const code = compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, v, meter);
    executeRuntimeProgram(code, { values: v, globals, builtins, keys, hooks, calls: new CallStack<object>(50, meter) }, meter);
    const functionName = code.functions.values().next().value!.name;
    if (functionName.kind !== "str") throw Error("expected function name");
    const value = globals.get(String.fromCodePoint(...functionName.value))!;
    types.set(value, functionType ??= type("function", registry.object, { sequenceTable: false }));
    owner.value.namespace.items.set(v.string(name), value); return value;
  }
  function guest(name: string, owner: TypeValue) { const value = v.cell({}); types.set(value, owner); globals.set(name, value); return value; }
  function instance(name: string, owner: TypeValue, withDictionary = true) {
    const value = v.instance(owner, withDictionary ? v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)) : undefined);
    globals.set(name, value); return value;
  }
  function run(source: string) {
    const program = compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, v, meter);
    executeRuntimeProgram(program, { values: v, globals, builtins, keys, hooks, calls: new CallStack<object>(50, meter) }, meter);
  }
  return { v, meter, globals, events, hooks, type, method, guest, instance, run, registry, types };
}

it("stores compiled slot attributes outside dictionaries and rejects undeclared writes", () => {
  const state = fixture(), namespace = state.v.dictionary(new OrderedKeyMap({ hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, state.v, state.meter).value }, state.meter));
  namespace.items.set(state.v.string("__slots__"), state.v.tuple([state.v.string("x"), state.v.string("__hidden")]));
  const owner = allocateRuntimeType(state.v.string("C"), [], namespace, state.registry.type, state.registry, state.v, state.meter);
  state.globals.set("C", owner); state.run("instance=C()\n");
  expect(() => state.run("instance.x\n")).toThrow("'C' object has no attribute 'x'");
  state.run("instance.x=7\ninstance._C__hidden=None\nresult=instance.x\nhidden=instance._C__hidden\ndel instance.x\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(7)); expect(state.globals.get("hidden")).toBe(state.v.none);
  expect(() => state.run("instance.__dict__\n")).toThrow("has no attribute '__dict__'");
  expect(() => state.run("instance.extra=1\n")).toThrow("has no attribute 'extra'");
  expect(() => state.run("del instance.x\n")).toThrow("x");
});

it("retains slot values across compatible compiled class reassignment", () => {
  const state = fixture(), namespace = state.v.dictionary(new OrderedKeyMap({ hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, state.v, state.meter).value }, state.meter));
  namespace.items.set(state.v.string("__slots__"), state.v.tuple([state.v.string("x")]));
  for (const name of ["C", "D"]) state.globals.set(name, allocateRuntimeType(state.v.string(name), [], namespace, state.registry.type, state.registry, state.v, state.meter));
  state.run("instance=C()\ninstance.x=9\ninstance.__class__=D\nresult=instance.x\nchanged=instance.__class__ is D\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(9)); expect(state.globals.get("changed")).toBe(state.v.true);
});

it("reads native documentation through compiled attribute access", () => {
  const state = fixture(); state.globals.set("object", state.registry.object);
  state.run("init_doc=object.__init__.__doc__\nnew_doc=object.__new__.__doc__\ninstance=object()\nbound_doc=instance.__init__.__doc__\nclass_doc=object.__dict__['__class__'].__doc__\n");
  expect(state.globals.get("init_doc")).toEqual(state.v.string("Initialize self.  See help(type(self)) for accurate signature."));
  expect(state.globals.get("bound_doc")).toEqual(state.globals.get("init_doc"));
  expect(state.globals.get("new_doc")).toEqual(state.v.string("Create and return a new object.  See help(type) for accurate signature."));
  expect(state.globals.get("class_doc")).toEqual(state.v.string("the object's class"));
});

it.each([
  ["[True] * index", "[True, True]"], ["index * [True]", "[True, True]"],
  ["(True,) * index", "(True, True)"], ["index * (True,)", "(True, True)"],
  ["'x' * index", "'xx'"], ["index * 'x'", "'xx'"],
  ["b'x' * index", "b'xx'"], ["index * b'x'", "b'xx'"]
])("uses inherited compiled index fallback for %s", (expression, expected) => {
  const state = fixture(), base = state.type("Base"), derived = state.type("Derived", base);
  state.method(base, "__index__", "def index(self):\n visit('index')\n return 2\n");
  state.guest("index", derived);
  state.run(`result=repr(${expression})\n`);
  expect(state.globals.get("result")).toEqual(state.v.string(expected));
  expect(state.events).toEqual(["index"]);
});

it.each([false, true])("runs compiled numeric methods before index conversion (reflected=%s)", reflected => {
  const state = fixture(), owner = state.type("Guest");
  state.method(owner, reflected ? "__rmul__" : "__mul__", "def multiply(self, other):\n visit('multiply')\n return False\n");
  state.method(owner, "__index__", "def index(self):\n visit('index')\n return 2\n");
  state.guest("guest", owner);
  state.run(`def calculate():\n return ${reflected ? "'x' * guest" : "guest * 'x'"}\nresult=calculate()\n`);
  expect(state.globals.get("result")).toBe(state.v.false);
  expect(state.events).toEqual(["multiply"]);
});

it.each([false, true])("prioritizes only overridden subtype reflected methods (overridden=%s)", overridden => {
  const state = fixture(), base = state.type("Base"), derived = state.type("Derived", base);
  state.method(base, "__mul__", "def multiply(self, other):\n visit('forward')\n return 'forward'\n");
  state.method(base, "__rmul__", "def reflect(self, other):\n visit('inherited')\n return 'inherited'\n");
  if (overridden) state.method(derived, "__rmul__", "def reflect(self, other):\n visit('override')\n return 'override'\n");
  state.guest("left", base); state.guest("right", derived);
  state.run("result=left * right\n");
  expect(state.globals.get("result")).toEqual(state.v.string(overridden ? "override" : "forward"));
  expect(state.events).toEqual([overridden ? "override" : "forward"]);
});

it("does not reflect declined multiplication for the same guest type", () => {
  const state = fixture(), owner = state.type("Guest");
  state.method(owner, "__mul__", "def multiply(self, other):\n visit('forward')\n return NotImplemented\n");
  state.method(owner, "__rmul__", "def reflect(self, other):\n visit('reflected')\n return 2\n");
  state.guest("left", owner); state.guest("right", owner);
  expect(() => state.run("result=left * right\n")).toThrow("unsupported operand type(s) for *: 'Guest' and 'Guest'");
  expect(state.events).toEqual(["forward"]);
});

it.each([["*", false], ["*", true], ["+", false], ["+", true]] as const)("binds class descriptors and compares their values for %s reflected priority (%s)", (operator, overridden) => {
  const state = fixture(), base = state.type("Base"), derived = state.type("Derived", base), v = state.v;
  const forwardName = operator === "+" ? "__add__" : "__mul__", reflectedName = operator === "+" ? "__radd__" : "__rmul__";
  state.method(base, forwardName, "def multiply(self, other):\n visit('forward')\n return 'forward'\n");
  const baseMethod = state.method(base, reflectedName, "def reflect(self, other):\n return 'base'\n");
  const derivedMethod = state.method(derived, reflectedName, "def reflect(self, other):\n visit('reflected')\n return 'reflected'\n");
  const a = v.cell({}), b = v.cell({}), descriptorA = v.cell({}), descriptorB = v.cell({});
  base.value.namespace.items.set(v.string(reflectedName), descriptorA);
  derived.value.namespace.items.set(v.string(reflectedName), descriptorB);
  state.guest("left", base); state.guest("right", derived);
  const special = state.hooks.specialMethods!;
  state.hooks.specialMethods = frame => ({ ...special(frame), slots(value) {
    if (value !== descriptorA && value !== descriptorB) return undefined;
    return { get(instance, owner) {
      expect(owner).toBe(value === descriptorA ? base : derived);
      state.events.push(`${value === descriptorA ? "left" : "right"}-${instance === null ? "class" : "instance"}`);
      return instance === null ? value === descriptorA ? a : b : v.boundMethod(value === descriptorA ? baseMethod : derivedMethod, instance);
    } };
  } });
  state.hooks.expressions = () => ({ warn() {}, richComparison(operator, left, right) {
    expect(operator).toBe("!="); expect(left).toBe(a); expect(right).toBe(b); state.events.push("compare");
    return { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented, forward: () => v.boolean(overridden), reflected: () => v.notImplemented } };
  } });
  state.run(`result=left ${operator} right\n`);
  expect(state.globals.get("result")).toEqual(v.string(overridden ? "reflected" : "forward"));
  expect(state.events).toEqual(["right-class", "left-class", "compare", ...(overridden ? ["right-instance", "reflected"] : ["forward"])]);
});

it("looks up the reflected method after a forward method mutates its namespace", () => {
  const state = fixture(), left = state.type("Left"), right = state.type("Right");
  const replacement = state.method(right, "__rmul__", "def reflect(self, other):\n visit('new')\n return 'new'\n");
  state.method(right, "__rmul__", "def reflect(self, other):\n visit('old')\n return 'old'\n");
  state.globals.set("mutate", state.v.builtinFunction({ name: "mutate", invoke() {
    right.value.namespace.items.set(state.v.string("__rmul__"), replacement); return state.v.none;
  } }));
  state.method(left, "__mul__", "def multiply(self, other):\n mutate()\n return NotImplemented\n");
  state.guest("left", left); state.guest("right", right);
  state.run("result=left * right\n");
  expect(state.globals.get("result")).toEqual(state.v.string("new")); expect(state.events).toEqual(["new"]);
});

it("does not treat a disabled multiplication slot as absent", () => {
  const state = fixture(), owner = state.type("Guest");
  owner.value.namespace.items.set(state.v.string("__mul__"), state.v.none);
  state.method(owner, "__index__", "def index(self):\n visit('index')\n return 2\n");
  state.guest("guest", owner);
  expect(() => state.run("result=guest * 'x'\n")).toThrow("'NoneType' object is not callable");
  expect(state.events).toEqual([]);
});

it("keeps native multiplication independent of guest type and index policies", () => {
  const state = fixture();
  state.hooks.expressions = () => ({ warn() {}, get integerIndex(): never { throw Error("unused index policy"); } });
  state.run("number=6*7\ntext='a'*2\n");
  expect(state.globals.get("number")).toEqual(state.v.integer(42));
  expect(state.globals.get("text")).toEqual(state.v.string("aa"));
});

it("retains explicit multiplication policies ahead of MRO assembly", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.guest("guest", owner);
  state.hooks.specialMethods = () => ({ typeOf(): never { throw Error("explicit policy must win"); }, slots: () => undefined });
  state.hooks.expressions = () => ({ warn() {}, multiplication: () => ({ numeric: {
    relation: "other", notImplemented: v.notImplemented, forward: () => v.integer(42), reflected: () => v.notImplemented, reflectedIsOverridden: () => false
  } }) });
  state.run("result=guest * 2\n");
  expect(state.globals.get("result")).toEqual(v.integer(42));
});

it.each(["type", "call"])("stops multiplication after cancellation during %s", stage => {
  const controller = new AbortController(), state = fixture(controller.signal), owner = state.type("Guest");
  state.guest("guest", owner);
  state.globals.set("stop", state.v.builtinFunction({ name: "stop", invoke() { controller.abort(); return state.v.none; } }));
  state.method(owner, "__mul__", "def multiply(self, other):\n stop()\n return False\n");
  if (stage === "type") {
    const special = state.hooks.specialMethods!;
    state.hooks.specialMethods = frame => {
      const original = special(frame);
      return { ...original, typeOf(value) { const type = original.typeOf(value); controller.abort(); return type; } };
    };
  }
  expect(() => state.run("result=guest * 'x'\n")).toThrow("execution cancelled");
  expect(state.globals.has("result")).toBe(false);
});

it.each([-2, 0, 1, 2])("preserves list aliases during augmented guest-index repetition (%s)", count => {
  const state = fixture(), owner = state.type("Index"), items = state.v.list([state.v.true]);
  state.method(owner, "__index__", `def index(self):\n visit('index')\n return ${count}\n`);
  state.guest("guest", owner); state.globals.set("items", items);
  state.run("alias=items\nitems *= guest\nsame=items is alias\n");
  expect(state.globals.get("same")).toBe(state.v.true);
  expect(state.globals.get("items")).toBe(items);
  expect(items.items.snapshot()).toEqual(Array(Math.max(0, count)).fill(state.v.true));
  expect(state.events).toEqual(["index"]);
});

it("allows reflected multiplication to win before native in-place repetition", () => {
  const state = fixture(), owner = state.type("Guest"), items = state.v.list([state.v.true]);
  state.method(owner, "__rmul__", "def reflect(self, other):\n visit('reflected')\n return False\n");
  state.method(owner, "__index__", "def index(self):\n visit('index')\n return 2\n");
  state.guest("guest", owner); state.globals.set("items", items);
  state.run("alias=items\nitems *= guest\n");
  expect(state.globals.get("items")).toBe(state.v.false);
  expect(state.globals.get("alias")).toBe(items);
  expect(items.items.snapshot()).toEqual([state.v.true]);
  expect(state.events).toEqual(["reflected"]);
});

it("does not mutate the right-hand list during augmented repetition", () => {
  const state = fixture(), items = state.v.list([state.v.true]);
  state.globals.set("items", items);
  state.run("count=2\ncount *= items\n");
  const result = state.globals.get("count");
  expect(result?.kind).toBe("list");
  if (result?.kind !== "list") throw Error("expected list");
  expect(result).not.toBe(items); expect(result.items.snapshot()).toEqual([state.v.true, state.v.true]);
  expect(items.items.snapshot()).toEqual([state.v.true]);
});

it("preserves cyclic aliases when repeating a list through a guest index", () => {
  const state = fixture(), owner = state.type("Index"), items = state.v.list([]);
  items.items.append(items);
  state.method(owner, "__index__", "def index(self):\n return 2\n");
  state.guest("guest", owner); state.globals.set("items", items);
  state.run("items *= guest\n");
  expect(state.globals.get("items")).toBe(items);
  expect(items.items.length).toBe(2);
  expect(items.items.get(0n)).toBe(items); expect(items.items.get(1n)).toBe(items);
});

it.each(["valid", "invalid", "overflow"])("retains index-method mutations during augmented repetition (%s)", mode => {
  const state = fixture(), owner = state.type("Index"), items = state.v.list([state.v.true]);
  if (mode === "invalid") {
    const stringType = state.type("str"), special = state.hooks.specialMethods!;
    state.hooks.specialMethods = frame => {
      const original = special(frame);
      return { ...original, typeOf: value => value.kind === "str" ? stringType : original.typeOf(value) };
    };
  }
  state.globals.set("mutate", state.v.builtinFunction({ name: "mutate", invoke() { items.items.append(state.v.false); return state.v.none; } }));
  const result = mode === "valid" ? "2" : mode === "invalid" ? "'bad'" : "1267650600228229401496703205376";
  state.method(owner, "__index__", `def index(self):\n mutate()\n return ${result}\n`);
  state.guest("guest", owner); state.globals.set("items", items);
  if (mode === "valid") state.run("items *= guest\n");
  else expect(() => state.run("items *= guest\n")).toThrow(mode === "invalid" ? "__index__ returned non-int (type str)" : "cannot fit 'Index' into an index-sized integer");
  expect(state.globals.get("items")).toBe(items);
  expect(items.items.snapshot()).toEqual(mode === "valid" ? [state.v.true, state.v.false, state.v.true, state.v.false] : [state.v.true, state.v.false]);
});

it("retains repeated list slots when augmented target write-back fails", () => {
  const state = fixture(), owner = state.type("Index"), items = state.v.list([state.v.true]);
  state.method(owner, "__index__", "def index(self):\n return 2\n");
  state.guest("guest", owner); state.globals.set("container", state.v.tuple([items]));
  expect(() => state.run("container[0] *= guest\n")).toThrow("does not support item assignment");
  expect(items.items.snapshot()).toEqual([state.v.true, state.v.true]);
});

it.each(["list", "tuple", "str", "bytes"] as const)("rejects augmented right-%s fallback for an index-only heap type", kind => {
  const state = fixture(), owner = state.type("Index"), v = state.v;
  state.method(owner, "__index__", "def index(self):\n visit('index')\n return 2\n");
  const guest = state.guest("guest", owner);
  const right = kind === "list" ? v.list([v.true]) : kind === "tuple" ? v.tuple([v.true]) : kind === "str" ? v.string("x") : v.bytes(new Uint8Array([120]));
  state.globals.set("right", right);
  expect(() => state.run("guest *= right\n")).toThrow(`unsupported operand type(s) for *=: 'Index' and '${kind}'`);
  expect(state.globals.get("guest")).toBe(guest);
  expect(state.events).toEqual([]);
});

it("allows explicitly absent native sequence tables to use right-hand repetition", () => {
  const state = fixture(), owner = state.type("NativeIndex", undefined, { sequenceTable: false }), v = state.v;
  state.method(owner, "__index__", "def index(self):\n visit('index')\n return 2\n");
  state.guest("guest", owner);
  const right = v.list([v.true]); state.globals.set("right", right);
  state.run("guest *= right\n");
  const result = state.globals.get("guest");
  expect(result?.kind).toBe("list");
  if (result?.kind !== "list") throw Error("expected list");
  expect(result).not.toBe(right); expect(result.items.snapshot()).toEqual([v.true, v.true]);
  expect(right.items.snapshot()).toEqual([v.true]); expect(state.events).toEqual(["index"]);
});

it("runs numeric multiplication before testing right-sequence fallback eligibility", () => {
  const state = fixture(), owner = state.type("Guest");
  state.method(owner, "__mul__", "def multiply(self, other):\n visit('numeric')\n return False\n");
  state.method(owner, "__index__", "def index(self):\n visit('index')\n return 2\n");
  state.guest("guest", owner);
  state.run("guest *= [True]\n");
  expect(state.globals.get("guest")).toBe(state.v.false);
  expect(state.events).toEqual(["numeric"]);
});

it.each([
  ["+", "__iadd__"], ["-", "__isub__"], ["*", "__imul__"], ["@", "__imatmul__"],
  ["/", "__itruediv__"], ["//", "__ifloordiv__"], ["%", "__imod__"], ["**", "__ipow__"],
  ["<<", "__ilshift__"], [">>", "__irshift__"], ["&", "__iand__"], ["^", "__ixor__"], ["|", "__ior__"]
])("executes inherited %s= guest slots in nested frames", (operator, name) => {
  const state = fixture(), base = state.type("Base"), owner = state.type("Derived", base);
  state.method(base, name, "def inplace(self, other):\n visit('inplace')\n return other\n");
  state.guest("guest", owner);
  state.run(`def calculate():\n value=guest\n value ${operator}= 7\n return value\nresult=calculate()\n`);
  expect(state.globals.get("result")).toEqual(state.v.integer(7));
  expect(state.events).toEqual(["inplace"]);
});

it.each(["self", "False", "NotImplemented"])("honors __imul__ result %s before ordinary multiplication", result => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.method(owner, "__imul__", `def inplace(self, other):\n visit('inplace')\n return ${result}\n`);
  state.method(owner, "__mul__", "def multiply(self, other):\n visit('ordinary')\n return 42\n");
  const guest = state.guest("guest", owner);
  state.run("guest *= 7\n");
  expect(state.globals.get("guest")).toBe(result === "self" ? guest : result === "False" ? v.false : v.integer(42));
  expect(state.events).toEqual(result === "NotImplemented" ? ["inplace", "ordinary"] : ["inplace"]);
});

it("does not fall back after a disabled __imul__ slot", () => {
  const state = fixture(), owner = state.type("Guest");
  owner.value.namespace.items.set(state.v.string("__imul__"), state.v.none);
  state.method(owner, "__mul__", "def multiply(self, other):\n visit('ordinary')\n return 42\n");
  const guest = state.guest("guest", owner);
  expect(() => state.run("guest *= 7\n")).toThrow("'NoneType' object is not callable");
  expect(state.globals.get("guest")).toBe(guest); expect(state.events).toEqual([]);
});

it("binds an in-place descriptor only after evaluating the right operand", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v, guest = state.guest("guest", owner), descriptor = v.cell({});
  owner.value.namespace.items.set(v.string("__imul__"), descriptor);
  state.globals.set("rhs", v.builtinFunction({ name: "rhs", invoke() { state.events.push("rhs"); return v.integer(7); } }));
  const method = v.builtinFunction({ name: "bound", invoke(args) { expect(args).toEqual([v.integer(7)]); state.events.push("call"); return v.false; } });
  const special = state.hooks.specialMethods!;
  state.hooks.specialMethods = frame => ({ ...special(frame), slots(value) {
    expect(value).toBe(descriptor);
    return { get(instance, type) { expect(instance).toBe(guest); expect(type).toBe(owner); state.events.push("bind"); return method; } };
  } });
  state.run("guest *= rhs()\n");
  expect(state.globals.get("guest")).toBe(v.false);
  expect(state.events).toEqual(["rhs", "bind", "call"]);
});

it("prepares ordinary multiplication only after a declining in-place method mutates the type", () => {
  const state = fixture(), owner = state.type("Guest");
  const replacement = state.method(owner, "__mul__", "def multiply(self, other):\n visit('new')\n return 42\n");
  state.method(owner, "__mul__", "def multiply(self, other):\n visit('old')\n return 1\n");
  state.globals.set("mutate", state.v.builtinFunction({ name: "mutate", invoke() {
    owner.value.namespace.items.set(state.v.string("__mul__"), replacement); return state.v.none;
  } }));
  state.method(owner, "__imul__", "def inplace(self, other):\n mutate()\n return NotImplemented\n");
  state.guest("guest", owner);
  state.run("guest *= 7\n");
  expect(state.globals.get("guest")).toEqual(state.v.integer(42)); expect(state.events).toEqual(["new"]);
});

it("preserves explicit in-place hooks and their receiver ahead of MRO dispatch", () => {
  const state = fixture(), owner = state.type("Guest"), guest = state.guest("guest", owner), statements = state.hooks.statements;
  state.hooks.specialMethods = () => ({ typeOf(): never { throw Error("explicit hook must win"); }, slots: () => undefined });
  state.hooks.statements = frame => {
    const bindings = { ...statements(frame), inplace(operator: string, left: RuntimeValue, right: RuntimeValue) {
      expect(this).toBe(bindings); expect(operator).toBe("*"); expect(left).toBe(guest); expect(right).toEqual(state.v.integer(7));
      return state.v.false;
    } };
    return bindings;
  };
  state.run("guest *= 7\n");
  expect(state.globals.get("guest")).toBe(state.v.false);
});

it("keeps native augmented operations off the guest type policy", () => {
  const state = fixture();
  state.run("value=3\nvalue += 2\nvalue *= 4\nitems=[True]\nalias=items\nitems *= 2\n");
  expect(state.globals.get("value")).toEqual(state.v.integer(20));
  const items = state.globals.get("items");
  expect(items).toBe(state.globals.get("alias"));
  if (items?.kind !== "list") throw Error("expected list");
  expect(items.items.snapshot()).toEqual([state.v.true, state.v.true]);
});

it("stops cancelled in-place calls before fallback or target write-back", () => {
  const controller = new AbortController(), state = fixture(controller.signal), owner = state.type("Guest"), guest = state.guest("guest", owner);
  state.globals.set("stop", state.v.builtinFunction({ name: "stop", invoke() { state.events.push("mutation"); controller.abort(); return state.v.none; } }));
  state.method(owner, "__imul__", "def inplace(self, other):\n stop()\n return NotImplemented\n");
  state.method(owner, "__mul__", "def multiply(self, other):\n visit('fallback')\n return 42\n");
  expect(() => state.run("guest *= 7\n")).toThrow("execution cancelled");
  expect(state.globals.get("guest")).toBe(guest); expect(state.events).toEqual(["mutation"]);
});

it("runs the left in-place method before a strict subtype's reflected method", () => {
  const state = fixture(), base = state.type("Base"), derived = state.type("Derived", base);
  state.method(base, "__imul__", "def inplace(self, other):\n visit('inplace')\n return False\n");
  state.method(derived, "__rmul__", "def reflected(self, other):\n visit('reflected')\n return 42\n");
  state.guest("left", base); state.guest("right", derived);
  state.run("left *= right\n");
  expect(state.globals.get("left")).toBe(state.v.false); expect(state.events).toEqual(["inplace"]);
});

it("does not undo in-place method effects after target write-back fails", () => {
  const state = fixture(), owner = state.type("Guest"), guest = state.guest("guest", owner);
  state.method(owner, "__imul__", "def inplace(self, other):\n visit('mutation')\n return self\n");
  state.globals.set("container", state.v.tuple([guest]));
  expect(() => state.run("container[0] *= 7\n")).toThrow("does not support item assignment");
  expect(state.events).toEqual(["mutation"]);
  expect(state.globals.get("guest")).toBe(guest);
});

it.each([false, true])("runs inherited addition methods before sequence concatenation (reflected=%s)", reflected => {
  const state = fixture(), base = state.type("Base"), derived = state.type("Derived", base);
  state.method(base, reflected ? "__radd__" : "__add__", "def add(self, other):\n visit('add')\n return False\n");
  state.guest("guest", derived);
  state.run(`result=${reflected ? "[True] + guest" : "guest + [True]"}\n`);
  expect(state.globals.get("result")).toBe(state.v.false); expect(state.events).toEqual(["add"]);
});

it("uses ordinary MRO addition after a declining __iadd__", () => {
  const state = fixture(), owner = state.type("Guest");
  state.method(owner, "__iadd__", "def inplace(self, other):\n visit('inplace')\n return NotImplemented\n");
  state.method(owner, "__add__", "def add(self, other):\n visit('ordinary')\n return 42\n");
  state.guest("guest", owner);
  state.run("guest += 7\n");
  expect(state.globals.get("guest")).toEqual(state.v.integer(42)); expect(state.events).toEqual(["inplace", "ordinary"]);
});

it.each([false, true])("prioritizes only overridden subtype reflected addition (%s)", overridden => {
  const state = fixture(), base = state.type("Base"), derived = state.type("Derived", base);
  state.method(base, "__add__", "def add(self, other):\n visit('forward')\n return 1\n");
  state.method(base, "__radd__", "def add(self, other):\n visit('inherited')\n return 2\n");
  if (overridden) state.method(derived, "__radd__", "def add(self, other):\n visit('override')\n return 3\n");
  state.guest("left", base); state.guest("right", derived);
  state.run("result=left + right\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(overridden ? 3 : 1));
  expect(state.events).toEqual([overridden ? "override" : "forward"]);
});

it("shares MRO addition with sum without using in-place methods", () => {
  const state = fixture(), owner = state.type("Guest"), guest = state.guest("guest", owner);
  state.method(owner, "__add__", "def add(self, other):\n visit('add')\n return self\n");
  state.method(owner, "__iadd__", "def inplace(self, other):\n visit('inplace')\n return self\n");
  state.globals.set("sum", createSumBuiltin(state.v, state.meter));
  state.run("result=sum([1,2],guest)\n");
  expect(state.globals.get("result")).toBe(guest); expect(state.events).toEqual(["add", "add"]);
});

it("does not reflect same-type addition when the forward slot declines", () => {
  const state = fixture(), owner = state.type("Guest");
  state.method(owner, "__add__", "def add(self, other):\n visit('forward')\n return NotImplemented\n");
  state.method(owner, "__radd__", "def add(self, other):\n visit('reflected')\n return 42\n");
  state.guest("left", owner); state.guest("right", owner);
  expect(() => state.run("result=left+right\n")).toThrow("unsupported operand type(s) for +: 'Guest' and 'Guest'");
  expect(state.events).toEqual(["forward"]);
});

it("retains explicit addition policies ahead of default MRO lookup", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.guest("guest", owner);
  state.hooks.specialMethods = () => ({ typeOf(): never { throw Error("explicit addition must win"); }, slots: () => undefined });
  state.hooks.expressions = () => ({ warn() {}, addition: () => ({ numeric: {
    relation: "other", notImplemented: v.notImplemented, forward: () => v.false, reflected: () => v.notImplemented, reflectedIsOverridden: () => false
  } }) });
  state.run("result=guest+1\n");
  expect(state.globals.get("result")).toBe(v.false);
});

it.each(["False", "None"])("accepts reflected list += result %s before extension", result => {
  const state = fixture(), owner = state.type("Guest"), items = state.v.list([state.v.true]);
  state.method(owner, "__radd__", `def add(self, other):\n visit('reflected')\n return ${result}\n`);
  state.guest("guest", owner); state.globals.set("items", items);
  state.run("alias=items\nitems += guest\n");
  expect(state.globals.get("items")).toBe(result === "False" ? state.v.false : state.v.none);
  expect(state.globals.get("alias")).toBe(items); expect(items.items.snapshot()).toEqual([state.v.true]);
  expect(state.events).toEqual(["reflected"]);
});

it.each([false, true])("extends only after reflected addition declines, preserving partial progress (%s)", fails => {
  const state = fixture(), owner = state.type("Guest"), v = state.v, items = v.list([v.true]);
  state.method(owner, "__radd__", "def add(self, other):\n visit('reflected')\n return NotImplemented\n");
  const guest = state.guest("guest", owner), cursor = v.cell({}), stop = new Error("stop"), failure = new Error("next failed"); let pulls = 0;
  state.globals.set("items", items);
  state.hooks.expressions = () => ({ warn() {}, iteration: {
    lookupIter(value) { expect(value).toBe(guest); state.events.push("iter"); return () => cursor; },
    hasNext: value => value === cursor,
    next() { state.events.push("next"); if (pulls++ === 0) return v.false; throw fails ? failure : stop; },
    hasSequenceItem: () => false, getItem(): never { throw Error("unexpected item lookup"); },
    isStopIteration: error => error === stop, isIndexError: () => false, typeName: () => "Guest"
  } });
  if (fails) expect(() => state.run("items += guest\n")).toThrow(failure);
  else state.run("items += guest\n");
  expect(state.globals.get("items")).toBe(items); expect(items.items.snapshot()).toEqual([v.true, v.false]);
  expect(state.events).toEqual(["reflected", "iter", "next", "next"]);
});

it("does not extend after a disabled reflected addition method", () => {
  const state = fixture(), owner = state.type("Guest"), items = state.v.list([state.v.true]);
  owner.value.namespace.items.set(state.v.string("__radd__"), state.v.none);
  state.guest("guest", owner); state.globals.set("items", items);
  expect(() => state.run("items += guest\n")).toThrow("'NoneType' object is not callable");
  expect(state.globals.get("items")).toBe(items); expect(items.items.snapshot()).toEqual([state.v.true]);
});

it("preserves native self-extension aliases through augmented addition dispatch", () => {
  const state = fixture(), items = state.v.list([state.v.true]);
  state.globals.set("items", items);
  state.run("alias=items\nitems += items\n");
  expect(state.globals.get("items")).toBe(items); expect(state.globals.get("alias")).toBe(items);
  expect(items.items.snapshot()).toEqual([state.v.true, state.v.true]);
});

it("keeps extended slots when augmented addition target write-back fails", () => {
  const state = fixture(), items = state.v.list([state.v.true]);
  state.globals.set("container", state.v.tuple([items]));
  expect(() => state.run("container[0] += [False]\n")).toThrow("does not support item assignment");
  expect(items.items.snapshot()).toEqual([state.v.true, state.v.false]);
});

it.each([
  ["-", "__sub__", "__rsub__"], ["/", "__truediv__", "__rtruediv__"], ["//", "__floordiv__", "__rfloordiv__"],
  ["%", "__mod__", "__rmod__"], ["<<", "__lshift__", "__rlshift__"], [">>", "__rshift__", "__rrshift__"],
  ["&", "__and__", "__rand__"], ["|", "__or__", "__ror__"], ["^", "__xor__", "__rxor__"], ["@", "__matmul__", "__rmatmul__"]
])("dispatches inherited %s methods in both operand orders", (operator, forward, reflected) => {
  for (const reverse of [false, true]) {
    const state = fixture(), base = state.type("Base"), owner = state.type("Derived", base), name = reverse ? reflected : forward;
    state.method(base, name, `def operation(self, other):\n visit('${name}')\n return other\n`);
    state.guest("guest", owner);
    state.run(`def calculate():\n return ${reverse ? `7 ${operator} guest` : `guest ${operator} 7`}\nresult=calculate()\n`);
    expect(state.globals.get("result")).toEqual(state.v.integer(7)); expect(state.events).toEqual([name]);
  }
});

it("uses MRO subtraction after a declined in-place method", () => {
  const state = fixture(), owner = state.type("Guest");
  state.method(owner, "__isub__", "def inplace(self, other):\n visit('inplace')\n return NotImplemented\n");
  state.method(owner, "__sub__", "def subtract(self, other):\n visit('ordinary')\n return 42\n");
  state.guest("guest", owner); state.run("guest -= 7\n");
  expect(state.globals.get("guest")).toEqual(state.v.integer(42)); expect(state.events).toEqual(["inplace", "ordinary"]);
});

it.each([false, true])("permits guest reflected union from native dictionaries (proxy=%s)", proxy => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.method(owner, "__ror__", "def union(self, other):\n visit('reflected')\n return False\n");
  state.guest("guest", owner);
  const dictionary = v.dictionary(new OrderedKeyMap({ hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => a === b }, state.meter));
  state.globals.set("left", proxy ? v.mappingProxy(dictionary) : dictionary);
  state.run("result=left | guest\n");
  expect(state.globals.get("result")).toBe(v.false); expect(state.events).toEqual(["reflected"]);
});

it("reports Python errors when native binary slots decline", () => {
  const state = fixture();
  expect(() => state.run("result=None-1\n")).toThrow("unsupported operand type(s) for -: 'NoneType' and 'int'");
});

it.each([false, true])("orders subtype reflected subtraction by override status (%s)", overridden => {
  const state = fixture(), base = state.type("Base"), derived = state.type("Derived", base);
  state.method(base, "__sub__", "def subtract(self, other):\n visit('forward')\n return 1\n");
  state.method(base, "__rsub__", "def reflected(self, other):\n visit('inherited')\n return 2\n");
  if (overridden) state.method(derived, "__rsub__", "def reflected(self, other):\n visit('override')\n return 3\n");
  state.guest("left", base); state.guest("right", derived); state.run("result=left-right\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(overridden ? 3 : 1));
  expect(state.events).toEqual([overridden ? "override" : "forward"]);
});

it("does not reflect declined same-type subtraction", () => {
  const state = fixture(), owner = state.type("Guest");
  state.method(owner, "__sub__", "def subtract(self, other):\n visit('forward')\n return NotImplemented\n");
  state.method(owner, "__rsub__", "def reflected(self, other):\n visit('reflected')\n return 2\n");
  state.guest("left", owner); state.guest("right", owner);
  expect(() => state.run("result=left-right\n")).toThrow("unsupported operand type(s) for -: 'Guest' and 'Guest'");
  expect(state.events).toEqual(["forward"]);
});

it("does not ignore disabled ordinary numeric methods", () => {
  const state = fixture(), owner = state.type("Guest");
  owner.value.namespace.items.set(state.v.string("__sub__"), state.v.none);
  state.guest("guest", owner);
  expect(() => state.run("result=guest-1\n")).toThrow("'NoneType' object is not callable");
});

it("runs native percent formatting before guest reflected modulo", () => {
  const state = fixture(), owner = state.type("Guest");
  state.method(owner, "__rmod__", "def modulo(self, other):\n visit('reflected')\n return False\n");
  state.guest("guest", owner);
  expect(() => state.run("result='literal' % guest\n")).toThrow("not all arguments converted during string formatting");
  expect(state.events).toEqual([]);
});

it("delegates right-hand mapping proxy union to the underlying dictionary", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.method(owner, "__or__", "def union(self, other):\n visit('forward')\n if other is target:\n  return False\n return NotImplemented\n");
  state.guest("guest", owner);
  const target = v.dictionary(new OrderedKeyMap({ hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => a === b }, state.meter));
  state.globals.set("target", target); state.globals.set("proxy", v.mappingProxy(target));
  state.run("result=guest | proxy\n");
  expect(state.globals.get("result")).toBe(v.false); expect(state.events).toEqual(["forward", "forward"]);
});

it("preserves explicit numeric policies and their receiver ahead of MRO lookup", () => {
  const state = fixture(), owner = state.type("Guest"), guest = state.guest("guest", owner), v = state.v;
  state.hooks.specialMethods = () => ({ typeOf(): never { throw Error("explicit numeric hook must win"); }, slots: () => undefined });
  state.hooks.expressions = () => {
    const bindings = { warn() {}, numeric(operator: string, left: RuntimeValue, right: RuntimeValue) {
      expect(this).toBe(bindings); expect(operator).toBe("-"); expect(left).toBe(guest); expect(right).toEqual(v.integer(1));
      return { numeric: { relation: "other" as const, notImplemented: v.notImplemented, forward: () => v.false, reflected: () => v.notImplemented, reflectedIsOverridden: () => false } };
    } };
    return bindings;
  };
  state.run("result=guest-1\n"); expect(state.globals.get("result")).toBe(v.false);
});

it("stops numeric calls after cancellation without assigning their result", () => {
  const controller = new AbortController(), state = fixture(controller.signal), owner = state.type("Guest");
  state.globals.set("stop", state.v.builtinFunction({ name: "stop", invoke() { controller.abort(); return state.v.none; } }));
  state.method(owner, "__sub__", "def subtract(self, other):\n stop()\n return False\n");
  state.guest("guest", owner);
  expect(() => state.run("result=guest-1\n")).toThrow("execution cancelled");
  expect(state.globals.has("result")).toBe(false);
});

it("keeps ordinary native numeric expressions off the guest type policy", () => {
  const state = fixture(); state.run("result=(9-3)//2\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(3));
});

it.each([
  ["guest ** 7", "__pow__", false], ["7 ** guest", "__rpow__", false],
  ["pow(guest, 7)", "__pow__", false], ["pow(7, guest, None)", "__rpow__", false],
  ["pow(guest, 7, 5)", "__pow__", true], ["pow(7, guest, 5)", "__rpow__", true]
] as const)("dispatches compiled power for %s", (expression, name, ternary) => {
  const state = fixture(), base = state.type("Base"), owner = state.type("Derived", base);
  state.globals.set("pow", createPowBuiltin(state.v, state.meter));
  state.method(base, name, `def power(self, other${ternary ? ", modulus" : ""}):\n visit('power')\n return ${ternary ? "modulus" : "other"}\n`);
  state.guest("guest", owner); state.run(`def calculate():\n return ${expression}\nresult=calculate()\n`);
  expect(state.globals.get("result")).toEqual(state.v.integer(ternary ? 5 : 7)); expect(state.events).toEqual(["power"]);
});

it("falls back from declined in-place power to compiled ordinary power", () => {
  const state = fixture(), owner = state.type("Guest");
  state.method(owner, "__ipow__", "def inplace(self, other):\n visit('inplace')\n return NotImplemented\n");
  state.method(owner, "__pow__", "def power(self, other):\n visit('ordinary')\n return False\n");
  state.guest("guest", owner); state.run("guest **= 3\n");
  expect(state.globals.get("guest")).toBe(state.v.false); expect(state.events).toEqual(["inplace", "ordinary"]);
});

it("lets guest power accept a float modulus before its native slot", () => {
  const state = fixture(), owner = state.type("Guest");
  state.globals.set("pow", createPowBuiltin(state.v, state.meter));
  state.method(owner, "__pow__", "def power(self, other, modulus):\n return False\n");
  state.guest("guest", owner); state.run("result=pow(guest, 7, 2.5)\n");
  expect(state.globals.get("result")).toBe(state.v.false);
});

it.each([false, true])("orders power subtype overrides with ternary=%s", ternary => {
  for (const overridden of [false, true]) {
    const state = fixture(), base = state.type("Base"), derived = state.type("Derived", base);
    state.globals.set("pow", createPowBuiltin(state.v, state.meter));
    state.method(base, "__pow__", "def power(self, other, modulus=None):\n visit('forward')\n return 1\n");
    state.method(base, "__rpow__", "def power(self, other, modulus=None):\n visit('inherited')\n return 2\n");
    if (overridden) state.method(derived, "__rpow__", "def power(self, other, modulus=None):\n visit('override')\n return 3\n");
    state.guest("left", base); state.guest("right", derived);
    state.run(`result=${ternary ? "pow(left, right, 5)" : "left ** right"}\n`);
    expect(state.globals.get("result")).toEqual(state.v.integer(overridden ? 3 : 1));
    expect(state.events).toEqual([overridden ? "override" : "forward"]);
  }
});

it.each([false, true])("does not reflect same-type power with ternary=%s", ternary => {
  const state = fixture(), owner = state.type("Guest");
  state.globals.set("pow", createPowBuiltin(state.v, state.meter));
  state.method(owner, "__pow__", "def power(self, other, modulus=None):\n visit('forward')\n return NotImplemented\n");
  state.method(owner, "__rpow__", "def power(self, other, modulus=None):\n visit('reflected')\n return False\n");
  state.guest("left", owner); state.guest("right", owner);
  expect(() => state.run(`result=${ternary ? "pow(left, right, 5)" : "left ** right"}\n`)).toThrow(ternary
    ? "unsupported operand type(s) for ** or pow(): 'Guest', 'Guest', 'int'"
    : "unsupported operand type(s) for ** or pow(): 'Guest' and 'Guest'");
  expect(state.events).toEqual(["forward"]);
});

it.each(["__pow__", "__rpow__"])("does not ignore disabled power method %s", name => {
  const state = fixture(), owner = state.type("Guest");
  owner.value.namespace.items.set(state.v.string(name), state.v.none);
  state.guest("guest", owner);
  expect(() => state.run(`result=${name === "__pow__" ? "guest ** 2" : "2 ** guest"}\n`)).toThrow("'NoneType' object is not callable");
});

it.each([
  ["pow(guest, 7, 2.5)", ["forward"]],
  ["pow(7, guest, 2.5)", ["reflected"]],
  ["pow(2.5, guest, 7)", []]
])("orders native float power slots for %s", (expression, events) => {
  const state = fixture(), owner = state.type("Guest");
  state.globals.set("pow", createPowBuiltin(state.v, state.meter));
  state.method(owner, "__pow__", "def power(self, other, modulus):\n visit('forward')\n return NotImplemented\n");
  state.method(owner, "__rpow__", "def power(self, other, modulus):\n visit('reflected')\n return NotImplemented\n");
  state.guest("guest", owner);
  expect(() => state.run(`result=${expression}\n`)).toThrow("pow() 3rd argument not allowed unless all arguments are integers");
  expect(state.events).toEqual(events);
});

it("does not call the modulus object's power methods", () => {
  const state = fixture(), owner = state.type("Guest");
  state.globals.set("pow", createPowBuiltin(state.v, state.meter));
  state.method(owner, "__pow__", "def power(self, other, modulus):\n visit('forward')\n return False\n");
  state.method(owner, "__rpow__", "def power(self, other, modulus):\n visit('reflected')\n return False\n");
  state.guest("guest", owner);
  expect(() => state.run("result=pow(7, 2, guest)\n")).toThrow("unsupported operand type(s) for ** or pow(): 'int', 'int', 'Guest'");
  expect(state.events).toEqual([]);
});

it("shares explicit power policies with operators and builtins without losing their receiver", () => {
  const state = fixture(), owner = state.type("Guest"), guest = state.guest("guest", owner), v = state.v;
  state.globals.set("pow", createPowBuiltin(v, state.meter));
  state.hooks.specialMethods = () => ({ typeOf(): never { throw Error("explicit power policy must win"); }, slots: () => undefined });
  const policy = { power(base: RuntimeValue, exponent: RuntimeValue, modulus: RuntimeValue) {
    expect(this).toBe(policy); expect(base).toBe(guest); expect(exponent).toEqual(v.integer(2)); return modulus;
  } };
  state.hooks.expressions = () => ({ warn() {}, power: policy });
  state.run("binary=guest ** 2\nternary=pow(guest, 2, 5)\n");
  expect(state.globals.get("binary")).toBe(v.none); expect(state.globals.get("ternary")).toEqual(v.integer(5));
});

it("rejects cancelled compiled power before result write-back", () => {
  const controller = new AbortController(), state = fixture(controller.signal), owner = state.type("Guest");
  state.globals.set("stop", state.v.builtinFunction({ name: "stop", invoke() { controller.abort(); return state.v.none; } }));
  state.method(owner, "__pow__", "def power(self, other):\n stop()\n return False\n");
  state.guest("guest", owner);
  expect(() => state.run("result=guest ** 2\n")).toThrow("execution cancelled");
  expect(state.globals.has("result")).toBe(false);
});

it.each([["+", "__pos__"], ["-", "__neg__"], ["~", "__invert__"]])("dispatches inherited unary %s with unrestricted results", (operator, name) => {
  for (const result of ["False", "None", "NotImplemented"]) {
    const state = fixture(), base = state.type("Base"), owner = state.type("Derived", base);
    state.method(base, name, `def unary(self):\n visit('unary')\n return ${result}\n`);
    state.guest("guest", owner); state.run(`def calculate():\n return ${operator}guest\nresult=calculate()\n`);
    expect(state.globals.get("result")).toBe(result === "False" ? state.v.false : result === "None" ? state.v.none : state.v.notImplemented);
    expect(state.events).toEqual(["unary"]);
  }
});

it.each([["+", "__pos__"], ["-", "__neg__"], ["~", "__invert__"]])("rejects disabled unary %s methods as noncallable", (operator, name) => {
  const state = fixture(), owner = state.type("Guest");
  owner.value.namespace.items.set(state.v.string(name), state.v.none); state.guest("guest", owner);
  expect(() => state.run(`result=${operator}guest\n`)).toThrow("'NoneType' object is not callable");
});

it.each(["+", "-", "~"])("reports actual guest types for missing unary %s without index coercion", operator => {
  const state = fixture(), owner = state.type("Guest");
  state.method(owner, "__index__", "def index(self):\n visit('index')\n return 2\n");
  state.guest("guest", owner);
  expect(() => state.run(`result=${operator}guest\n`)).toThrow(`bad operand type for unary ${operator}: 'Guest'`);
  expect(state.events).toEqual([]);
});

it("binds unary descriptors to the evaluated operand and actual derived type", () => {
  const state = fixture(), base = state.type("Base"), derived = state.type("Derived", base), v = state.v;
  const method = state.method(base, "__neg__", "def negative(self):\n visit('call')\n return self\n");
  const descriptor = v.cell({}), guest = state.guest("guest", derived);
  base.value.namespace.items.set(v.string("__neg__"), descriptor);
  state.globals.set("operand", v.builtinFunction({ name: "operand", invoke() { state.events.push("operand"); return guest; } }));
  const special = state.hooks.specialMethods!;
  state.hooks.specialMethods = frame => ({ ...special(frame), slots(value) {
    return value !== descriptor ? undefined : { get(instance, owner) {
      expect(instance).toBe(guest); expect(owner).toBe(derived); state.events.push("bind");
      return v.boundMethod(method, instance!);
    } };
  } });
  state.hooks.expressions = () => ({ warn() {}, attribute(): never { throw Error("ordinary attribute lookup must not run"); } });
  state.run("result=-operand()\n");
  expect(state.globals.get("result")).toBe(guest); expect(state.events).toEqual(["operand", "bind", "call"]);
});

it("preserves explicit unary protocol ownership ahead of frame lookup", () => {
  const state = fixture(), owner = state.type("Guest"), guest = state.guest("guest", owner), v = state.v, method = v.cell({});
  state.hooks.specialMethods = () => ({ typeOf(): never { throw Error("explicit unary policy must win"); }, slots: () => undefined });
  const unary = {
    lookupSpecial(value: RuntimeValue, name: string) { expect(this).toBe(unary); expect(value).toBe(guest); expect(name).toBe("__pos__"); return method; },
    call(value: RuntimeValue, args: readonly RuntimeValue[]) { expect(this).toBe(unary); expect(value).toBe(method); expect(args).toEqual([]); return v.none; }
  };
  state.hooks.expressions = () => ({ warn() {}, unary });
  state.run("result=+guest\n"); expect(state.globals.get("result")).toBe(v.none);
});

it("keeps logical not on the truth protocol instead of numeric unary lookup", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.method(owner, "__bool__", "def boolean(self):\n visit('bool')\n return True\n");
  state.guest("guest", owner);
  state.hooks.expressions = () => ({ warn() {}, unary: {
    lookupSpecial(): never { throw Error("not is not numeric"); }, call: () => v.none
  } });
  state.run("result=not guest\n"); expect(state.globals.get("result")).toBe(v.false); expect(state.events).toEqual(["bool"]);
});

it("keeps native unary values and errors off the guest type policy", () => {
  const state = fixture(), v = state.v, integer = v.integer(7);
  state.globals.set("native", integer); state.run("positive=+native\nnegative=-native\ninverted=~native\n");
  expect(state.globals.get("positive")).toBe(integer);
  expect(state.globals.get("negative")).toEqual(v.integer(-7)); expect(state.globals.get("inverted")).toEqual(v.integer(-8));
  expect(() => state.run("result=-[]\n")).toThrow("bad operand type for unary -: 'list'");
});

it("rejects cancelled compiled unary methods before assigning results", () => {
  const controller = new AbortController(), state = fixture(controller.signal), owner = state.type("Guest");
  state.globals.set("stop", state.v.builtinFunction({ name: "stop", invoke() { controller.abort(); return state.v.none; } }));
  state.method(owner, "__invert__", "def invert(self):\n stop()\n return NotImplemented\n");
  state.guest("guest", owner);
  expect(() => state.run("result=~guest\n")).toThrow("execution cancelled");
  expect(state.globals.has("result")).toBe(false);
});

it.each([false, true])("dispatches inherited compiled divmod methods (reflected=%s)", reflected => {
  const state = fixture(), base = state.type("Base"), owner = state.type("Derived", base), v = state.v;
  state.globals.set("divmod", createDivmodBuiltin(v, state.meter));
  state.method(base, reflected ? "__rdivmod__" : "__divmod__", "def operation(self, other):\n visit('divmod')\n return other\n");
  state.guest("guest", owner);
  state.run(`def calculate():\n return divmod(${reflected ? "7, guest" : "guest, 7"})\nresult=calculate()\n`);
  expect(state.globals.get("result")).toEqual(v.integer(7)); expect(state.events).toEqual(["divmod"]);
});

it.each(["__divmod__", "__rdivmod__"])("rejects disabled %s methods", name => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.globals.set("divmod", createDivmodBuiltin(v, state.meter));
  owner.value.namespace.items.set(v.string(name), v.none); state.guest("guest", owner);
  expect(() => state.run(`result=divmod(${name === "__divmod__" ? "guest, 7" : "7, guest"})\n`)).toThrow("'NoneType' object is not callable");
});

it("reports guest divmod types without falling back to floor division or modulo", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.globals.set("divmod", createDivmodBuiltin(v, state.meter));
  for (const name of ["__floordiv__", "__mod__", "__index__"]) state.method(owner, name, "def operation(self, other=None):\n visit('wrong')\n return 2\n");
  state.guest("guest", owner);
  expect(() => state.run("result=divmod(guest, 7)\n")).toThrow("unsupported operand type(s) for divmod(): 'Guest' and 'int'");
  expect(state.events).toEqual([]);
});

it.each([false, true])("orders subtype divmod reflection by override status (%s)", overridden => {
  const state = fixture(), base = state.type("Base"), derived = state.type("Derived", base), v = state.v;
  state.globals.set("divmod", createDivmodBuiltin(v, state.meter));
  state.method(base, "__divmod__", "def operation(self, other):\n visit('forward')\n return 1\n");
  state.method(base, "__rdivmod__", "def operation(self, other):\n visit('inherited')\n return 2\n");
  if (overridden) state.method(derived, "__rdivmod__", "def operation(self, other):\n visit('override')\n return 3\n");
  state.guest("left", base); state.guest("right", derived); state.run("result=divmod(left, right)\n");
  expect(state.globals.get("result")).toEqual(v.integer(overridden ? 3 : 1)); expect(state.events).toEqual([overridden ? "override" : "forward"]);
});

it.each(["None", "False"])("reflects declined divmod and accepts %s", result => {
  const state = fixture(), left = state.type("Left"), right = state.type("Right"), v = state.v;
  state.globals.set("divmod", createDivmodBuiltin(v, state.meter));
  state.method(left, "__divmod__", "def operation(self, other):\n visit('forward')\n return NotImplemented\n");
  state.method(right, "__rdivmod__", `def operation(self, other):\n visit('reflected')\n return ${result}\n`);
  state.guest("left", left); state.guest("right", right); state.run("result=divmod(left, right)\n");
  expect(state.globals.get("result")).toBe(result === "None" ? v.none : v.false); expect(state.events).toEqual(["forward", "reflected"]);
});

it("does not reflect same-type declined divmod", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.globals.set("divmod", createDivmodBuiltin(v, state.meter));
  state.method(owner, "__divmod__", "def operation(self, other):\n visit('forward')\n return NotImplemented\n");
  state.method(owner, "__rdivmod__", "def operation(self, other):\n visit('reflected')\n return False\n");
  state.guest("left", owner); state.guest("right", owner);
  expect(() => state.run("result=divmod(left, right)\n")).toThrow("unsupported operand type(s) for divmod(): 'Guest' and 'Guest'");
  expect(state.events).toEqual(["forward"]);
});

it("uses explicit frame numeric policy with its original receiver for divmod", () => {
  const state = fixture(), owner = state.type("Guest"), guest = state.guest("guest", owner), v = state.v;
  state.globals.set("divmod", createDivmodBuiltin(v, state.meter));
  state.hooks.specialMethods = () => ({ typeOf(): never { throw Error("explicit numeric policy must win"); }, slots: () => undefined });
  const bindings = { warn() {}, numeric(operator: string, left: RuntimeValue, right: RuntimeValue) {
    expect(this).toBe(bindings); expect(operator).toBe("divmod()"); expect(left).toBe(guest); expect(right).toEqual(v.integer(7));
    return { numeric: { relation: "other" as const, notImplemented: v.notImplemented, reflectedIsOverridden: () => false, forward: () => v.none, reflected: () => v.notImplemented } };
  } };
  state.hooks.expressions = () => bindings; state.run("result=divmod(guest, 7)\n"); expect(state.globals.get("result")).toBe(v.none);
});

it("retains explicit builtin divmod policies including an intentionally empty policy", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.guest("guest", owner);
  state.hooks.expressions = () => ({ warn() {}, numeric(): never { throw Error("builtin policy must win"); } });
  const policy = { numeric() {
    expect(this).toBe(policy);
    return { relation: "other" as const, notImplemented: v.notImplemented, reflectedIsOverridden: () => false, forward: () => v.false, reflected: () => v.notImplemented };
  } };
  state.globals.set("divmod", createDivmodBuiltin(v, state.meter, policy)); state.run("result=divmod(guest, 7)\n");
  expect(state.globals.get("result")).toBe(v.false);
  state.globals.set("divmod", createDivmodBuiltin(v, state.meter, {}));
  expect(() => state.run("result=divmod(guest, 7)\n")).toThrow("unsupported operand type(s) for divmod(): 'cell' and 'int'");
});

it("validates divmod arguments before preparing numeric slots", () => {
  const state = fixture(); state.globals.set("divmod", createDivmodBuiltin(state.v, state.meter));
  state.hooks.expressions = () => ({ warn() {}, numeric(): never { throw Error("invalid arguments must not dispatch"); } });
  expect(() => state.run("result=divmod(1)\n")).toThrow("divmod expected 2 arguments, got 1");
  expect(() => state.run("result=divmod(a=1, b=2)\n")).toThrow("divmod() takes no keyword arguments");
});

it("rejects cancelled compiled divmod before assigning its result", () => {
  const controller = new AbortController(), state = fixture(controller.signal), owner = state.type("Guest");
  state.globals.set("divmod", createDivmodBuiltin(state.v, state.meter));
  state.globals.set("stop", state.v.builtinFunction({ name: "stop", invoke() { controller.abort(); return state.v.none; } }));
  state.method(owner, "__divmod__", "def operation(self, other):\n stop()\n return False\n");
  state.guest("guest", owner);
  expect(() => state.run("result=divmod(guest, 7)\n")).toThrow("execution cancelled");
  expect(state.globals.has("result")).toBe(false);
});

it("keeps native divmod off the guest type policy", () => {
  const state = fixture(), v = state.v; state.globals.set("divmod", createDivmodBuiltin(v, state.meter));
  state.run("result=divmod(-7, 3)\n"); expect(state.globals.get("result")).toEqual(v.tuple([v.integer(-3), v.integer(2)]));
});

it.each([
  ["==", "__eq__", "__eq__"], ["!=", "__ne__", "__ne__"],
  ["<", "__lt__", "__gt__"], ["<=", "__le__", "__ge__"], [">", "__gt__", "__lt__"], [">=", "__ge__", "__le__"]
])("dispatches inherited rich %s methods in both operand orders", (operator, forward, reflected) => {
  for (const reverse of [false, true]) {
    const state = fixture(), base = state.type("Base"), derived = state.type("Derived", base), name = reverse ? reflected : forward;
    state.method(base, name, "def compare(self, other):\n visit('compare')\n return None\n");
    state.guest("guest", derived);
    state.run(`def calculate():\n return ${reverse ? `7 ${operator} guest` : `guest ${operator} 7`}\nresult=calculate()\n`);
    expect(state.globals.get("result")).toBe(state.v.none); expect(state.events).toEqual(["compare"]);
  }
});

it("tries inherited reflected comparison first for a strict subtype", () => {
  const state = fixture(), base = state.type("Base"), derived = state.type("Derived", base);
  state.method(base, "__lt__", "def compare(self, other):\n visit('forward')\n return True\n");
  state.method(base, "__gt__", "def compare(self, other):\n visit('reflected')\n return False\n");
  state.guest("left", base); state.guest("right", derived); state.run("result=left<right\n");
  expect(state.globals.get("result")).toBe(state.v.false); expect(state.events).toEqual(["reflected"]);
});

it("delegates absent inequality to the receiver's equality method", () => {
  const state = fixture(), owner = state.type("Guest");
  state.method(owner, "__eq__", "def compare(self, other):\n visit('equal')\n return False\n");
  state.guest("guest", owner); state.run("result=guest!=7\n");
  expect(state.globals.get("result")).toBe(state.v.true); expect(state.events).toEqual(["equal"]);
});

it("tries both same-type equality slots before identity fallback", () => {
  const state = fixture(), owner = state.type("Guest");
  state.method(owner, "__eq__", "def compare(self, other):\n visit('equal')\n return NotImplemented\n");
  state.guest("guest", owner); state.run("result=guest==guest\n");
  expect(state.globals.get("result")).toBe(state.v.true); expect(state.events).toEqual(["equal", "equal"]);
});

it.each([["==", "__eq__"], ["!=", "__ne__"], ["<", "__lt__"], ["<=", "__le__"], [">", "__gt__"], [">=", "__ge__"]])("does not ignore disabled rich %s methods", (operator, name) => {
  const state = fixture(), owner = state.type("Guest");
  owner.value.namespace.items.set(state.v.string(name), state.v.none); state.guest("guest", owner);
  expect(() => state.run(`result=guest ${operator} 7\n`)).toThrow("'NoneType' object is not callable");
});

it("truth-converts only default inequality delegation, not explicit comparison results", () => {
  const state = fixture(), owner = state.type("Guest"), resultType = state.type("Result");
  state.method(resultType, "__bool__", "def truth(self):\n visit('truth')\n return True\n");
  const result = state.guest("answer", resultType);
  state.method(owner, "__eq__", "def equal(self, other):\n visit('equal')\n return answer\n");
  state.guest("guest", owner); state.run("equal=guest==7\nunequal=guest!=7\n");
  expect(state.globals.get("equal")).toBe(result); expect(state.globals.get("unequal")).toBe(state.v.false);
  expect(state.events).toEqual(["equal", "equal", "truth"]);
  state.method(owner, "__ne__", "def unequal(self, other):\n visit('unequal')\n return answer\n");
  state.run("explicit=guest!=7\n"); expect(state.globals.get("explicit")).toBe(result);
  expect(state.events).toEqual(["equal", "equal", "truth", "unequal"]);
});

it("reflects default inequality when delegated equality declines", () => {
  const state = fixture(), left = state.type("Left"), right = state.type("Right");
  state.method(left, "__eq__", "def equal(self, other):\n visit('equal')\n return NotImplemented\n");
  state.method(right, "__ne__", "def unequal(self, other):\n visit('reflected')\n return False\n");
  state.guest("left", left); state.guest("right", right); state.run("result=left!=right\n");
  expect(state.globals.get("result")).toBe(state.v.false); expect(state.events).toEqual(["equal", "reflected"]);
});

it.each(["==", "<"])("dispatches guest methods inside native list %s", operator => {
  const state = fixture(), owner = state.type("Guest");
  state.method(owner, "__eq__", "def equal(self, other):\n visit('equal')\n return False\n");
  state.method(owner, "__lt__", "def less(self, other):\n visit('less')\n return None\n");
  state.guest("guest", owner); state.run(`result=[guest] ${operator} [7]\n`);
  expect(state.globals.get("result")).toBe(operator === "==" ? state.v.false : state.v.none);
  expect(state.events).toEqual(operator === "==" ? ["equal"] : ["equal", "less"]);
});

it.each([false, true])("retains raw mapping proxy comparison delegation (reverse=%s)", reverse => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.method(owner, "__eq__", "def equal(self, other):\n visit('equal')\n if other is target:\n  return None\n return NotImplemented\n");
  state.guest("guest", owner);
  const dictionary = v.dictionary(new OrderedKeyMap({ hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => a === b }, state.meter));
  state.globals.set("target", dictionary); state.globals.set("proxy", v.mappingProxy(dictionary));
  state.run(`result=${reverse ? "guest==proxy" : "proxy==guest"}\n`);
  expect(state.globals.get("result")).toBe(v.none); expect(state.events).toEqual(reverse ? ["equal", "equal"] : ["equal"]);
});

it("resolves reflected methods live after a forward comparison mutates the type", () => {
  const state = fixture(), left = state.type("Left"), right = state.type("Right"), v = state.v;
  const replacement = state.method(right, "__eq__", "def equal(self, other):\n visit('new')\n return False\n");
  state.method(right, "__eq__", "def equal(self, other):\n visit('old')\n return True\n");
  state.globals.set("mutate", v.builtinFunction({ name: "mutate", invoke() { right.value.namespace.items.set(v.string("__eq__"), replacement); return v.none; } }));
  state.method(left, "__eq__", "def equal(self, other):\n visit('forward')\n mutate()\n return NotImplemented\n");
  state.guest("left", left); state.guest("right", right); state.run("result=left==right\n");
  expect(state.globals.get("result")).toBe(v.false); expect(state.events).toEqual(["forward", "new"]);
});

it("tries a declined subtype reflection only once", () => {
  const state = fixture(), base = state.type("Base"), derived = state.type("Derived", base);
  state.method(base, "__lt__", "def less(self, other):\n visit('forward')\n return False\n");
  state.method(base, "__gt__", "def greater(self, other):\n visit('reflected')\n return NotImplemented\n");
  state.guest("left", base); state.guest("right", derived); state.run("result=left<right\n");
  expect(state.globals.get("result")).toBe(state.v.false); expect(state.events).toEqual(["reflected", "forward"]);
});

it("reports actual guest types after both ordering slots decline", () => {
  const state = fixture(), owner = state.type("Guest"); state.guest("guest", owner);
  expect(() => state.run("result=guest<7\n")).toThrow("'<' not supported between instances of 'Guest' and 'int'");
});

it("rejects cancelled compiled comparisons without assigning results", () => {
  const controller = new AbortController(), state = fixture(controller.signal), owner = state.type("Guest");
  state.globals.set("stop", state.v.builtinFunction({ name: "stop", invoke() { controller.abort(); return state.v.none; } }));
  state.method(owner, "__eq__", "def equal(self, other):\n stop()\n return False\n");
  state.guest("guest", owner);
  expect(() => state.run("result=guest==7\n")).toThrow("execution cancelled"); expect(state.globals.has("result")).toBe(false);
});

it("iterates inherited compiled methods in a nested frame", () => {
  const state = fixture(), base = state.type("Base"), owner = state.type("Derived", base), cursorType = state.type("Cursor"), v = state.v;
  state.method(base, "__iter__", "def iterate(self):\n visit('iter')\n return cursor\n");
  state.method(cursorType, "__next__", "def advance(self):\n visit('next')\n return pull()\n");
  let index = 0;
  state.globals.set("pull", v.builtinFunction({ name: "pull", invoke() { if (index === 2) throw new PythonRuntimeError("StopIteration", "done"); return v.integer(++index); } }));
  state.guest("source", owner); state.guest("cursor", cursorType);
  state.run("def collect():\n result=[]\n for item in source:\n  result += [item]\n return result\nresult=collect()\n");
  const result = state.globals.get("result"); expect(result?.kind).toBe("list");
  if (result?.kind === "list") expect(result.items.snapshot()).toEqual([v.integer(1), v.integer(2)]);
  expect(state.events).toEqual(["iter", "next", "next", "next"]);
});

it("shares guest iterator identity with iter and next builtins", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.globals.set("iter", createIterBuiltin(v, state.meter)); state.globals.set("next", createNextBuiltin(v, state.meter));
  state.method(owner, "__iter__", "def iterate(self):\n return self\n");
  state.method(owner, "__next__", "def advance(self):\n return False\n");
  const guest = state.guest("guest", owner); state.run("cursor=iter(guest)\nresult=next(cursor)\n");
  expect(state.globals.get("cursor")).toBe(guest); expect(state.globals.get("result")).toBe(v.false);
});

it("uses compiled indexed fallback when __iter__ is absent", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.method(owner, "__getitem__", "def item(self, index):\n visit('item')\n return fetch(index)\n");
  state.globals.set("fetch", v.builtinFunction({ name: "fetch", invoke(args) { if (args[0].kind !== "int") throw Error("expected index"); if (args[0].value === 2n) throw new PythonRuntimeError("IndexError", "end"); return args[0]; } }));
  state.guest("guest", owner); state.run("result=[]\nfor item in guest:\n result += [item]\n");
  const result = state.globals.get("result"); expect(result?.kind).toBe("list");
  if (result?.kind === "list") expect(result.items.snapshot()).toEqual([v.integer(0), v.integer(1)]);
  expect(state.events).toEqual(["item", "item", "item"]);
});

it("rejects disabled iteration before indexed fallback", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.globals.set("iter", createIterBuiltin(v, state.meter));
  owner.value.namespace.items.set(v.string("__iter__"), v.none);
  state.method(owner, "__getitem__", "def item(self, index):\n visit('item')\n return False\n");
  state.guest("guest", owner);
  expect(() => state.run("result=iter(guest)\n")).toThrow("'Guest' object is not iterable"); expect(state.events).toEqual([]);
});

it("rejects a guest __iter__ returning a non-iterator", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.globals.set("iter", createIterBuiltin(v, state.meter));
  state.method(owner, "__iter__", "def iterate(self):\n return []\n"); state.guest("guest", owner);
  expect(() => state.run("result=iter(guest)\n")).toThrow("iter() returned non-iterator of type 'list'");
});

it("accepts native cursors returned by guest iterators and preserves exhaustion metadata", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v, stop = new PythonRuntimeError("StopIteration", "payload");
  state.globals.set("iter", createIterBuiltin(v, state.meter)); state.globals.set("next", createNextBuiltin(v, state.meter));
  const cursor = v.iterator({ next: () => ({ done: true, value: undefined, exception: { value: stop } }) });
  state.globals.set("native", cursor); state.method(owner, "__iter__", "def iterate(self):\n return native\n"); state.guest("guest", owner);
  state.run("cursor=iter(guest)\n"); expect(state.globals.get("cursor")).toBe(cursor);
  expect(() => state.run("next(cursor)\n")).toThrow(stop);
  state.run("result=next(cursor, False)\n"); expect(state.globals.get("result")).toBe(v.false);
});

it("unpacks guest iterables into function arguments", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.globals.set("native", v.iterator([v.integer(2), v.integer(3)].values()));
  state.method(owner, "__iter__", "def iterate(self):\n visit('iter')\n return native\n"); state.guest("guest", owner);
  state.run("def add(a,b):\n return a+b\nresult=add(*guest)\n"); expect(state.globals.get("result")).toEqual(v.integer(5)); expect(state.events).toEqual(["iter"]);
});

it("requests source hints for list extension only after acquiring its iterator", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.globals.set("native", v.iterator([v.false].values()));
  state.method(owner, "__iter__", "def iterate(self):\n visit('iter')\n return native\n");
  state.method(owner, "__length_hint__", "def hint(self):\n visit('hint')\n return 2\n"); state.guest("guest", owner);
  state.run("result=[]\nresult+=guest\n");
  const result = state.globals.get("result"); if (result?.kind !== "list") throw Error("expected list");
  expect(result.items.snapshot()).toEqual([v.false]); expect(state.events).toEqual(["iter", "hint"]);
});

it("does not request hints or close an iterator when a for loop breaks", () => {
  const state = fixture(), owner = state.type("Guest");
  state.method(owner, "__iter__", "def iterate(self):\n visit('iter')\n return self\n");
  state.method(owner, "__next__", "def advance(self):\n visit('next')\n return False\n");
  state.method(owner, "__len__", "def length(self):\n visit('length')\n return 1\n");
  state.method(owner, "__length_hint__", "def hint(self):\n visit('hint')\n return 1\n");
  state.method(owner, "close", "def close(self):\n visit('close')\n"); state.guest("guest", owner);
  state.run("for result in guest:\n break\n"); expect(state.globals.get("result")).toBe(state.v.false); expect(state.events).toEqual(["iter", "next"]);
});

it("accepts next-slot presence but fails when a disabled next method is called", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.globals.set("iter", createIterBuiltin(v, state.meter)); state.globals.set("next", createNextBuiltin(v, state.meter));
  state.method(owner, "__iter__", "def iterate(self):\n return self\n"); owner.value.namespace.items.set(v.string("__next__"), v.none);
  const guest = state.guest("guest", owner); state.run("cursor=iter(guest)\n"); expect(state.globals.get("cursor")).toBe(guest);
  expect(() => state.run("next(cursor)\n")).toThrow("'NoneType' object is not callable");
});

it("does not latch exhaustion for custom guest next methods", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.globals.set("next", createNextBuiltin(v, state.meter));
  state.globals.set("stop", v.builtinFunction({ name: "stop", invoke() { throw new PythonRuntimeError("StopIteration", "done"); } }));
  state.method(owner, "__next__", "def advance(self):\n visit('next')\n return stop()\n"); state.guest("guest", owner);
  state.run("first=next(guest, False)\nsecond=next(guest, None)\n");
  expect(state.globals.get("first")).toBe(v.false); expect(state.globals.get("second")).toBe(v.none); expect(state.events).toEqual(["next", "next"]);
});

it("requires sequence-table eligibility for legacy indexed iteration", () => {
  const state = fixture(), owner = state.type("NativeLike", undefined, { sequenceTable: false }), v = state.v;
  state.globals.set("iter", createIterBuiltin(v, state.meter));
  state.method(owner, "__getitem__", "def item(self,index):\n visit('item')\n return False\n"); state.guest("guest", owner);
  expect(() => state.run("iter(guest)\n")).toThrow("'NativeLike' object is not iterable"); expect(state.events).toEqual([]);
});

it("retains native invalid-iteration diagnostics without guest type lookup", () => {
  const state = fixture(), v = state.v;
  state.globals.set("iter", createIterBuiltin(v, state.meter)); state.globals.set("next", createNextBuiltin(v, state.meter));
  expect(() => state.run("iter(7)\n")).toThrow("'int' object is not iterable");
  expect(() => state.run("next(None)\n")).toThrow("'NoneType' object is not an iterator");
});

it("rejects cancellation after guest iterator acquisition before advancing", () => {
  const controller = new AbortController(), state = fixture(controller.signal), owner = state.type("Guest"), v = state.v;
  state.globals.set("stop", v.builtinFunction({ name: "stop", invoke() { controller.abort(); return v.none; } }));
  state.globals.set("native", v.iterator({ next(): never { throw Error("must not advance"); } }));
  state.method(owner, "__iter__", "def iterate(self):\n stop()\n return native\n"); state.guest("guest", owner);
  expect(() => state.run("for result in guest:\n pass\n")).toThrow("execution cancelled"); expect(state.globals.has("result")).toBe(false);
});

it("ignores a native non-index length result before trying an advisory hint", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.globals.set("native", v.iterator([v.false].values()));
  state.method(owner, "__iter__", "def iterate(self):\n visit('iter')\n return native\n");
  state.method(owner, "__len__", "def length(self):\n visit('length')\n return 1.5\n");
  state.method(owner, "__length_hint__", "def hint(self):\n visit('hint')\n return 2\n"); state.guest("guest", owner);
  state.run("result=[]\nresult+=guest\n");
  const result = state.globals.get("result"); if (result?.kind !== "list") throw Error("expected list");
  expect(result.items.snapshot()).toEqual([v.false]); expect(state.events).toEqual(["iter", "length", "hint"]);
});

it.each(["for", "next"])("reports live removal of __next__ during %s consumption", consumer => {
  const state = fixture(), owner = state.type("Cursor"), v = state.v;
  state.globals.set("next", createNextBuiltin(v, state.meter));
  state.globals.set("remove", v.builtinFunction({ name: "remove", invoke() { owner.value.namespace.items.delete(v.string("__next__")); return v.none; } }));
  state.method(owner, "__iter__", "def iterate(self):\n return self\n");
  state.method(owner, "__next__", "def advance(self):\n remove()\n return False\n"); state.guest("guest", owner);
  expect(() => state.run(consumer === "for" ? "for result in guest:\n pass\n" : "result=next(guest)\nnext(guest)\n")).toThrow(
    consumer === "for" ? "'Cursor' object is not iterable" : "'Cursor' object is not an iterator"
  );
  expect(state.globals.get("result")).toBe(v.false);
});

it.each(["in", "not in"])("dispatches inherited contains methods for %s", operator => {
  const state = fixture(), base = state.type("Base"), owner = state.type("Derived", base);
  state.method(base, "__contains__", "def contains(self, needle):\n visit('contains')\n return None\n"); state.guest("guest", owner);
  state.run(`def contains():\n return 7 ${operator} guest\nresult=contains()\n`);
  expect(state.globals.get("result")).toBe(operator === "in" ? state.v.false : state.v.true); expect(state.events).toEqual(["contains"]);
});

it("does not treat NotImplemented containment results as an iteration fallback", () => {
  const state = fixture(), owner = state.type("Guest");
  state.method(owner, "__contains__", "def contains(self, needle):\n visit('contains')\n return NotImplemented\n");
  state.method(owner, "__iter__", "def iterate(self):\n visit('iter')\n return self\n"); state.guest("guest", owner);
  expect(() => state.run("result=7 in guest\n")).toThrow("NotImplemented should not be used in a boolean context"); expect(state.events).toEqual(["contains"]);
});

it("rejects disabled containment before iteration", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  owner.value.namespace.items.set(v.string("__contains__"), v.none);
  state.method(owner, "__iter__", "def iterate(self):\n visit('iter')\n return self\n"); state.guest("guest", owner);
  expect(() => state.run("result=7 in guest\n")).toThrow("'Guest' object is not a container"); expect(state.events).toEqual([]);
});

it("falls back to inherited iteration when contains is absent", () => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.globals.set("native", v.iterator([v.integer(1), v.integer(2)].values()));
  state.method(owner, "__iter__", "def iterate(self):\n visit('iter')\n return native\n"); state.guest("guest", owner);
  state.run("result=2 in guest\n"); expect(state.globals.get("result")).toBe(v.true); expect(state.events).toEqual(["iter"]);
});

it("truth-converts a guest contains result before negating not-in", () => {
  const state = fixture(), owner = state.type("Guest"), answerType = state.type("Answer");
  state.method(answerType, "__bool__", "def truth(self):\n visit('truth')\n return False\n"); state.guest("answer", answerType);
  state.method(owner, "__contains__", "def contains(self, needle):\n visit('contains')\n return answer\n"); state.guest("guest", owner);
  state.run("result=7 not in guest\n"); expect(state.globals.get("result")).toBe(state.v.true); expect(state.events).toEqual(["contains", "truth"]);
});

it("does not ignore noncallable contains methods", () => {
  const state = fixture(), owner = state.type("Guest"); owner.value.namespace.items.set(state.v.string("__contains__"), state.v.false); state.guest("guest", owner);
  expect(() => state.run("result=7 in guest\n")).toThrow("'bool' object is not callable");
});

it.each([false, true])("uses member-first equality and skips it for identity (identical=%s)", identical => {
  const state = fixture(), owner = state.type("Source"), memberType = state.type("Member"), needleType = state.type("Needle"), v = state.v;
  state.method(memberType, "__eq__", "def equal(self, other):\n visit('member')\n return False\n");
  state.method(needleType, "__eq__", "def equal(self, other):\n visit('needle')\n return True\n");
  const member = state.guest("member", memberType); state.guest("needle", needleType);
  if (identical) state.globals.set("needle", member);
  state.globals.set("native", v.iterator([member].values()));
  state.method(owner, "__iter__", "def iterate(self):\n visit('iter')\n return native\n");
  state.method(owner, "__length_hint__", "def hint(self):\n visit('hint')\n return 1\n"); state.guest("source", owner);
  state.run("result=needle in source\n"); expect(state.globals.get("result")).toBe(identical ? v.true : v.false);
  expect(state.events).toEqual(identical ? ["iter"] : ["iter", "member"]);
});

it("searches indexed fallback only through the first match", () => {
  const state = fixture(), owner = state.type("Guest");
  state.method(owner, "__getitem__", "def item(self, index):\n visit('item')\n return index\n");
  state.method(owner, "__len__", "def length(self):\n visit('length')\n return 20\n"); state.guest("guest", owner);
  state.run("result=1 in guest\n"); expect(state.globals.get("result")).toBe(state.v.true); expect(state.events).toEqual(["item", "item"]);
});

it.each(["acquire", "next"])("rewrites only iterator-acquisition TypeErrors (%s)", phase => {
  const state = fixture(), owner = state.type("Guest"), v = state.v;
  state.globals.set("fail", v.builtinFunction({ name: "fail", invoke(): never { throw new PythonRuntimeError("TypeError", "broken"); } }));
  state.method(owner, "__iter__", phase === "acquire" ? "def iterate(self):\n return fail()\n" : "def iterate(self):\n return self\n");
  state.method(owner, "__next__", "def advance(self):\n return fail()\n"); state.guest("guest", owner);
  expect(() => state.run("result=7 in guest\n")).toThrow(phase === "acquire" ? "argument of type 'Guest' is not a container or iterable" : "broken");
});

it("preserves explicit iteration receivers without reading hints for containment", () => {
  const state = fixture(), owner = state.type("Guest"), guest = state.guest("guest", owner), v = state.v, cursor = v.cell({});
  const iteration = {
    get hints(): never { throw Error("containment must not request hints"); },
    lookupIter(value: RuntimeValue) { expect(this).toBe(iteration); expect(value).toBe(guest); return () => cursor; },
    hasNext(value: RuntimeValue) { expect(this).toBe(iteration); expect(value).toBe(cursor); return true; },
    next(value: RuntimeValue) { expect(this).toBe(iteration); expect(value).toBe(cursor); return v.integer(7); },
    hasSequenceItem: () => false, getItem: () => v.none,
    isStopIteration: () => false, isIndexError: () => false, typeName: () => "Guest"
  };
  state.hooks.expressions = () => ({ warn() {}, iteration }); state.run("result=7 in guest\n"); expect(state.globals.get("result")).toBe(v.true);
});

it("retains explicit containment selection ahead of automatic MRO dispatch", () => {
  const state = fixture(), owner = state.type("Guest"); state.guest("guest", owner);
  state.hooks.specialMethods = () => ({ typeOf(): never { throw Error("explicit containment must win"); }, slots: () => undefined });
  const bindings = { warn() {}, containment(value: RuntimeValue) { expect(this).toBe(bindings); expect(value).toBe(state.globals.get("guest")); return undefined; } };
  state.hooks.expressions = () => bindings;
  expect(() => state.run("result=7 in guest\n")).toThrow("argument of type 'cell' is not a container or iterable");
});

it("rejects cancelled contains methods before assigning results", () => {
  const controller = new AbortController(), state = fixture(controller.signal), owner = state.type("Guest");
  state.globals.set("stop", state.v.builtinFunction({ name: "stop", invoke() { controller.abort(); return state.v.none; } }));
  state.method(owner, "__contains__", "def contains(self, needle):\n stop()\n return False\n"); state.guest("guest", owner);
  expect(() => state.run("result=7 in guest\n")).toThrow("execution cancelled"); expect(state.globals.has("result")).toBe(false);
});

it.each(["for", "contains"])("preserves already-classified native exhaustion during guest %s consumption", consumer => {
  for (const failure of [{ kind: "GuestStop" }, undefined]) {
    const state = fixture(), owner = state.type("Guest"), v = state.v;
    state.globals.set("native", v.iterator({ next: () => ({ done: true, value: undefined, exception: { value: failure } }) }));
    state.method(owner, "__iter__", "def iterate(self):\n return native\n"); state.guest("guest", owner);
    state.run(consumer === "for" ? "result=False\nfor item in guest:\n result=True\n" : "result=1 in guest\n");
    expect(state.globals.get("result")).toBe(v.false);
    state.globals.set("next", createNextBuiltin(v, state.meter));
    let caught = false, error: unknown;
    try { state.run("next(native)\n"); } catch (failure) { caught = true; error = failure; }
    expect(caught).toBe(true); expect(error).toBe(failure);
  }
});

it.each([false, true])("exposes legacy cursor hints with source length present=%s", sized => {
  const state = fixture(), owner = state.type("Sequence"), v = state.v;
  state.method(owner, "__getitem__", "def item(self, index):\n return index\n");
  if (sized) state.method(owner, "__len__", "def length(self):\n return 3\n");
  state.guest("guest", owner); state.globals.set("iter", createIterBuiltin(v, state.meter)); state.globals.set("next", createNextBuiltin(v, state.meter));
  state.run("cursor=iter(guest)\nbefore=cursor.__length_hint__()\nnext(cursor)\nafter=cursor.__length_hint__()\n");
  expect(state.globals.get("before")).toEqual(sized ? v.integer(3) : v.notImplemented);
  expect(state.globals.get("after")).toEqual(sized ? v.integer(2) : v.notImplemented);
});

it.each(["result=[]\nresult.extend(cursor)\n", "result=''.join(cursor)\n", "result=[]\nresult[:]=cursor\n", "*result,=cursor\n", "def collect(*args):\n return args\nresult=collect(0,*cursor)\n"])("validates native cursor hints before consumption: %s", source => {
  for (const hint of [-1n, 1n << 70n]) {
    const state = fixture(); let hints = 0, pulls = 0;
    state.globals.set("cursor", state.v.iterator({ lengthHint() { hints++; return hint; }, next() { pulls++; return { done: true, value: undefined }; } }));
    expect(() => state.run(source)).toThrow(hint < 0n ? "__length_hint__() should return >= 0" : "Python int too large to convert to C ssize_t");
    expect(hints).toBe(1); expect(pulls).toBe(0);
  }
});

it.each(["for item in cursor:\n pass\n", "def collect(*args):\n return args\nresult=collect(*cursor)\n", "a,b=cursor\n"])("does not request native hints for streaming consumption: %s", source => {
  const state = fixture(); let pulls = 0;
  state.globals.set("cursor", state.v.iterator({ lengthHint(): never { throw Error("must not request hint"); }, next() { return ++pulls <= 2 ? { done: false, value: state.v.true } : { done: true, value: undefined }; } }));
  state.run(source); expect(pulls).toBe(3);
});

it("requests a native remainder hint only after the unpacking prefix", () => {
  const state = fixture(), events: string[] = [];
  state.globals.set("cursor", state.v.iterator({ lengthHint() { events.push("hint"); return -1n; }, next() { events.push("next"); return { done: false, value: state.v.true }; } }));
  expect(() => state.run("head,*tail=cursor\n")).toThrow("__length_hint__() should return >= 0");
  expect(events).toEqual(["next", "hint"]);
});

it.each(["result=[]\nresult.extend(source)\n", "result=sorted(source)\n", "result=[*source]\n", "result=(*source,)\n", "def collect(*args):\n return args\nresult=collect(0,*source)\n"])("rejects source range length overflow before collection: %s", source => {
  const state = fixture();
  state.globals.set("source", state.v.range(createRange(0n, 1n << 70n)));
  state.globals.set("sorted", createSortedBuiltin(state.v, state.meter));
  expect(() => state.run(source)).toThrow("Python int too large to convert to C ssize_t");
});

it.each(["same", "subclass", "unrelated"])("executes compiled type allocation and %s initialization", relation => {
  const state = fixture(), owner = state.type("A"), child = state.type("B", owner), foreign = state.type("Other");
  const allocated = state.guest("allocated", relation === "same" ? owner : relation === "subclass" ? child : foreign);
  state.method(owner, "__new__", "def allocate(cls, x, *, flag):\n visit('new')\n return allocated\n");
  state.method(owner, "__init__", "def initialize(self, x, *, flag):\n visit('A.init')\n visit(flag)\n");
  state.method(child, "__init__", "def initialize(self, x, *, flag):\n visit('B.init')\n visit(flag)\n");
  state.globals.set("A", owner);
  state.run("result=A(7,flag='keyword')\n");
  expect(state.globals.get("result")).toBe(allocated);
  expect(state.events).toEqual(["new", ...(relation === "unrelated" ? [] : [relation === "same" ? "A.init" : "B.init", "keyword"])]);
});

it("honors inherited metaclass call overrides before allocating", () => {
  const state = fixture(), meta = state.type("Meta", state.registry.type), derivedMeta = state.type("DerivedMeta", meta), owner = state.type("C", undefined, {}, derivedMeta);
  const result = state.guest("allocated", owner);
  state.method(meta, "__call__", "def call(cls, *, flag):\n visit(flag)\n return allocated\n");
  state.method(owner, "__new__", "def allocate(cls):\n visit('must not allocate')\n return allocated\n");
  state.globals.set("C", owner); state.run("result=C(flag='meta')\n");
  expect(state.globals.get("result")).toBe(result); expect(state.events).toEqual(["meta"]);
});

it.each([false, true])("honors metaclass new lookup with getattr fallback=%s", fallback => {
  const state = fixture(), meta = state.type("Meta", state.registry.type), owner = state.type("C", undefined, {}, meta);
  const result = state.guest("allocated", owner);
  state.method(owner, "__new__", "def allocate(cls):\n visit('new')\n return allocated\n");
  state.globals.set("chosen", state.globals.get("allocate")!);
  state.globals.set("missing", state.v.builtinFunction({ name: "missing", invoke() { throw new PythonRuntimeError("AttributeError", "missing allocator"); } }));
  state.method(meta, "__getattribute__", fallback ? "def attribute(cls, name):\n visit('getattribute')\n return missing()\n" : "def attribute(cls, name):\n visit('getattribute')\n return chosen\n");
  if (fallback) state.method(meta, "__getattr__", "def fallback(cls, name):\n visit('getattr')\n return chosen\n");
  state.globals.set("C", owner); state.run("result=C()\n");
  expect(state.globals.get("result")).toBe(result); expect(state.events).toEqual(["getattribute", ...(fallback ? ["getattr"] : []), "new"]);
});

it.each(["__call__", "__new__", "__init__"])("rejects disabled %s slots", slot => {
  const state = fixture(), meta = state.type("Meta", state.registry.type), owner = state.type("C", undefined, {}, meta);
  state.guest("allocated", owner);
  state.method(owner, "__new__", "def allocate(cls):\n return allocated\n");
  (slot === "__call__" ? meta : owner).value.namespace.items.set(state.v.string(slot), state.v.none);
  state.globals.set("C", owner);
  expect(() => state.run("result=C()\n")).toThrow("'NoneType' object is not callable");
});

it("uses the actual result metaclass in bad initializer diagnostics", () => {
  const state = fixture(), owner = state.type("C"); state.guest("allocated", owner); state.globals.set("C", owner);
  state.method(owner, "__new__", "def allocate(cls):\n return allocated\n");
  state.method(owner, "__init__", "def initialize(self):\n return C\n");
  expect(() => state.run("result=C()\n")).toThrow("__init__() should return None, not 'type'");
});

it("bounds recursive type allocation without relying on a host stack overflow", () => {
  const state = fixture(), owner = state.type("C"); state.globals.set("C", owner);
  owner.value.namespace.items.set(state.v.string("__new__"), owner);
  expect(() => state.run("result=C()\n")).toThrow("maximum recursion depth exceeded");
});

it("lets metaclass data descriptors replace the allocator", () => {
  const state = fixture(), meta = state.type("Meta", state.registry.type), owner = state.type("C", undefined, {}, meta);
  const allocated = state.guest("allocated", owner);
  const allocator = state.method(owner, "__new__", "def allocate(cls):\n visit('new')\n return allocated\n");
  const descriptor = state.v.cell({}); meta.value.namespace.items.set(state.v.string("__new__"), descriptor);
  const original = state.hooks.specialMethods!;
  state.hooks.specialMethods = frame => ({ ...original(frame), slots(value) {
    return value === descriptor ? { get(instance, actual) { expect(instance).toBe(owner); expect(actual).toBe(meta); state.events.push("get"); return allocator; }, set() { throw Error("unused setter"); } } : undefined;
  } });
  state.globals.set("C", owner); state.run("result=C()\n");
  expect(state.globals.get("result")).toBe(allocated); expect(state.events).toEqual(["get", "new"]);
});

it("preserves explicit ordinary attribute policy during allocator lookup", () => {
  const state = fixture(), owner = state.type("C"), allocated = state.guest("allocated", owner);
  const allocator = state.method(owner, "__new__", "def allocate(cls):\n return allocated\n");
  const original = state.hooks.expressions;
  state.hooks.expressions = frame => ({ ...original(frame), attribute(receiver, name) { expect(receiver).toBe(owner); expect(name).toBe("__new__"); state.events.push("attribute"); return allocator; } });
  state.globals.set("C", owner); state.run("result=C()\n");
  expect(state.globals.get("result")).toBe(allocated); expect(state.events).toEqual(["attribute"]);
});

it("skips initialization for an unrelated native allocator result", () => {
  const state = fixture(), owner = state.type("C"), outside = state.v.integer(7);
  state.types.set(outside, state.type("int", undefined, { sequenceTable: false })); state.globals.set("outside", outside);
  state.method(owner, "__new__", "def allocate(cls):\n return outside\n");
  state.method(owner, "__init__", "def initialize(self):\n visit('must not initialize')\n");
  state.globals.set("C", owner); state.run("result=C()\n");
  expect(state.globals.get("result")).toBe(outside); expect(state.events).toEqual([]);
});

it.each(["new", "init", "meta"])("honors cancellation from compiled %s during construction", stage => {
  const controller = new AbortController(), state = fixture(controller.signal), meta = state.type("Meta", state.registry.type), owner = state.type("C", undefined, {}, meta);
  state.guest("allocated", owner);
  state.globals.set("stop", state.v.builtinFunction({ name: "stop", invoke() { controller.abort(); return state.v.none; } }));
  state.method(owner, "__new__", stage === "new" ? "def allocate(cls):\n stop()\n return allocated\n" : "def allocate(cls):\n return allocated\n");
  if (stage === "init") state.method(owner, "__init__", "def initialize(self):\n stop()\n");
  if (stage === "meta") state.method(meta, "__call__", "def call(cls):\n stop()\n return allocated\n");
  state.globals.set("C", owner);
  expect(() => state.run("result=C()\n")).toThrow("execution cancelled"); expect(state.globals.has("result")).toBe(false);
});

it("resolves the live initializer after allocation mutates its namespace", () => {
  const state = fixture(), owner = state.type("C"); state.guest("allocated", owner);
  const replacement = state.method(owner, "replacement", "def replacement(self):\n visit('replacement')\n");
  state.method(owner, "__init__", "def initialize(self):\n visit('old')\n");
  state.globals.set("mutate", state.v.builtinFunction({ name: "mutate", invoke() { owner.value.namespace.items.set(state.v.string("__init__"), replacement); return state.v.none; } }));
  state.method(owner, "__new__", "def allocate(cls):\n mutate()\n return allocated\n");
  state.globals.set("C", owner); state.run("result=C()\n"); expect(state.events).toEqual(["replacement"]);
});

it("reports types with no allocator as non-instantiable", () => {
  const state = fixture(); state.globals.set("C", state.type("C"));
  state.registry.object.value.namespace.items.delete(state.v.string("__new__"));
  expect(() => state.run("result=C()\n")).toThrow("cannot create 'C' instances");
});

it("uses instance-owned types for compiled construction and numeric methods", () => {
  const state = fixture(), owner = state.type("C"), allocated = state.v.instance(owner);
  state.globals.set("allocated", allocated); state.globals.set("C", owner);
  state.method(owner, "__new__", "def allocate(cls):\n return allocated\n");
  state.method(owner, "__init__", "def initialize(self):\n visit('init')\n");
  state.method(owner, "__add__", "def add(self, value):\n return value+2\n");
  state.run("instance=C()\nresult=instance+5\n");
  expect(state.globals.get("instance")).toBe(allocated); expect(state.globals.get("result")).toEqual(state.v.integer(7));
  expect(state.events).toEqual(["init"]);
});

it("uses instance-owned types for truth, comparison and indexed containment", () => {
  const state = fixture(), owner = state.type("Container"), instance = state.v.instance(owner);
  state.globals.set("instance", instance);
  state.method(owner, "__bool__", "def truth(self):\n return False\n");
  state.method(owner, "__eq__", "def equal(self, other):\n return True\n");
  state.method(owner, "__getitem__", "def item(self, index):\n return index\n");
  state.run("truth=not instance\nequal=instance==7\ncontains=2 in instance\n");
  expect(state.globals.get("truth")).toBe(state.v.true); expect(state.globals.get("equal")).toBe(state.v.true); expect(state.globals.get("contains")).toBe(state.v.true);
});

it("uses instance-owned types for unary, power and formatting", () => {
  const state = fixture(), owner = state.type("C"), instance = state.v.instance(owner);
  state.globals.set("instance", instance);
  state.method(owner, "__neg__", "def negative(self):\n return 3\n");
  state.method(owner, "__pow__", "def power(self, other):\n return other+1\n");
  state.method(owner, "__repr__", "def representation(self):\n return 'instance-repr'\n");
  state.run("negative=-instance\npower=instance**3\nrepresentation=repr(instance)\n");
  expect(state.globals.get("negative")).toEqual(state.v.integer(3)); expect(state.globals.get("power")).toEqual(state.v.integer(4));
  expect(state.globals.get("representation")).toEqual(state.v.string("instance-repr"));
});

it("executes compiled instance attribute initialization, reads, writes and deletion", () => {
  const state = fixture(), owner = state.type("C"), allocated = state.instance("allocated", owner);
  state.globals.set("C", owner);
  state.method(owner, "__new__", "def allocate(cls, value):\n return allocated\n");
  state.method(owner, "__init__", "def initialize(self, value):\n self.value=value\n");
  state.method(owner, "read", "def read(self):\n return self.value\n");
  state.run("instance=C(7)\nbefore=instance.read()\ninstance.value=9\nafter=instance.read()\ndel instance.value\n");
  expect(state.globals.get("before")).toEqual(state.v.integer(7)); expect(state.globals.get("after")).toEqual(state.v.integer(9));
  expect(allocated.dictionary!.items.size).toBe(0);
  expect(() => state.run("instance.value\n")).toThrow("'C' object has no attribute 'value'");
});

it.each([false, true])("runs inherited instance getattribute with getattr fallback=%s", fallback => {
  const state = fixture(), base = state.type("Base"), owner = state.type("C", base);
  state.instance("instance", owner);
  state.globals.set("missing", state.v.builtinFunction({ name: "missing", invoke() { throw new PythonRuntimeError("AttributeError", "missing"); } }));
  state.method(base, "__getattribute__", fallback ? "def attribute(self,name):\n visit('getattribute')\n return missing()\n" : "def attribute(self,name):\n visit('getattribute')\n return name\n");
  if (fallback) state.method(base, "__getattr__", "def fallback(self,name):\n visit('getattr')\n return name\n");
  state.run("result=instance.unknown\n");
  expect(state.globals.get("result")).toEqual(state.v.string("unknown")); expect(state.events).toEqual(["getattribute", ...(fallback ? ["getattr"] : [])]);
});

it("calls mutation overrides without pre-reading or storing their return values", () => {
  const state = fixture(), owner = state.type("C"), instance = state.instance("instance", owner);
  state.method(owner, "__getattribute__", "def read(self,name):\n visit('must not read')\n return None\n");
  state.method(owner, "__setattr__", "def set(self,name,value):\n visit(name)\n return 7\n");
  state.method(owner, "__delattr__", "def remove(self,name):\n visit(name)\n return False\n");
  state.run("instance.first=3\ndel instance.second\n");
  expect(state.events).toEqual(["first", "second"]); expect(instance.dictionary!.items.size).toBe(0);
});

it.each(["__getattribute__", "__getattr__", "__setattr__", "__delattr__"])("rejects disabled instance %s overrides", slot => {
  const state = fixture(), owner = state.type("C"); state.instance("instance", owner);
  owner.value.namespace.items.set(state.v.string(slot), state.v.none);
  const source = slot === "__setattr__" ? "instance.x=1\n" : slot === "__delattr__" ? "del instance.x\n" : "instance.x\n";
  expect(() => state.run(source)).toThrow("'NoneType' object is not callable");
});

it("shares instance attributes between builtins and attribute syntax", () => {
  const state = fixture(), owner = state.type("C"); state.instance("instance", owner);
  state.globals.set("setattr", createAttributeMutationBuiltin("setattr", state.v, state.meter));
  state.globals.set("delattr", createAttributeMutationBuiltin("delattr", state.v, state.meter));
  state.globals.set("getattr", createAttributeLookupBuiltin("getattr", state.v, state.meter));
  state.globals.set("hasattr", createAttributeLookupBuiltin("hasattr", state.v, state.meter));
  state.run("setattr(instance,'value',7)\nresult=instance.value\nread=getattr(instance,'value')\ndelattr(instance,'value')\npresent=hasattr(instance,'value')\nfallback=getattr(instance,'value',9)\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(7));
  expect(state.globals.get("read")).toEqual(state.v.integer(7)); expect(state.globals.get("present")).toBe(state.v.false); expect(state.globals.get("fallback")).toEqual(state.v.integer(9));
  expect(() => state.run("instance.value\n")).toThrow("'C' object has no attribute 'value'");
});

it("allocates fresh dictionary-backed instances through inherited object new", () => {
  const state = fixture(), base = state.type("Base"), owner = state.type("C", base); state.globals.set("C", owner);
  state.method(base, "__init__", "def initialize(self,value):\n self.value=value\n");
  state.run("first=C(3)\nsecond=C(value=7)\na=first.value\nb=second.value\n");
  expect(state.globals.get("a")).toEqual(state.v.integer(3)); expect(state.globals.get("b")).toEqual(state.v.integer(7));
  expect(state.globals.get("first") === state.globals.get("second")).toBe(false);
});

it("rejects constructor arguments when object new and init are both default", () => {
  const state = fixture(); state.globals.set("C", state.type("C"));
  expect(() => state.run("C(1)\n")).toThrow("C() takes no arguments");
  expect(() => state.run("C(value=1)\n")).toThrow("C() takes no arguments");
});

it("calls native method descriptors through bound attributes and unbound calls", () => {
  const state = fixture(), owner = state.type("C");
  const descriptor = state.v.methodDescriptor({ owner, name: "native", accepts: value => value.kind === "instance" && value.type.value.mro.includes(owner.value), invoke(receiver, args, keywords) {
    if (receiver.kind !== "instance") throw Error("expected receiver");
    expect(args).toEqual([state.v.integer(3)]);
    return keywords.items.lookup(state.v.string("value"))!.value;
  } });
  owner.value.namespace.items.set(state.v.string("native"), descriptor);
  state.instance("instance", owner); state.globals.set("descriptor", descriptor);
  state.run("a=instance.native(3,value=7)\nb=descriptor(instance,3,value=9)\n");
  expect(state.globals.get("a")).toEqual(state.v.integer(7)); expect(state.globals.get("b")).toEqual(state.v.integer(9));
  expect(() => state.run("descriptor(1)\n")).toThrow("doesn't apply to a 'int' object");
  state.hooks.keywordName = key => { if (key.kind !== "str") throw Error("expected keyword"); return String.fromCodePoint(...key.value); };
  expect(() => state.run("descriptor(instance,3,**{'value':1},**{'value':2})\n")).toThrow("C.native() got multiple values for keyword argument 'value'");
});

it("allows instance dictionaries to shadow native method descriptors", () => {
  const state = fixture(), owner = state.type("C");
  owner.value.namespace.items.set(state.v.string("native"), state.v.methodDescriptor({ owner, name: "native", accepts: () => true, invoke() { throw Error("shadowed method must not run"); } }));
  state.instance("instance", owner);
  state.run("instance.native=7\nresult=instance.native\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(7));
});

it("binds native descriptors used as implicit special methods", () => {
  const state = fixture(), owner = state.type("C"), receiver = state.instance("instance", owner);
  owner.value.namespace.items.set(state.v.string("__add__"), state.v.methodDescriptor({ owner, name: "__add__", accepts: value => value === receiver, invoke(value, args) { expect(value).toBe(receiver); return args[0]; } }));
  state.run("result=instance+7\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(7));
});

it("compares freshly bound native methods and deduplicates their dictionary keys", () => {
  const state = fixture(), owner = state.type("C");
  owner.value.namespace.items.set(state.v.string("native"), state.v.methodDescriptor({ owner, name: "native", accepts: () => true, invoke: () => state.v.none }));
  state.instance("instance", owner); state.instance("other", owner);
  state.run("equal=instance.native==instance.native\nunequal=instance.native!=other.native\ndistinct=instance.native is not instance.native\nitems={instance.native:1,instance.native:2}\nresult=items[instance.native]\n");
  expect(state.globals.get("equal")).toBe(state.v.true); expect(state.globals.get("unequal")).toBe(state.v.true); expect(state.globals.get("distinct")).toBe(state.v.true);
  expect(state.globals.get("result")).toEqual(state.v.integer(2));
  const items = state.globals.get("items"); if (items?.kind !== "dict") throw Error("expected dictionary"); expect(items.items.size).toBe(1);
});

it("reads native method metadata through compiled attributes and getattr", () => {
  const state = fixture(), base = state.type("Base"), child = state.type("Child", base);
  const descriptor = state.v.methodDescriptor({ owner: base, name: "native", accepts: () => true, invoke() { throw Error("metadata must not call method"); } });
  base.value.namespace.items.set(state.v.string("native"), descriptor); state.globals.set("descriptor", descriptor);
  const instance = state.instance("instance", child);
  state.globals.set("getattr", createAttributeLookupBuiltin("getattr", state.v, state.meter));
  state.run("method=instance.native\nreceiver=method.__self__\nname=method.__name__\nowner=descriptor.__objclass__\nbuiltin_receiver=getattr(method,'__self__')\n");
  expect(state.globals.get("receiver")).toBe(instance); expect(state.globals.get("builtin_receiver")).toBe(instance);
  expect(state.globals.get("owner")).toBe(base); expect(state.globals.get("name")).toEqual(state.v.string("native"));
});

it("invokes native slot wrappers through construction, bound and unbound calls", () => {
  const state = fixture(), owner = state.type("C");
  const descriptor = state.v.wrapperDescriptor({ owner, name: "__init__", accepts: value => value.kind === "instance", invoke(receiver, args, keywords) {
    if (receiver.kind !== "instance" || receiver.dictionary === undefined) throw Error("expected instance storage");
    expect(args).toEqual([]); receiver.dictionary.items.set(state.v.string("value"), keywords.items.lookup(state.v.string("value"))!.value); return state.v.none;
  } });
  owner.value.namespace.items.set(state.v.string("__init__"), descriptor); state.globals.set("C", owner); state.globals.set("initialize", descriptor);
  state.run("instance=C(value=4)\na=instance.value\ninstance.__init__(value=5)\nb=instance.value\ninitialize(instance,value=6)\nc=instance.value\n");
  expect(state.globals.get("a")).toEqual(state.v.integer(4)); expect(state.globals.get("b")).toEqual(state.v.integer(5)); expect(state.globals.get("c")).toEqual(state.v.integer(6));
});

it("dispatches arithmetic slot wrappers without consulting instance dictionaries", () => {
  const state = fixture(), owner = state.type("C");
  owner.value.namespace.items.set(state.v.string("__add__"), state.v.wrapperDescriptor({ owner, name: "__add__", accepts: () => true, invoke: (_receiver, args) => args[0] }));
  state.instance("instance", owner); state.run("instance.__add__=False\nresult=instance+7\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(7));
});

it("exposes inherited object initialization through ordinary instance attributes", () => {
  const state = fixture(), owner = state.type("C"); state.globals.set("C", owner);
  state.run("instance=C()\nresult=instance.__init__()\n");
  expect(state.globals.get("result")).toBe(state.v.none);
  expect(() => state.run("instance.__init__(1)\n")).toThrow("C.__init__() takes exactly one argument (the instance to initialize)");
});

it("allows a custom allocator to consume arguments with inherited object init", () => {
  const state = fixture(), owner = state.type("C"); state.globals.set("C", owner); const instance = state.instance("allocated", owner);
  state.method(owner, "__new__", "def allocate(cls, *, value):\n visit(value)\n return allocated\n");
  state.run("result=C(value='new')\ninitialized=result.__init__(value='unused')\n");
  expect(state.globals.get("result")).toBe(instance); expect(state.globals.get("initialized")).toBe(state.v.none); expect(state.events).toEqual(["new"]);
});

it("uses frame actual-type policy for explicit object init on native payloads", () => {
  const state = fixture(), native = state.type("Native"), value = state.v.integer(7);
  native.value.namespace.items.set(state.v.string("__new__"), state.v.none); state.types.set(value, native);
  state.globals.set("payload", value); state.globals.set("initialize", state.registry.object.value.namespace.items.lookup(state.v.string("__init__"))!.value);
  state.run("result=initialize(payload,1)\n"); expect(state.globals.get("result")).toBe(state.v.none);
});

it("initializes custom metaclass allocations with the inherited type initializer", () => {
  const state = fixture(), meta = state.type("Meta", state.registry.type), cls = state.type("C", state.registry.object, {}, meta);
  state.globals.set("Meta", meta); state.globals.set("C", cls);
  state.method(meta, "__new__", "def allocate(cls, *args, **keywords):\n return C\n");
  state.run("one=Meta(None)\nthree=Meta(None,None,None,arbitrary=True)\n");
  expect(state.globals.get("one")).toBe(cls); expect(state.globals.get("three")).toBe(cls); expect(cls.value.name).toBe("C");
  expect(() => state.run("Meta()\n")).toThrow("type.__init__() takes 1 or 3 arguments");
  expect(() => state.run("Meta(None,None)\n")).toThrow("type.__init__() takes 1 or 3 arguments");
  expect(() => state.run("Meta(None,arbitrary=True)\n")).toThrow("type.__init__() takes no keyword arguments");
});

it("permits a custom metaclass initializer to override type initialization rules", () => {
  const state = fixture(), meta = state.type("Meta", state.registry.type), cls = state.type("C", state.registry.object, {}, meta);
  state.globals.set("Meta", meta); state.globals.set("C", cls);
  state.method(meta, "__new__", "def allocate(cls):\n return C\n");
  state.method(meta, "__init__", "def initialize(cls):\n visit('init')\n");
  state.run("result=Meta()\n"); expect(state.globals.get("result")).toBe(cls); expect(state.events).toEqual(["init"]);
});

it("inspects actual types in compiled calls without running allocation or initialization", () => {
  const state = fixture(), owner = state.type("C"), native = state.type("int"), integer = state.v.integer(7);
  const instance = state.instance("instance", owner); instance.dictionary!.items.set(state.v.string("__class__"), state.v.none);
  state.types.set(integer, native); state.globals.set("integer", integer); state.globals.set("type", state.registry.type); state.globals.set("C", owner);
  state.run("instance_type=type(instance)\nvisible=instance.__class__\nclass_type=type(C)\nnative_type=type(integer)\nroot_type=type(type)\n");
  expect(state.globals.get("visible")).toBe(owner);
  expect(state.globals.get("instance_type")).toBe(owner); expect(state.globals.get("class_type")).toBe(state.registry.type);
  expect(state.globals.get("native_type")).toBe(native); expect(state.globals.get("root_type")).toBe(state.registry.type);
});

it("does not confuse a user class named type with canonical type inspection", () => {
  const state = fixture(), owner = state.type("type"), allocated = state.instance("allocated", owner); state.globals.set("type", owner);
  state.method(owner, "__new__", "def allocate(cls, value):\n return allocated\n");
  state.run("result=type(None)\n"); expect(state.globals.get("result")).toBe(allocated);
});

it("retains the three-argument type construction path", () => {
  const state = fixture(), created = state.type("Created"); state.globals.set("Created", created); state.globals.set("type", state.registry.type);
  state.method(state.registry.type, "__new__", "def allocate(cls, name, bases, namespace):\n visit(name)\n return Created\n");
  state.run("result=type('Created',(),{})\n"); expect(state.globals.get("result")).toBe(created); expect(state.events).toEqual(["Created"]);
});

it("explicit type call bypasses metaclass call overrides and preserves initializer keywords", () => {
  const state = fixture(), meta = state.type("Meta", state.registry.type), owner = state.type("C", state.registry.object, {}, meta);
  state.globals.set("C", owner); state.globals.set("default_call", state.registry.type.value.namespace.items.lookup(state.v.string("__call__"))!.value);
  state.method(meta, "__call__", "def call(cls, *, value):\n visit('meta')\n return 7\n");
  state.method(owner, "__init__", "def initialize(self, *, value):\n visit(value)\n self.value=value\n");
  state.run("overridden=C(value='unused')\ninstance=default_call(C,value='init')\nresult=instance.value\n");
  expect(state.globals.get("overridden")).toEqual(state.v.integer(7)); expect(state.globals.get("result")).toEqual(state.v.string("init")); expect(state.events).toEqual(["meta", "init"]);
});

it("supports bound native type calls and explicit canonical type inspection", () => {
  const state = fixture(), owner = state.type("C"), descriptor = state.registry.type.value.namespace.items.lookup(state.v.string("__call__"))!.value;
  if (descriptor.kind !== "wrapper_descriptor") throw Error("expected type call wrapper");
  state.globals.set("construct", getRuntimeMethodDescriptor(descriptor, owner, state.v.none, state.v, state.meter));
  state.globals.set("inspect", getRuntimeMethodDescriptor(descriptor, state.registry.type, state.v.none, state.v, state.meter));
  state.run("instance=construct()\nresult=inspect(instance)\n"); expect(state.globals.get("result")).toBe(owner);
});

it("bounds recursive explicit default type calls and unwinds their stack entries", () => {
  const state = fixture(), owner = state.type("C"), safe = state.type("Safe"), descriptor = state.registry.type.value.namespace.items.lookup(state.v.string("__call__"))!.value;
  if (descriptor.kind !== "wrapper_descriptor") throw Error("expected type call wrapper");
  owner.value.namespace.items.set(state.v.string("__new__"), getRuntimeMethodDescriptor(descriptor, owner, state.v.none, state.v, state.meter));
  state.globals.set("default_call", descriptor); state.globals.set("C", owner); state.globals.set("Safe", safe);
  expect(() => state.run("default_call(C)\n")).toThrow("maximum recursion depth exceeded");
  state.run("result=Safe()\n"); expect(state.globals.get("result")?.kind).toBe("instance");
});

it("reads inherited class attributes and canonical type metadata in compiled expressions", () => {
  const state = fixture(), base = state.type("Base"), owner = state.type("C", base); state.globals.set("C", owner);
  base.value.namespace.items.set(state.v.string("value"), state.v.integer(7)); owner.value.namespace.items.set(state.v.string("local"), state.v.integer(9));
  state.run("value=C.value\nlocal=C.__dict__['local']\nmro=C.__mro__\ninstance=C.__call__()\n");
  expect(state.globals.get("value")).toEqual(state.v.integer(7)); expect(state.globals.get("local")).toEqual(state.v.integer(9));
  const mro = state.globals.get("mro"); if (mro?.kind !== "tuple") throw Error("expected MRO tuple"); expect(mro.items).toEqual([owner, base, state.registry.object]);
  const instance = state.globals.get("instance"); if (instance?.kind !== "instance") throw Error("expected instance"); expect(instance.type).toBe(owner);
});

it("reads native type slots as unbound descriptors on type itself", () => {
  const state = fixture(), owner = state.type("C"); state.globals.set("C", owner); state.globals.set("type", state.registry.type);
  state.run("instance=type.__call__(C)\nresult=type(instance)\ninitialized=type.__init__(C,None)\n");
  expect(state.globals.get("result")).toBe(owner); expect(state.globals.get("initialized")).toBe(state.v.none);
});

it("gives metaclass data descriptors precedence over class attributes", () => {
  const state = fixture(), meta = state.type("Meta", state.registry.type), owner = state.type("C", state.registry.object, {}, meta);
  meta.value.namespace.items.set(state.v.string("value"), state.v.getsetDescriptor({ owner: meta, name: "value", accepts: value => value === owner, get: () => state.v.integer(9) }));
  owner.value.namespace.items.set(state.v.string("value"), state.v.integer(7)); state.globals.set("C", owner);
  state.run("result=C.value\n"); expect(state.globals.get("result")).toEqual(state.v.integer(9));
});

it("binds metaclass getattribute and getattr through ordinary class reads", () => {
  const state = fixture(), meta = state.type("Meta", state.registry.type), owner = state.type("C", state.registry.object, {}, meta); state.globals.set("C", owner);
  state.globals.set("missing", state.v.builtinFunction({ name: "missing", invoke() { throw new PythonRuntimeError("AttributeError", "missing"); } }));
  state.method(meta, "__getattribute__", "def attribute(cls, name):\n visit(name)\n return missing()\n");
  state.method(meta, "__getattr__", "def fallback(cls, name):\n visit('fallback')\n return 9\n");
  state.run("result=C.value\n"); expect(state.globals.get("result")).toEqual(state.v.integer(9)); expect(state.events).toEqual(["value", "fallback"]);
});

it("keeps class functions unbound on class reads", () => {
  const state = fixture(), owner = state.type("C"), instance = state.instance("instance", owner); state.globals.set("C", owner);
  const method = state.method(owner, "method", "def method(self):\n return self\n");
  state.run("function=C.method\nresult=C.method(instance)\n"); expect(state.globals.get("function")).toBe(method); expect(state.globals.get("result")).toBe(instance);
});

it.each(["__getattribute__", "__getattr__"])("rejects disabled metaclass %s on class reads", slot => {
  const state = fixture(), meta = state.type("Meta", state.registry.type), owner = state.type("C", state.registry.object, {}, meta);
  meta.value.namespace.items.set(state.v.string(slot), state.v.none); state.globals.set("C", owner);
  expect(() => state.run("C.missing\n")).toThrow("'NoneType' object is not callable");
});

it("bounds class names in missing attribute diagnostics", () => {
  const state = fixture(); state.globals.set("C", state.type("é".repeat(100)));
  expect(() => state.run("C.missing\n")).toThrow(`type object '${"é".repeat(50)}' has no attribute 'missing'`);
});

it("exposes explicit default type attribute operations without metaclass redispatch", () => {
  const state = fixture(), meta = state.type("Meta", state.registry.type), owner = state.type("C", state.registry.object, {}, meta);
  state.globals.set("C", owner); state.globals.set("type", state.registry.type);
  for (const name of ["__getattribute__", "__setattr__", "__delattr__"]) meta.value.namespace.items.set(state.v.string(name), state.v.none);
  state.run("type.__setattr__(C,'value',7)\nresult=type.__getattribute__(C,'value')\ntype.__delattr__(C,'value')\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(7));
  expect(owner.value.namespace.items.lookup(state.v.string("value"))).toBeUndefined();
});

it("lets metaclass overrides delegate to native default attribute slots", () => {
  const state = fixture(), meta = state.type("Meta", state.registry.type), owner = state.type("C", state.registry.object, {}, meta);
  state.globals.set("C", owner); state.globals.set("type", state.registry.type);
  state.method(meta, "__getattribute__", "def read(cls,name):\n return type.__getattribute__(cls,name)\n");
  state.method(meta, "__setattr__", "def write(cls,name,value):\n return type.__setattr__(cls,name,value)\n");
  state.method(meta, "__delattr__", "def remove(cls,name):\n return type.__delattr__(cls,name)\n");
  state.run("C.value=9\nresult=C.value\ndel C.value\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(9));
  expect(owner.value.namespace.items.lookup(state.v.string("value"))).toBeUndefined();
});

it("keeps getattr fallback outside explicit default type reads", () => {
  const state = fixture(), meta = state.type("Meta", state.registry.type), owner = state.type("C", state.registry.object, {}, meta);
  state.globals.set("C", owner); state.globals.set("type", state.registry.type);
  state.method(meta, "__getattr__", "def fallback(cls,name):\n return 7\n");
  state.run("result=C.missing\n"); expect(state.globals.get("result")).toEqual(state.v.integer(7));
  expect(() => state.run("type.__getattribute__(C,'missing')\n")).toThrow("type object 'C' has no attribute 'missing'");
});

it("reads intrinsic class names independently of namespace shadows", () => {
  const state = fixture(), owner = state.type("C"); state.globals.set("C", owner);
  owner.value.namespace.items.set(state.v.string("__name__"), state.v.string("shadow"));
  state.run("name=C.__name__\nqualified=C.__qualname__\n");
  expect(state.globals.get("name")).toEqual(state.v.string("C")); expect(state.globals.get("qualified")).toEqual(state.v.string("C"));
});

it("renames intrinsic class metadata independently and updates runtime diagnostics", () => {
  const state = fixture(), owner = state.type("C"); state.globals.set("C", owner);
  state.run("C.__name__='Renamed'\nC.__qualname__='Outer.Inner'\nname=C.__name__\nqualified=C.__qualname__\n");
  expect(owner.value.name).toBe("Renamed"); expect(state.globals.get("name")).toEqual(state.v.string("Renamed")); expect(state.globals.get("qualified")).toEqual(state.v.string("Outer.Inner"));
  expect(owner.value.namespace.items.lookup(state.v.string("__name__"))).toBeUndefined();
  expect(owner.value.namespace.items.lookup(state.v.string("__qualname__"))).toBeUndefined();
  expect(() => state.run("C.missing\n")).toThrow("type object 'Renamed' has no attribute 'missing'");
});

it("executes classes produced by concrete allocation through normal constructor and attribute paths", () => {
  const state = fixture(), source = state.type("NamespaceSource").value.namespace;
  source.items.set(state.v.string("value"), state.v.integer(7));
  const owner = allocateRuntimeType(state.v.string("Created"), [], source, state.registry.type, state.registry, state.v, state.meter);
  state.globals.set("C", owner); state.run("instance=C()\nresult=instance.value\nname=C.__name__\n");
  const instance = state.globals.get("instance"); expect(instance?.kind === "instance" && instance.type).toBe(owner);
  expect(state.globals.get("result")).toEqual(state.v.integer(7)); expect(state.globals.get("name")).toEqual(state.v.string("Created"));
});

it("exposes failed class metadata but rejects ordinary construction without an MRO", () => {
  const state = fixture(), source = state.type("NamespaceSource").value.namespace, cell = state.v.cell({});
  source.items.set(state.v.string("__classcell__"), cell); source.items.set(state.v.string("value"), state.v.integer(7));
  expect(() => allocateRuntimeType(state.v.string("Failed"), [state.registry.object, state.registry.object], source, state.registry.type, state.registry, state.v, state.meter)).toThrow("duplicate base class object");
  const owner = cell.value.content?.value; if (owner?.kind !== "type") throw Error("expected failed class"); state.globals.set("C", owner);
  state.run("mro=C.__mro__\nname=C.__name__\n"); expect(state.globals.get("mro")).toBe(state.v.none); expect(state.globals.get("name")).toEqual(state.v.string("Failed"));
  expect(() => state.run("C.value\n")).toThrow("type object 'Failed' has no attribute 'value'");
  expect(() => state.run("C()\n")).toThrow("cannot create 'Failed' instances");
  state.globals.set("object", state.registry.object);
  expect(() => state.run("object.__new__(C)\n")).toThrow("cannot create 'Failed' instances");
});

it("preserves full failed class names in constructor diagnostics", () => {
  const state = fixture(), source = state.type("NamespaceSource").value.namespace, cell = state.v.cell({}), name = "é".repeat(300);
  source.items.set(state.v.string("__classcell__"), cell);
  expect(() => allocateRuntimeType(state.v.string(name), [state.registry.object, state.registry.object], source, state.registry.type, state.registry, state.v, state.meter)).toThrow("duplicate base class object");
  const owner = cell.value.content?.value; if (owner?.kind !== "type") throw Error("expected failed class"); state.globals.set("C", owner);
  expect(() => state.run("C()\n")).toThrow(`cannot create '${name}' instances`);
});

it("forwards explicit keyword dictionaries when native code reenters a guest callback", () => {
  const state = fixture(), keywords = state.type("Keywords").value.namespace;
  keywords.items.set(state.v.string("flag"), state.v.integer(7));
  state.hooks.keywordName = value => value.kind === "str" ? String.fromCodePoint(...value.value) : "invalid";
  state.globals.set("invoke", state.v.builtinFunction({ name: "invoke", invoke(args, _keywords, _meter, invocation) {
    if (!invocation) throw Error("expected invocation context"); return invocation.call(args[0], [], keywords);
  } }));
  state.run("def hook(*,flag):\n return flag\nresult=invoke(hook)\n"); expect(state.globals.get("result")).toEqual(state.v.integer(7));
});

it("runs compiled set-name and inherited subclass hooks on an allocated class", () => {
  const state = fixture(), base = state.type("Base"), descriptorType = state.type("Descriptor"), source = state.type("Source").value.namespace, keywords = state.type("Keywords").value.namespace;
  state.hooks.keywordName = value => value.kind === "str" ? String.fromCodePoint(...value.value) : "invalid";
  state.method(descriptorType, "__set_name__", "def set_name(self,owner,name):\n owner.assigned=name\n visit(name)\n return 7\n");
  // Assigned after creation: unlike a class-body declaration this is not
  // automatically wrapped as a classmethod, so super's class access stays unbound.
  state.method(base, "__init_subclass__", "def initialize(*,flag):\n visit(flag)\n return 9\n");
  source.items.set(state.v.string("x"), state.v.instance(descriptorType)); keywords.items.set(state.v.string("flag"), state.v.string("subclass"));
  const cls = allocateRuntimeType(state.v.string("C"), [base], source, state.registry.type, state.registry, state.v, state.meter); state.globals.set("C", cls);
  state.globals.set("finish", state.v.builtinFunction({ name: "finish", invoke(_args, _keywords, _meter, invocation) {
    if (!invocation) throw Error("expected invocation context");
    finalizeRuntimeType(cls, keywords, { typeOf: value => state.types.get(value) ?? state.registry.object, slots: () => undefined }, state.v, state.meter, { call: invocation.call, repr() { throw Error("unexpected diagnostic"); } });
    return state.v.none;
  } }));
  state.run("finish()\nresult=C.assigned\ninstance=C()\n"); expect(state.events).toEqual(["x", "subclass"]); expect(state.globals.get("result")).toEqual(state.v.string("x"));
});

it("calls bound native functions with nested receivers in binding order", () => {
  const state = fixture(), first = state.v.list([]), second = state.v.list([]);
  const native = state.v.builtinFunction({ name: "capture", invoke(args) { expect(args).toEqual([first, second, state.v.integer(7)]); return state.v.true; } });
  state.globals.set("method", state.v.boundMethod(state.v.boundMethod(native, first), second));
  state.run("result=method(7)\n"); expect(state.globals.get("result")).toBe(state.v.true);
});

it("calls bound type values through normal type inspection", () => {
  const state = fixture(), owner = state.type("C"), instance = state.v.instance(owner);
  state.globals.set("method", state.v.boundMethod(state.registry.type, instance));
  state.run("result=method()\n"); expect(state.globals.get("result")).toBe(owner);
});

it("reports noncallable wrapped values through the normal call path", () => {
  const state = fixture(); state.globals.set("method", state.v.boundMethod(state.v.none, state.v.true));
  expect(() => state.run("method()\n")).toThrow("'NoneType' object is not callable");
});

it("unwraps deeply nested bound calls without recursive host invocation", () => {
  const state = fixture(); let method: RuntimeValue = state.v.builtinFunction({ name: "count", invoke(args) { return state.v.integer(args.length); } });
  for (let depth = 0; depth < 2000; depth++) method = state.v.boundMethod(method, state.v.true);
  state.globals.set("method", method); state.run("result=method()\n"); expect(state.globals.get("result")).toEqual(state.v.integer(2000));
});

it("exposes bound method function and receiver identities without host payload fields", () => {
  const state = fixture(), fn = state.v.builtinFunction({ name: "fn", invoke: () => state.v.none }), receiver = state.v.list([]);
  state.globals.set("method", state.v.boundMethod(fn, receiver)); state.run("function=method.__func__\nreceiver=method.__self__\n");
  expect(state.globals.get("function")).toBe(fn); expect(state.globals.get("receiver")).toBe(receiver);
});

it("uses the underlying native function name for duplicate bound-call keywords", () => {
  const state = fixture(), fn = state.v.builtinFunction({ name: "capture", invoke() { throw Error("must not call"); } });
  state.hooks.keywordName = value => value.kind === "str" ? String.fromCodePoint(...value.value) : "invalid";
  state.globals.set("method", state.v.boundMethod(fn, state.v.true));
  expect(() => state.run("method(x=1,**{'x':2})\n")).toThrow("capture() got multiple values for keyword argument 'x'");
});

it("inherits static methods without binding either classes or instances", () => {
  const state = fixture(), base = state.type("Base"), child = state.type("Child", base);
  state.method(base, "f", "def f(value):\n return value\n"); const fn = base.value.namespace.items.lookup(state.v.string("f"))!.value;
  base.value.namespace.items.set(state.v.string("f"), state.v.methodDecorator("staticmethod", fn)); state.globals.set("Child", child); state.instance("obj", child);
  state.run("a=Child.f(7)\nb=obj.f(9)\n"); expect(state.globals.get("a")).toEqual(state.v.integer(7)); expect(state.globals.get("b")).toEqual(state.v.integer(9));
});

it("binds inherited class methods to the effective class for class and instance reads", () => {
  const state = fixture(), base = state.type("Base"), child = state.type("Child", base);
  state.method(base, "f", "def f(cls):\n return cls\n"); const fn = base.value.namespace.items.lookup(state.v.string("f"))!.value;
  base.value.namespace.items.set(state.v.string("f"), state.v.methodDecorator("classmethod", fn)); state.globals.set("Child", child); state.instance("obj", child);
  state.run("a=Child.f()\nb=obj.f()\n"); expect(state.globals.get("a")).toBe(child); expect(state.globals.get("b")).toBe(child);
});

it("calls static wrappers directly and preserves mixed nested binding order", () => {
  const state = fixture(), fn = state.v.builtinFunction({ name: "capture", invoke(args) { expect(args).toEqual([state.v.true, state.v.integer(7)]); return state.v.none; } });
  state.globals.set("wrapped", state.v.methodDecorator("staticmethod", state.v.boundMethod(state.v.methodDecorator("staticmethod", fn), state.v.true)));
  state.run("result=wrapped(7)\n"); expect(state.globals.get("result")).toBe(state.v.none);
});

it("exposes decorator payload identities but does not make classmethod objects callable", () => {
  const state = fixture(), wrapper = state.v.methodDecorator("classmethod", state.v.none); state.globals.set("wrapped", wrapper);
  state.run("function=wrapped.__func__\noriginal=wrapped.__wrapped__\n"); expect(state.globals.get("function")).toBe(state.v.none); expect(state.globals.get("original")).toBe(state.v.none);
  expect(() => state.run("wrapped()\n")).toThrow("'classmethod' object is not callable");
});

it.each(["staticmethod", "classmethod"] as const)("reads copied %s metadata from compiled code without forwarding to the payload", kind => {
  const state = fixture(), wrapper = state.v.methodDecorator(kind, state.v.none), metadata = state.v.list([]);
  wrapper.state.initialize(state.v.true, () => metadata, state.meter);
  state.globals.set("wrapped", wrapper);
  state.run("name=wrapped.__name__\nqualified=wrapped.__qualname__\nmodule=wrapped.__module__\ndoc=wrapped.__doc__\noriginal=wrapped.__wrapped__\n");
  for (const name of ["name", "qualified", "module", "doc"]) expect(state.globals.get(name)).toBe(metadata);
  expect(state.globals.get("original")).toBe(state.v.true);
  wrapper.state.initialize(state.v.false, () => state.v.none, state.meter);
  state.run("updated=wrapped.__name__\nfunction=wrapped.__func__\n");
  expect(state.globals.get("updated")).toBe(state.v.none);
  expect(state.globals.get("function")).toBe(state.v.false);
});

it.each(["staticmethod", "classmethod"] as const)("constructs canonical %s values through native allocation and initialization", kind => {
  const state = fixture(), owner = state.type("Owner"), fn = state.method(owner, "f", 'def f():\n "documentation"\n return 7\n'), type = state.registry.methodDecoratorType(kind);
  state.globals.set("factory", type); state.globals.set("f", fn);
  state.run("wrapped=factory(f)\nname=wrapped.__name__\nqualified=wrapped.__qualname__\ndoc=wrapped.__doc__\noriginal=wrapped.__func__\n");
  const wrapped = state.globals.get("wrapped")!;
  if (wrapped.kind !== kind) throw Error("wrong wrapper kind");
  expect(wrapped.type).toBe(type); expect(state.globals.get("name")).toBe(fn.value.name);
  expect(state.globals.get("qualified")).toBe(fn.value.qualifiedName); expect(state.globals.get("doc")).toBe(fn.value.doc);
  expect(state.globals.get("original")).toBe(fn);
  state.run("factory.__init__(wrapped, f)\n");
  expect(() => state.run("factory()\n")).toThrow(`${kind} expected 1 argument, got 0`);
  expect(() => state.run("factory(f, extra=True)\n")).toThrow(`${kind}() takes no keyword arguments`);
});

it.each(["staticmethod", "classmethod"] as const)("allocates %s subclasses with their actual type and inherited initializer", kind => {
  const state = fixture(), base = state.registry.methodDecoratorType(kind), child = state.type("Child", base), fn = state.method(state.type("Owner"), "f", "def f(): return 7\n");
  state.globals.set("Child", child); state.globals.set("base", base); state.globals.set("f", fn);
  state.run("wrapped=Child(f)\nraw=base.__new__(Child, 1, ignored=True)\n");
  const wrapped = state.globals.get("wrapped")!, raw = state.globals.get("raw")!;
  if (wrapped.kind !== kind || raw.kind !== kind) throw Error("wrong wrapper kind");
  expect(wrapped.type).toBe(child); expect(wrapped.value).toBe(fn);
  expect(raw.type).toBe(child); expect(raw.value).toBe(state.v.none); expect(raw.state.attributes.size).toBe(0);
});

it.each(["staticmethod", "classmethod"] as const)("applies native %s decorator syntax while ignoring unresolved annotations", kind => {
  const state = fixture(); state.globals.set("factory", state.registry.methodDecoratorType(kind));
  state.run("@factory\ndef decorated(x: Missing) -> Absent:\n return x\nname=decorated.__name__\n");
  const wrapped = state.globals.get("decorated")!;
  if (wrapped.kind !== kind || wrapped.value.kind !== "function") throw Error("expected decorated function");
  expect(state.globals.get("name")).toBe(wrapped.value.value.name);
});

it.each(["staticmethod", "classmethod"] as const)("calls native %s __get__ through compiled descriptor dispatch", kind => {
  const state = fixture(), type = state.registry.methodDecoratorType(kind), owner = state.type("Owner"), fn = state.method(owner, "f", "def f(): return 7\n");
  state.globals.set("factory", type); state.globals.set("Owner", owner); state.globals.set("f", fn); state.instance("obj", owner);
  state.run("wrapped=factory(f)\nclassBound=factory.__get__(wrapped,None,Owner)\ninstanceBound=factory.__get__(wrapped,obj)\n");
  for (const name of ["classBound", "instanceBound"]) {
    const bound = state.globals.get(name)!;
    if (kind === "staticmethod") expect(bound).toBe(fn);
    else { if (bound.kind !== "method") throw Error("expected method"); expect(bound.value.function).toBe(fn); expect(bound.value.instance).toBe(owner); }
  }
});

it("calls staticmethod's native __call__ with positional and keyword arguments", () => {
  const state = fixture(), fn = state.method(state.type("Owner"), "f", "def f(x,*,flag): return flag\n");
  state.globals.set("factory", state.registry.methodDecoratorType("staticmethod")); state.globals.set("f", fn);
  state.run("wrapped=factory(f)\nresult=factory.__call__(wrapped,7,flag=True)\n");
  expect(state.globals.get("result")).toBe(state.v.true);
});

it.each(["staticmethod", "classmethod"] as const)("binds %s instance methods and mutates its ordinary attributes", kind => {
  const state = fixture(), owner = state.type("Owner"), fn = state.method(owner, "f", "def f(): return 7\n");
  state.globals.set("factory", state.registry.methodDecoratorType(kind)); state.globals.set("f", fn); state.globals.set("Owner", owner);
  state.run("wrapped=factory(f)\nwrapped.extra=True\nextra=wrapped.extra\nbound=wrapped.__get__(None,Owner)\nwrapped.__init__(f)\ndel wrapped.extra\n");
  expect(state.globals.get("extra")).toBe(state.v.true);
  expect(() => state.run("wrapped.extra\n")).toThrow("has no attribute 'extra'");
  expect(() => state.run("wrapped.__func__=None\n")).toThrow("readonly attribute");
  expect(() => state.run("del wrapped.__wrapped__\n")).toThrow("readonly attribute");
  const bound = state.globals.get("bound")!;
  if (kind === "staticmethod") expect(bound).toBe(fn);
  else { if (bound.kind !== "method") throw Error("expected method"); expect(bound.value.function).toBe(fn); expect(bound.value.instance).toBe(owner); }
});

it.each(["staticmethod", "classmethod"] as const)("lets %s subclass attributes shadow inherited member descriptors", kind => {
  const state = fixture(), child = state.type("Child", state.registry.methodDecoratorType(kind)), value = state.v.integer(8);
  child.value.namespace.items.set(state.v.string("__func__"), value); state.globals.set("Child", child);
  state.run("wrapped=Child(None)\ninitial=wrapped.__func__\nwrapped.__func__=True\nchanged=wrapped.__func__\ndel wrapped.__func__\nrestored=wrapped.__func__\n");
  expect(state.globals.get("initial")).toBe(value); expect(state.globals.get("changed")).toBe(state.v.true); expect(state.globals.get("restored")).toBe(value);
});

it.each(["staticmethod", "classmethod"] as const)("uses %s subclass attribute overrides and missing-attribute fallback", kind => {
  const state = fixture(), child = state.type("Child", state.registry.methodDecoratorType(kind));
  state.method(child, "__getattr__", "def fallback(self,name): return True\n"); state.globals.set("Child", child);
  state.run("wrapped=Child(None)\nfallback=wrapped.missing\n"); expect(state.globals.get("fallback")).toBe(state.v.true);
  state.method(child, "__getattribute__", "def get(self,name): return False\n");
  state.method(child, "__setattr__", "def set(self,name,value): visit(name)\n");
  state.method(child, "__delattr__", "def delete(self,name): visit(name)\n");
  state.run("overridden=wrapped.__func__\nwrapped.custom=True\ndel wrapped.other\n");
  expect(state.globals.get("overridden")).toBe(state.v.false); expect(state.events).toEqual(["custom", "other"]);
});

it.each(["staticmethod", "classmethod"] as const)("exposes a live replaceable %s dictionary with non-string keys", kind => {
  const state = fixture(); state.globals.set("factory", state.registry.methodDecoratorType(kind));
  state.run("wrapped=factory(None)\nwrapped.x=True\noriginal=wrapped.__dict__\nsame=wrapped.__dict__ is original\noriginal['x']=False\nread=wrapped.x\noriginal[7]=True\nnumber=wrapped.__dict__[7]\nreplacement={'y':True}\nwrapped.__dict__=replacement\nreplaced=wrapped.__dict__ is replacement\nwrapped.y=False\nupdated=replacement['y']\nold=original['x']\n");
  for (const name of ["same", "number", "replaced"]) expect(state.globals.get(name)).toBe(state.v.true);
  for (const name of ["read", "updated", "old"]) expect(state.globals.get(name)).toBe(state.v.false);
  expect(() => state.run("wrapped.x\n")).toThrow("has no attribute 'x'");
  expect(() => state.run("wrapped.__dict__=None\n")).toThrow("__dict__ must be set to a dictionary, not a 'NoneType'");
  expect(() => state.run("del wrapped.__dict__\n")).toThrow("cannot delete __dict__");
  state.run("still=wrapped.__dict__ is replacement\n"); expect(state.globals.get("still")).toBe(state.v.true);
});

it.each(["staticmethod", "classmethod"] as const)("updates the replacement %s dictionary on reinitialization", kind => {
  const state = fixture(), fn = state.method(state.type("Owner"), "f", "def f(): return 7\n");
  state.globals.set("factory", state.registry.methodDecoratorType(kind)); state.globals.set("f", fn);
  state.run("wrapped=factory(f)\nold=wrapped.__dict__\nreplacement={'custom':True}\nwrapped.__dict__=replacement\nwrapped.__init__(f)\nname=replacement['__name__']\ncustom=wrapped.custom\nreplacement['__func__']=None\noriginal=wrapped.__func__\n");
  expect(state.globals.get("name")).toBe(fn.value.name); expect(state.globals.get("custom")).toBe(state.v.true); expect(state.globals.get("original")).toBe(fn);
});

it.each(["staticmethod", "classmethod"] as const)("reads live readonly %s abstractness with data-descriptor precedence", kind => {
  const state = fixture(); state.instance("payload", state.type("Payload")); state.globals.set("factory", state.registry.methodDecoratorType(kind));
  state.run("wrapped=factory(payload)\nmissing=wrapped.__isabstractmethod__\npayload.__isabstractmethod__=True\nfirst=wrapped.__isabstractmethod__\npayload.__isabstractmethod__=False\nsecond=wrapped.__isabstractmethod__\ndel payload.__isabstractmethod__\nwrapped.__dict__['__isabstractmethod__']=True\nshadowed=wrapped.__isabstractmethod__\n");
  expect(state.globals.get("first")).toBe(state.v.true);
  for (const name of ["missing", "second", "shadowed"]) expect(state.globals.get(name)).toBe(state.v.false);
  expect(() => state.run("wrapped.__isabstractmethod__=True\n")).toThrow(`attribute '__isabstractmethod__' of '${kind}' objects is not writable`);
});

it.each(["staticmethod", "classmethod"] as const)("uses guest truth for %s abstractness without swallowing truth errors", kind => {
  const state = fixture(), flagType = state.type("Flag"); state.instance("payload", state.type("Payload")); state.instance("flag", flagType);
  state.method(flagType, "__bool__", "def truth(self):\n visit('bool')\n return False\n"); state.globals.set("factory", state.registry.methodDecoratorType(kind));
  state.run("payload.__isabstractmethod__=flag\nwrapped=factory(payload)\nresult=wrapped.__isabstractmethod__\n");
  expect(state.globals.get("result")).toBe(state.v.false); expect(state.events).toEqual(["bool"]);
  state.globals.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw new PythonRuntimeError("AttributeError", "truth failure"); } }));
  state.method(flagType, "__bool__", "def truth(self): return fail()\n");
  expect(() => state.run("wrapped.__isabstractmethod__\n")).toThrow("truth failure");
});

it.each(["staticmethod", "classmethod"] as const)("reads %s abstractness from function attributes", kind => {
  const state = fixture(), fn = state.method(state.type("Owner"), "f", "def f(): pass\n");
  fn.value.attributes.set("__isabstractmethod__", state.v.true); state.globals.set("f", fn); state.globals.set("factory", state.registry.methodDecoratorType(kind));
  state.run("wrapped=factory(f)\nfirst=wrapped.__isabstractmethod__\n"); expect(state.globals.get("first")).toBe(state.v.true);
  fn.value.attributes.delete("__isabstractmethod__");
  state.run("second=wrapped.__isabstractmethod__\n"); expect(state.globals.get("second")).toBe(state.v.false);
});

it.each(["staticmethod", "classmethod"] as const)("lazily exposes ignored source annotations through %s", kind => {
  const state = fixture(); state.globals.set("factory", state.registry.methodDecoratorType(kind));
  state.run("@factory\ndef wrapped(x: Missing) -> Absent:\n return x\nfunction=wrapped.__func__\nannotations=wrapped.__annotations__\nsame=annotations is function.__annotations__\nagain=wrapped.__annotations__ is annotations\nannotate=wrapped.__annotate__\n");
  const annotations = state.globals.get("annotations")!;
  if (annotations.kind !== "dict") throw Error("expected ignored annotation dictionary");
  expect(annotations.items.size).toBe(0); expect(state.globals.get("same")).toBe(state.v.true); expect(state.globals.get("again")).toBe(state.v.true); expect(state.globals.get("annotate")).toBe(state.v.none);
});

it.each(["staticmethod", "classmethod"] as const)("caches and replaces %s annotation proxy fields independently", kind => {
  const state = fixture(); state.instance("payload", state.type("Payload")); state.globals.set("factory", state.registry.methodDecoratorType(kind));
  for (const name of ["__annotations__", "__annotate__"]) {
    state.run(`payload.${name}=True\nwrapped=factory(payload)\nfirst=wrapped.${name}\npayload.${name}=False\ncached=wrapped.${name}\ndel wrapped.${name}\nrefreshed=wrapped.${name}\nwrapped.${name}=None\nassigned=wrapped.${name}\nwrapped.__dict__={}\nuncached=wrapped.${name}\n`);
    for (const key of ["first", "cached"]) expect(state.globals.get(key)).toBe(state.v.true);
    for (const key of ["refreshed", "uncached"]) expect(state.globals.get(key)).toBe(state.v.false);
    expect(state.globals.get("assigned")).toBe(state.v.none);
    state.run(`del wrapped.${name}\n`);
    expect(() => state.run(`del wrapped.${name}\n`)).toThrow(`'${kind}' object has no attribute '${name}'`);
    state.run(`del payload.${name}\n`);
    expect(() => state.run(`wrapped.${name}\n`)).toThrow(`'Payload' object has no attribute '${name}'`);
  }
});

it("provides ignored function and wrapper annotations to nested format-field lookup", () => {
  const state = fixture(); state.globals.set("factory", state.registry.methodDecoratorType("staticmethod"));
  state.run("def f(x: Missing): pass\nresult='{0.__annotations__}'.format(f)\n@factory\ndef g(x: Absent): pass\nwrapped='{0.__annotations__}'.format(g)\n");
  expect(state.globals.get("result")).toEqual(state.v.string("{}"));
  expect(state.globals.get("wrapped")).toEqual(state.v.string("{}"));
});

it.each(["staticmethod", "classmethod"] as const)("reports the None payload type when %s annotation lookup is missing", kind => {
  const state = fixture(); state.globals.set("factory", state.registry.methodDecoratorType(kind)); state.run("wrapped=factory(None)\n");
  expect(() => state.run("wrapped.__annotations__\n")).toThrow("'NoneType' object has no attribute '__annotations__'");
});

it.each(["staticmethod", "classmethod"] as const)("supports metadata-writing decorators inside %s", kind => {
  const state = fixture(); state.globals.set("factory", state.registry.methodDecoratorType(kind));
  state.run("def mark(fn):\n fn.__isabstractmethod__=True\n fn.custom=7\n return fn\n@factory\n@mark\ndef wrapped(x: Missing): return x\nabstract=wrapped.__isabstractmethod__\ncustom=wrapped.__func__.custom\nwrapped.__func__.__isabstractmethod__=False\nchanged=wrapped.__isabstractmethod__\ndel wrapped.__func__.custom\n");
  expect(state.globals.get("abstract")).toBe(state.v.true); expect(state.globals.get("changed")).toBe(state.v.false); expect(state.globals.get("custom")).toEqual(state.v.integer(7));
  expect(() => state.run("wrapped.__func__.custom\n")).toThrow("'function' object has no attribute 'custom'");
});

it("validates mutable function names and resets deleted module/doc metadata", () => {
  const state = fixture();
  state.run("def f(): pass\nf.__name__='renamed'\nf.__qualname__='Outer.renamed'\nname=f.__name__\nqualified=f.__qualname__\nf.__module__=7\nf.__doc__=False\nmodule=f.__module__\ndoc=f.__doc__\ndel f.__module__\ndel f.__doc__\nresetModule=f.__module__\nresetDoc=f.__doc__\n");
  expect(state.globals.get("name")).toEqual(state.v.string("renamed")); expect(state.globals.get("qualified")).toEqual(state.v.string("Outer.renamed"));
  expect(state.globals.get("module")).toEqual(state.v.integer(7)); expect(state.globals.get("doc")).toBe(state.v.false);
  expect(state.globals.get("resetModule")).toBe(state.v.none); expect(state.globals.get("resetDoc")).toBe(state.v.none);
  expect(() => state.run("f.__name__=None\n")).toThrow("__name__ must be set to a string object");
  expect(() => state.run("del f.__qualname__\n")).toThrow("__qualname__ must be set to a string object");
});

it("replaces and resets function annotation dictionaries without evaluating source annotations", () => {
  const state = fixture();
  state.run("def f(x: Missing): pass\noriginal=f.__annotations__\nreplacement={'x':True}\nf.__annotations__=replacement\nsame=f.__annotations__ is replacement\nf.__annotations__=None\nreset=f.__annotations__\ndel f.__annotations__\ndeleted=f.__annotations__\n");
  expect(state.globals.get("same")).toBe(state.v.true);
  const reset = state.globals.get("reset")!, deleted = state.globals.get("deleted")!;
  if (reset.kind !== "dict" || deleted.kind !== "dict") throw Error("expected empty annotation dictionaries");
  expect(reset.items.size).toBe(0); expect(deleted.items.size).toBe(0); expect(reset === deleted).toBe(false);
  expect(() => state.run("f.__annotations__=7\n")).toThrow("__annotations__ must be set to a dict object");
});

it("shares live function dictionaries with ordinary attributes while preserving native metadata", () => {
  const state = fixture();
  state.run("def f(): pass\nf.custom=True\nold=f.__dict__\nsame=f.__dict__ is old\nold['custom']=False\nchanged=f.custom\nreplacement={7:True,'__name__':'shadow','__annotations__':False}\nf.__dict__=replacement\nreplaced=f.__dict__ is replacement\nf.extra=True\nextra=replacement['extra']\nname=f.__name__\nannotations=f.__annotations__\nnumber=f.__dict__[7]\n");
  for (const name of ["same", "replaced", "extra", "number"]) expect(state.globals.get(name)).toBe(state.v.true);
  expect(state.globals.get("changed")).toBe(state.v.false); expect(state.globals.get("name")).toEqual(state.v.string("f"));
  const annotations = state.globals.get("annotations")!; if (annotations.kind !== "dict") throw Error("expected intrinsic annotations"); expect(annotations.items.size).toBe(0);
  expect(() => state.run("f.custom\n")).toThrow("'function' object has no attribute 'custom'");
  expect(() => state.run("f.__dict__=None\n")).toThrow("__dict__ must be set to a dictionary, not a 'NoneType'");
  expect(() => state.run("del f.__dict__\n")).toThrow("cannot delete __dict__");
  const fn = state.globals.get("f")!; if (fn.kind !== "function") throw Error("expected function");
  fn.value.attributes.set("host", state.v.true);
  state.run("host=f.__dict__['host']\ndel f.extra\nold['custom']=True\ndetached=old['custom']\nstill=f.__dict__ is replacement\n");
  for (const name of ["host", "detached", "still"]) expect(state.globals.get(name)).toBe(state.v.true);
  expect(fn.value.attributes.has("extra")).toBe(false);
  expect(() => state.run("f.custom\n")).toThrow("'function' object has no attribute 'custom'");
});

it("adopts a supplied function dictionary before any reflection", () => {
  const state = fixture();
  state.run("def f(): pass\nf.previous=True\nreplacement={'current':False}\nf.__dict__=replacement\nsame=f.__dict__ is replacement\ncurrent=f.current\n");
  expect(state.globals.get("same")).toBe(state.v.true); expect(state.globals.get("current")).toBe(state.v.false);
  expect(() => state.run("f.previous\n")).toThrow("'function' object has no attribute 'previous'");
});

it("reflects, replaces and deletes allocated instance dictionaries without clearing detached aliases", () => {
  const state = fixture(), source = state.type("Source").value.namespace;
  const cls = allocateRuntimeType(state.v.string("C"), [], source, state.registry.type, state.registry, state.v, state.meter);
  state.globals.set("C", cls);
  state.run("obj=C()\nobj.x=True\nold=obj.__dict__\nsame=obj.__dict__ is old\nreplacement={7:True,'current':False}\nobj.__dict__=replacement\ncurrent=obj.current\nreplaced=obj.__dict__ is replacement\nobj.y=True\ny=replacement['y']\ndel obj.__dict__\nfresh=obj.__dict__\nobj.z=True\nz=fresh['z']\nold_x=old['x']\nretained=replacement['y']\n");
  for (const name of ["same", "replaced", "y", "z", "old_x", "retained"]) expect(state.globals.get(name)).toBe(state.v.true);
  expect(state.globals.get("current")).toBe(state.v.false);
  expect(state.globals.get("fresh") === state.globals.get("replacement")).toBe(false);
  expect(() => state.run("obj.current\n")).toThrow("'C' object has no attribute 'current'");
  expect(() => state.run("obj.__dict__=None\n")).toThrow("__dict__ must be set to a dictionary, not a 'NoneType'");
});

it("respects class dictionary shadows instead of replacing hidden instance storage", () => {
  const state = fixture(), source = state.type("Source").value.namespace;
  source.items.set(state.v.string("__dict__"), state.v.true);
  const cls = allocateRuntimeType(state.v.string("C"), [], source, state.registry.type, state.registry, state.v, state.meter);
  state.globals.set("C", cls);
  state.run("obj=C()\nobj.x=True\ninherited=obj.__dict__\nobj.__dict__=False\nown=obj.__dict__\nx=obj.x\ndel obj.__dict__\nrestored=obj.__dict__\n");
  for (const name of ["inherited", "x", "restored"]) expect(state.globals.get(name)).toBe(state.v.true);
  expect(state.globals.get("own")).toBe(state.v.false);
});

it("lets instance attribute overrides delegate to native object methods", () => {
  const state = fixture(), cls = state.type("C"); state.globals.set("object", state.registry.object);
  state.method(cls, "__getattribute__", "def get(self,name):\n visit('get')\n return object.__getattribute__(self,name)\n");
  state.method(cls, "__setattr__", "def set(self,name,value):\n visit('set')\n object.__setattr__(self,name,value)\n");
  state.method(cls, "__delattr__", "def delete(self,name):\n visit('delete')\n object.__delattr__(self,name)\n");
  state.instance("obj", cls);
  state.run("obj.x=True\nresult=obj.x\ndel obj.x\n");
  expect(state.globals.get("result")).toBe(state.v.true); expect(state.events).toEqual(["set", "get", "delete"]);
});

it("distinguishes explicit object lookup on classes from type lookup", () => {
  const state = fixture(), base = state.type("Base"), cls = state.type("C", base);
  state.globals.set("object", state.registry.object); state.globals.set("C", cls);
  base.value.namespace.items.set(state.v.string("inherited"), state.v.true);
  const fn = state.method(cls, "f", "def f(): pass\n");
  state.run("own=object.__getattribute__(C,'f')\nname=object.__getattribute__(C,'__name__')\n");
  expect(state.globals.get("own")).toBe(fn); expect(state.globals.get("name")).toEqual(state.v.string("C"));
  expect(() => state.run("object.__getattribute__(C,'inherited')\n")).toThrow("'type' object has no attribute 'inherited'");
  expect(() => state.run("object.__setattr__(C,'x',True)\n")).toThrow("can't apply this __setattr__ to type object");
  expect(() => state.run("object.__delattr__(C,'x')\n")).toThrow("can't apply this __delattr__ to type object");
});

it("does not invoke getattr fallback during explicit base-object lookup", () => {
  const state = fixture(), cls = state.type("C"); state.globals.set("object", state.registry.object);
  state.method(cls, "__getattr__", "def fallback(self,name):\n visit('fallback')\n return True\n"); state.instance("obj", cls);
  state.run("ordinary=obj.missing\n"); expect(state.globals.get("ordinary")).toBe(state.v.true);
  expect(() => state.run("object.__getattribute__(obj,'missing')\n")).toThrow("'C' object has no attribute 'missing'");
  expect(state.events).toEqual(["fallback"]);
});

it("uses base-object methods for function metadata without losing native policies", () => {
  const state = fixture(); state.globals.set("object", state.registry.object);
  state.run("def f(): pass\nobject.__setattr__(f,'custom',True)\nvalue=object.__getattribute__(f,'custom')\ndictionary=object.__getattribute__(f,'__dict__')\nsame=dictionary is f.__dict__\nobject.__delattr__(f,'custom')\n");
  expect(state.globals.get("value")).toBe(state.v.true); expect(state.globals.get("same")).toBe(state.v.true);
  expect(() => state.run("f.custom\n")).toThrow("'function' object has no attribute 'custom'");
});

it("binds the native subclass hook to the accessed class through class and instance reads", () => {
  const state = fixture(), cls = state.type("C"); state.globals.set("C", cls); state.globals.set("object", state.registry.object); state.instance("obj", cls);
  state.run("root=object.__init_subclass__()\nresult=C.__init_subclass__()\nclass_owner=C.__init_subclass__.__self__ is C\ninstance_owner=obj.__init_subclass__.__self__ is C\nsame=C.__init_subclass__ == obj.__init_subclass__\n");
  expect(state.globals.get("root")).toBe(state.v.none); expect(state.globals.get("result")).toBe(state.v.none);
  for (const name of ["class_owner", "instance_owner", "same"]) expect(state.globals.get(name)).toBe(state.v.true);
  cls.value.names.set("__qualname__", state.v.string("Outer.C"), state.meter);
  expect(() => state.run("C.__init_subclass__(True)\n")).toThrow("Outer.C.__init_subclass__() takes no arguments (1 given)");
  expect(() => state.run("C.__init_subclass__(True,flag=True)\n")).toThrow("Outer.C.__init_subclass__() takes no keyword arguments");
});

it("checks an unbound native class-method receiver before keyword names", () => {
  const state = fixture(), cls = state.type("C"); state.globals.set("C", cls);
  state.globals.set("hook", state.registry.object.value.namespace.items.lookup(state.v.string("__init_subclass__"))!.value);
  expect(() => state.run("hook(None,**{1:True})\n")).toThrow("descriptor '__init_subclass__' for type 'object' needs a type, not a 'NoneType' as arg 2");
  expect(() => state.run("hook(**{1:True})\n")).toThrow("descriptor '__init_subclass__' of 'object' object needs an argument");
  expect(() => state.run("hook(C,**{1:True})\n")).toThrow("keywords must be strings");
});

it("changes an instance's actual class without replacing its dictionary or captured methods", () => {
  const state = fixture(), first = state.type("A"), second = state.type("B");
  state.globals.set("A", first); state.globals.set("B", second);
  state.method(first, "f", "def f(self): return 'A'\n"); state.method(second, "f", "def f(self): return 'B'\n");
  const obj = state.instance("obj", first), dictionary = obj.dictionary;
  state.run("before=obj.__class__ is A\nobj.x=True\ncaptured=obj.f\nobj.__class__=B\nafter=obj.__class__ is B\nold=captured()\nnew=obj.f()\nretained=obj.x\n");
  for (const name of ["before", "after", "retained"]) expect(state.globals.get(name)).toBe(state.v.true);
  expect(state.globals.get("old")).toEqual(state.v.string("A")); expect(state.globals.get("new")).toEqual(state.v.string("B"));
  expect(obj.type).toBe(second); expect(obj.dictionary).toBe(dictionary);
});

it("preserves actual class identity after invalid class changes", () => {
  const state = fixture(), owner = state.type("A"), slots = state.type("S", state.registry.object, { instanceDictionary: false }), obj = state.instance("obj", owner);
  state.globals.set("S", slots); state.globals.set("object", state.registry.object);
  expect(() => state.run("obj.__class__=None\n")).toThrow("__class__ must be set to a class, not 'NoneType' object");
  expect(() => state.run("obj.__class__=S\n")).toThrow("__class__ assignment: 'S' object layout differs from 'A'");
  expect(() => state.run("obj.__class__=object\n")).toThrow("__class__ assignment only supported for mutable types or ModuleType subclasses");
  expect(() => state.run("del obj.__class__\n")).toThrow("can't delete __class__ attribute");
  expect(obj.type).toBe(owner);
});

it("changes compatible mutable metaclasses and wrapper classes while preserving payloads", () => {
  const state = fixture(), meta = state.type("M", state.registry.type), nextMeta = state.type("N", state.registry.type), cls = state.type("C", state.registry.object, {}, meta);
  const base = state.registry.methodDecoratorType("staticmethod"), first = state.type("S", base), second = state.type("T", base), wrapper = state.v.methodDecorator("staticmethod", state.v.true, first);
  state.globals.set("C", cls); state.globals.set("N", nextMeta); state.globals.set("T", second); state.globals.set("wrapper", wrapper);
  state.run("C.__class__=N\nmetaclass=C.__class__ is N\nwrapper.extra=True\nwrapper.__class__=T\nwrapper_class=wrapper.__class__ is T\npayload=wrapper.__func__\nextra=wrapper.extra\n");
  for (const name of ["metaclass", "wrapper_class", "payload", "extra"]) expect(state.globals.get(name)).toBe(state.v.true);
  expect(cls.metaclass).toBe(nextMeta); expect(wrapper.type).toBe(second);
});

it("caches descriptor qualified names while keeping bound native method names live", () => {
  const state = fixture(), cls = allocateRuntimeType(state.v.string("C"), [], state.type("Source").value.namespace, state.registry.type, state.registry, state.v, state.meter);
  state.globals.set("C", cls); state.globals.set("descriptor", cls.value.namespace.items.lookup(state.v.string("__dict__"))!.value); state.globals.set("object", state.registry.object);
  state.run("first=descriptor.__qualname__\nmethod=C.__init_subclass__\nbefore=method.__qualname__\nC.__qualname__='Outer.C'\nafter=method.__qualname__\ncached=descriptor.__qualname__\nsame=first is cached\nwrapper=object.__init__.__qualname__\n");
  expect(state.globals.get("first")).toEqual(state.v.string("C.__dict__")); expect(state.globals.get("before")).toEqual(state.v.string("C.__init_subclass__"));
  expect(state.globals.get("after")).toEqual(state.v.string("Outer.C.__init_subclass__")); expect(state.globals.get("same")).toBe(state.v.true);
  expect(state.globals.get("wrapper")).toEqual(state.v.string("object.__init__"));
});

it("uses metaclass lookup for native qualified names and retries failed descriptor reads", () => {
  const state = fixture(), meta = state.type("Meta", state.registry.type); state.globals.set("type", state.registry.type); state.globals.set("label", state.v.integer(7));
  state.method(meta, "__getattribute__", "def get(self,name):\n if name=='__qualname__':\n  visit('qualname')\n  return label\n return type.__getattribute__(self,name)\n");
  const cls = allocateRuntimeType(state.v.string("C"), [], state.type("Source").value.namespace, meta, state.registry, state.v, state.meter);
  state.globals.set("C", cls); state.globals.set("descriptor", cls.value.namespace.items.lookup(state.v.string("__dict__"))!.value);
  expect(() => state.run("descriptor.__qualname__\n")).toThrow("<descriptor>.__objclass__.__qualname__ is not a unicode object");
  expect(() => state.run("C.__init_subclass__.__qualname__\n")).toThrow("<method>.__class__.__qualname__ is not a unicode object");
  state.run("label='Q'\nfirst=descriptor.__qualname__\nlabel='R'\ncached=descriptor.__qualname__\nlive=C.__init_subclass__.__qualname__\n");
  expect(state.globals.get("first")).toEqual(state.v.string("Q.__dict__")); expect(state.globals.get("cached")).toBe(state.globals.get("first"));
  expect(state.globals.get("live")).toEqual(state.v.string("R.__init_subclass__")); expect(state.events).toEqual(["qualname", "qualname", "qualname", "qualname"]);
});

it("reflects and replaces positional function defaults with live call behavior", () => {
  const state = fixture();
  state.run("def f(a,b=2): return (a,b)\ninitial=f.__defaults__\nreplacement=(10,20,30)\nf.__defaults__=replacement\nsame=f.__defaults__ is replacement\nresult=f()\nf.__defaults__=None\ncleared=f.__defaults__\n");
  expect(state.globals.get("initial")).toEqual(state.v.tuple([state.v.integer(2)])); expect(state.globals.get("same")).toBe(state.v.true);
  expect(state.globals.get("result")).toEqual(state.v.tuple([state.v.integer(20), state.v.integer(30)])); expect(state.globals.get("cleared")).toBe(state.v.none);
  expect(() => state.run("f()\n")).toThrow("missing 2 required positional arguments");
  expect(() => state.run("f.__defaults__=[]\n")).toThrow("__defaults__ must be set to a tuple object");
});

it("exposes explicit function descriptor binding without invoking the body", () => {
  const state = fixture(), owner = state.type("Owner");
  const fn = state.method(owner, "f", "def f(self,x):\n visit('body')\n return x\n");
  state.types.set(fn, state.registry.descriptorType("function"));
  state.instance("instance", owner); state.globals.set("Owner", owner);
  state.run("bound=f.__get__(instance)\nsame=f.__get__(None,Owner) is f\n");
  expect(state.events).toEqual([]); expect(state.globals.get("same")).toBe(state.v.true);
  state.run("result=bound(7)\n"); expect(state.globals.get("result")).toEqual(state.v.integer(7));
  expect(state.events).toEqual(["body"]); expect(fn.kind).toBe("function");
});

it("runs explicit native getset methods through the compiled call path", () => {
  const state = fixture(), owner = state.type("Owner"), descriptor = state.registry.type.value.namespace.items.lookup(state.v.string("__name__"))!.value;
  state.types.set(descriptor, state.registry.descriptorType("getset_descriptor"));
  state.globals.set("slot", descriptor); state.globals.set("Owner", owner);
  state.run("before=slot.__get__(Owner)\nwritten=slot.__set__(Owner,'Renamed')\nafter=slot.__get__(Owner)\nidentity=slot.__get__(None,True) is slot\n");
  expect(state.globals.get("before")).toEqual(state.v.string("Owner")); expect(state.globals.get("after")).toEqual(state.v.string("Renamed"));
  expect(state.globals.get("written")).toBe(state.v.none); expect(state.globals.get("identity")).toBe(state.v.true);
  expect(() => state.run("slot.__delete__(Owner)\n")).toThrow("cannot delete '__name__' attribute of immutable type 'Renamed'");
});

it("uses actual receiver types for explicit native classmethod binding", () => {
  const state = fixture(), owner = state.type("Owner"), descriptor = state.registry.object.value.namespace.items.lookup(state.v.string("__init_subclass__"))!.value;
  state.types.set(descriptor, state.registry.descriptorType("classmethod_descriptor"));
  state.globals.set("slot", descriptor); state.globals.set("Owner", owner); state.instance("instance", owner);
  state.run("bound=slot.__get__(instance)\nreceiver=bound.__self__ is Owner\nresult=bound()\nexplicit=slot.__get__(None,Owner)\nexplicit_receiver=explicit.__self__ is Owner\n");
  expect(state.globals.get("receiver")).toBe(state.v.true); expect(state.globals.get("explicit_receiver")).toBe(state.v.true);
  expect(state.globals.get("result")).toBe(state.v.none);
});

it("shares live keyword-default dictionaries with subsequent calls", () => {
  const state = fixture();
  state.run("def f(*,x=1): return x\ninitial=f.__kwdefaults__\ninitial['x']=2\nchanged=f()\nreplacement={'x':3,'unused':True}\nf.__kwdefaults__=replacement\nsame=f.__kwdefaults__ is replacement\nreplaced=f()\ndel f.__kwdefaults__\ncleared=f.__kwdefaults__\n");
  expect(state.globals.get("changed")).toEqual(state.v.integer(2)); expect(state.globals.get("replaced")).toEqual(state.v.integer(3));
  expect(state.globals.get("same")).toBe(state.v.true); expect(state.globals.get("cleared")).toBe(state.v.none);
  expect(() => state.run("f()\n")).toThrow("missing 1 required keyword-only argument: 'x'");
  expect(() => state.run("f.__kwdefaults__=[]\n")).toThrow("__kwdefaults__ must be set to a dict object");
});

it("retains empty default containers and clears defaults on deletion without reevaluation", () => {
  const state = fixture();
  state.run("payload=[]\nf=lambda a=payload: a\ninitial=f.__defaults__\nsame=f() is payload\nempty=()\nf.__defaults__=empty\nempty_same=f.__defaults__ is empty\ndel f.__defaults__\ncleared=f.__defaults__\ndef g(*,x=payload): return x\nkw={}\ng.__kwdefaults__=kw\nkw_same=g.__kwdefaults__ is kw\n");
  for (const name of ["same", "empty_same", "kw_same"]) expect(state.globals.get(name)).toBe(state.v.true);
  expect(state.globals.get("cleared")).toBe(state.v.none);
  expect(() => state.run("f()\n")).toThrow("missing 1 required positional argument: 'a'");
  expect(() => state.run("g()\n")).toThrow("missing 1 required keyword-only argument: 'x'");
  expect(() => state.run("g.__kwdefaults__=()\n")).toThrow("__kwdefaults__ must be set to a dict object");
  state.run("preserved=g.__kwdefaults__ is kw\n"); expect(state.globals.get("preserved")).toBe(state.v.true);
});

it("runs automatically class-bound subclass hooks with the newly allocated class", () => {
  const state = fixture(), source = state.type("Source");
  state.method(source, "__init_subclass__", "def initialize(cls,*,flag):\n cls.received=flag\n");
  const base = allocateRuntimeType(state.v.string("Base"), [], source.value.namespace, state.registry.type, state.registry, state.v, state.meter), empty = state.type("Empty").value.namespace;
  const cls = allocateRuntimeType(state.v.string("C"), [base], empty, state.registry.type, state.registry, state.v, state.meter), keywords = state.type("Keywords").value.namespace;
  keywords.items.set(state.v.string("flag"), state.v.integer(7)); state.globals.set("C", cls);
  state.globals.set("finish", state.v.builtinFunction({ name: "finish", invoke(_args, _keywords, _meter, invocation) {
    if (!invocation) throw Error("expected invocation");
    finalizeRuntimeType(cls, keywords, { typeOf: value => state.types.get(value) ?? state.registry.object, slots: () => undefined }, state.v, state.meter, { call: invocation.call, repr() { throw Error("unexpected repr"); } }); return state.v.none;
  } }));
  state.run("finish()\nresult=C.received\n"); expect(state.globals.get("result")).toEqual(state.v.integer(7));
});

it("assigns and deletes class attributes without mutating inherited namespaces", () => {
  const state = fixture(), base = state.type("Base"), owner = state.type("C", base); state.globals.set("C", owner); state.globals.set("Base", base);
  base.value.namespace.items.set(state.v.string("value"), state.v.integer(1));
  state.run("C.value=2\nown=C.value\nbase=Base.value\ndel C.value\ninherited=C.value\n");
  expect(state.globals.get("own")).toEqual(state.v.integer(2)); expect(state.globals.get("base")).toEqual(state.v.integer(1)); expect(state.globals.get("inherited")).toEqual(state.v.integer(1));
  expect(() => state.run("del C.value\n")).toThrow("type object 'C' has no attribute 'value'");
});

it("shares class mutation behavior between attribute syntax and builtins", () => {
  const state = fixture(), owner = state.type("C"); state.globals.set("C", owner);
  state.globals.set("setattr", createAttributeMutationBuiltin("setattr", state.v, state.meter)); state.globals.set("delattr", createAttributeMutationBuiltin("delattr", state.v, state.meter));
  state.run("setattr(C,'value',7)\nresult=C.value\ndelattr(C,'value')\n"); expect(state.globals.get("result")).toEqual(state.v.integer(7));
  expect(owner.value.namespace.items.lookup(state.v.string("value"))).toBeUndefined();
});

it("invokes metaclass mutation overrides without pre-reading and discards their results", () => {
  const state = fixture(), meta = state.type("Meta", state.registry.type), owner = state.type("C", state.registry.object, {}, meta); state.globals.set("C", owner);
  state.globals.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw Error("must not read class attribute"); } }));
  state.method(meta, "__getattribute__", "def attribute(cls,name):\n return fail()\n");
  state.method(meta, "__setattr__", "def write(cls,name,value):\n visit(name)\n visit(value)\n return 7\n");
  state.method(meta, "__delattr__", "def remove(cls,name):\n visit(name)\n return 9\n");
  state.run("C.value='payload'\ndel C.value\n"); expect(state.events).toEqual(["value", "payload", "value"]);
  expect(owner.value.namespace.items.lookup(state.v.string("value"))).toBeUndefined();
});

it("mutates metaclass data descriptors without invoking their getters", () => {
  const state = fixture(), meta = state.type("Meta", state.registry.type), owner = state.type("C", state.registry.object, {}, meta); state.globals.set("C", owner);
  meta.value.namespace.items.set(state.v.string("value"), state.v.getsetDescriptor({ owner: meta, name: "value", accepts: value => value === owner, get() { throw Error("must not get"); }, set(_receiver, value) { expect(value).toEqual(state.v.integer(9)); state.events.push("set"); }, delete() { state.events.push("delete"); } }));
  owner.value.namespace.items.set(state.v.string("value"), state.v.integer(7));
  state.run("C.value=9\ndel C.value\n"); expect(state.events).toEqual(["set", "delete"]); expect(owner.value.namespace.items.lookup(state.v.string("value"))?.value).toEqual(state.v.integer(7));
});

it("replaces descriptors stored on the class without invoking their setters", () => {
  const state = fixture(), owner = state.type("C"); state.globals.set("C", owner);
  owner.value.namespace.items.set(state.v.string("value"), state.v.getsetDescriptor({ owner, name: "value", accepts: () => true, get() { throw Error("must not get"); }, set() { throw Error("must not set descriptor"); }, delete() { throw Error("must not delete descriptor"); } }));
  state.run("C.value=7\nresult=C.value\ndel C.value\n"); expect(state.globals.get("result")).toEqual(state.v.integer(7));
});

it.each(["object", "type"] as const)("rejects assignment and deletion on immutable builtin %s", name => {
  const state = fixture(); state.globals.set("target", state.registry[name]);
  for (const source of ["target.value=7\n", "del target.value\n"]) expect(() => state.run(source)).toThrow(`cannot set 'value' attribute of immutable type '${name}'`);
});

it.each(["__mro__", "__dict__"])("preserves read-only class metadata %s", name => {
  const state = fixture(); state.globals.set("C", state.type("C"));
  for (const source of [`C.${name}=None\n`, `del C.${name}\n`]) expect(() => state.run(source)).toThrow(`attribute '${name}' of 'type' objects is not writable`);
});

it.each(["__setattr__", "__delattr__"])("rejects disabled metaclass mutation slot %s", slot => {
  const state = fixture(), meta = state.type("Meta", state.registry.type), owner = state.type("C", state.registry.object, {}, meta); state.globals.set("C", owner);
  meta.value.namespace.items.set(state.v.string(slot), state.v.none);
  expect(() => state.run(slot === "__setattr__" ? "C.value=7\n" : "del C.value\n")).toThrow("'NoneType' object is not callable");
});
