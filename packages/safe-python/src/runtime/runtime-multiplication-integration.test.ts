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
    specialMethods: () => ({ typeOf(value) { const type = types.get(value); if (!type) throw Error(`unexpected type lookup: ${value.kind}`); return type; }, slots: () => undefined }),
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
  const state = fixture(), owner = state.type("C"), nativeType = state.type("builtin_function_or_method");
  const resolve = state.hooks.specialMethods!;
  state.hooks.specialMethods = frame => { const original = resolve(frame); return { ...original, typeOf: value => value.kind === "builtin_function_or_method" ? nativeType : original.typeOf(value) }; };
  owner.value.namespace.items.set(state.v.string("native"), state.v.methodDescriptor({ owner, name: "native", accepts: () => true, invoke: () => state.v.none }));
  state.instance("instance", owner); state.instance("other", owner);
  state.run("equal=instance.native==instance.native\nunequal=instance.native!=other.native\ndistinct=instance.native is not instance.native\nitems={instance.native:1,instance.native:2}\nresult=items[instance.native]\n");
  expect(state.globals.get("equal")).toBe(state.v.true); expect(state.globals.get("unequal")).toBe(state.v.true); expect(state.globals.get("distinct")).toBe(state.v.true);
  expect(state.globals.get("result")).toEqual(state.v.integer(2));
  const items = state.globals.get("items"); if (items?.kind !== "dict") throw Error("expected dictionary"); expect(items.items.size).toBe(1);
});
