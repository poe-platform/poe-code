import { expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { createFunctionState } from "./function-state.js";
import { executeRuntimeProgram, type RuntimeProgramHooks } from "./runtime-program.js";
import { RuntimeValues, type RuntimeValue, type TypeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout, type RuntimeTypeLayoutOptions } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { createRepresentationBuiltin } from "./builtin-representation.js";
import { createSumBuiltin } from "./builtin-sum.js";
import { CallStack } from "./call-stack.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), types = new Map<RuntimeValue, TypeValue>();
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
  function type(name: string, base = registry.object, options: RuntimeTypeLayoutOptions = {}): TypeValue {
    return registry.publish(new RuntimeTypeLayout(name, [base.value], v.dictionary(new OrderedKeyMap(keys, meter)), meter, options), registry.type);
  }
  function method(owner: TypeValue, name: string, source: string) {
    const code = compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, v, meter);
    const value = v.function(createFunctionState(code.functions.values().next().value!, new Map(), { globals, builtins, none: v.none }, meter));
    owner.value.namespace.items.set(v.string(name), value); return value;
  }
  function guest(name: string, owner: TypeValue) { const value = v.cell({}); types.set(value, owner); globals.set(name, value); return value; }
  function run(source: string) {
    const program = compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, v, meter);
    executeRuntimeProgram(program, { values: v, globals, builtins, keys, hooks, calls: new CallStack<object>(50, meter) }, meter);
  }
  return { v, meter, globals, events, hooks, type, method, guest, run };
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
