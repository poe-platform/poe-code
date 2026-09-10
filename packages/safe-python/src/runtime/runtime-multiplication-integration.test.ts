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
    executeRuntimeProgram(code, { values: v, globals, builtins, keys, hooks, calls: new CallStack<object>(50, meter) }, meter);
    const functionName = code.functions.values().next().value!.name;
    if (functionName.kind !== "str") throw Error("expected function name");
    const value = globals.get(String.fromCodePoint(...functionName.value))!;
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
