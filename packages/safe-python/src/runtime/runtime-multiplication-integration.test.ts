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

it.each([false, true])("binds class descriptors and compares their values for reflected priority (%s)", overridden => {
  const state = fixture(), base = state.type("Base"), derived = state.type("Derived", base), v = state.v;
  state.method(base, "__mul__", "def multiply(self, other):\n visit('forward')\n return 'forward'\n");
  const baseMethod = state.method(base, "__rmul__", "def reflect(self, other):\n return 'base'\n");
  const derivedMethod = state.method(derived, "__rmul__", "def reflect(self, other):\n visit('reflected')\n return 'reflected'\n");
  const a = v.cell({}), b = v.cell({}), descriptorA = v.cell({}), descriptorB = v.cell({});
  base.value.namespace.items.set(v.string("__rmul__"), descriptorA);
  derived.value.namespace.items.set(v.string("__rmul__"), descriptorB);
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
  state.run("result=left * right\n");
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
