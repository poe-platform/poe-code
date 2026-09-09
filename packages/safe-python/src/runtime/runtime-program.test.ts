import { describe, expect, it } from "vitest";
import { executeRuntimeProgram, type RuntimeProgramHooks } from "./runtime-program.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { compileProgram } from "./program-compilation.js";
import { analyzeModule } from "../analysis.js";
import { CallStack } from "./call-stack.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { UnsupportedStatementError } from "./statement-execution.js";
import { ModuleFrame, type LocalNamespace } from "./module-frame.js";
import { createLenBuiltin } from "./builtin-len.js";
import { resolveRuntimeClassAttribute } from "./runtime-descriptor.js";
import { readInstanceAttribute } from "./instance-attributes.js";
import { RuntimeDictionaryNamespace } from "./runtime-dictionary-namespace.js";
import { OrderedKeyMap } from "./ordered-key-map.js";

function fixture(source: string, maxSteps = 100000, signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps, maxAllocatedBytes: 1000000, signal }), values = new RuntimeValues(meter);
  const program = compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, values, meter);
  const globals = new Map<string, RuntimeValue>(), builtins = new Map<string, RuntimeValue>(), calls = new CallStack<object>(50, meter);
  const hash = { none: values.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, values, meter).value };
  const unused = (): never => { throw new Error("unimplemented object hook"); };
  const hooks: RuntimeProgramHooks = {
    expressions: () => ({ attribute: unused, beginSet: unused, warn: unused }),
    statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: statement => { throw new UnsupportedStatementError(statement.kind); } }),
    callable: () => false, invoke: unused, name: () => "function()",
    keywordName: key => { if (key.kind !== "str") return unused(); return String.fromCodePoint(...key.value); }
  };
  return { values, meter, globals, builtins, calls, hooks, keys, run: (locals?: LocalNamespace<RuntimeValue>) => executeRuntimeProgram(program, { globals, builtins, locals, calls, values, keys, hooks }, meter) };
}

describe("assembled concrete runtime programs", () => {
  it("uses native list methods through ordinary compiled calls", () => {
    const state = fixture("def f(a):\n a.append(3)\n a.extend(a)\n a.insert(-1, 9)\n a.remove(1)\n b = a.copy()\n b.reverse()\n return a.count(2), b.pop(), a\nresult = f([1, 2])\n");
    state.hooks.expressions = () => ({ warn() {} }); state.run();
    expect(state.globals.get("result")).toEqual(state.values.tuple([state.values.integer(2), state.values.integer(2), state.values.list([2, 3, 1, 2, 9, 3].map(n => state.values.integer(n)))]));
    const result = state.globals.get("result"); if (result?.kind !== "tuple" || result.items[2].kind !== "list") throw new Error("expected list result");
    expect(result.items[2].items.snapshot()).toEqual([2, 3, 1, 2, 9, 3].map(n => state.values.integer(n)));
  });
  it("constructs native set displays and unpackings without a construction hook", () => {
    const state = fixture("def f():\n return {True, 1, *[2, 2], *{'x': 3}}\ns = f()\ns.add(4)\nresult = s == {1, 2, 'x', 4}\n");
    state.hooks.expressions = () => ({ warn() {} });
    state.run(); expect(state.globals.get("result")).toBe(state.values.true);
    const s = state.globals.get("s"); if (s?.kind !== "set") throw new Error("expected set");
    expect(s.items.size).toBe(4);
  });
  it("stops set unpacking on an unhashable element without publishing the set", () => {
    const state = fixture("result = {0, *source}\nafter = 1\n"), iterator = [state.values.integer(1), state.values.list([]), state.values.integer(2)][Symbol.iterator]();
    state.hooks.expressions = () => ({ warn() {} });
    state.globals.set("source", state.values.iterator(iterator));
    expect(state.run).toThrow("unhashable type: 'list'");
    expect(state.globals.has("result")).toBe(false); expect(state.globals.has("after")).toBe(false);
    expect(iterator.next().value).toEqual(state.values.integer(2));
  });
  it("retains explicit set construction policies", () => {
    const state = fixture("result = {1}\n");
    state.hooks.expressions = () => ({ warn() {}, beginSet(initial) {
      expect(initial).toEqual([state.values.integer(1)]);
      return { add() { throw new Error("unused"); }, update() { throw new Error("unused"); }, finish: () => state.values.true };
    } });
    state.run(); expect(state.globals.get("result")).toBe(state.values.true);
  });
  it("resolves native dictionary, proxy and view attributes without object hooks", () => {
    const state = fixture("d = {'a': 1}\nd.update(b=2)\nk = d.keys()\np = k.mapping\nresult = p.get('b')\ncommon = k.isdisjoint(['z'])\nc = p.copy()\nc.clear()\n");
    state.hooks.expressions = () => ({ beginSet() { throw new Error("unused"); }, warn() {} });
    state.run();
    expect(state.globals.get("result")).toEqual(state.values.integer(2));
    expect(state.globals.get("common")).toBe(state.values.true);
    const d = state.globals.get("d"), c = state.globals.get("c");
    if (d?.kind !== "dict" || c?.kind !== "dict") throw new Error("expected dictionaries");
    expect(d.items.size).toBe(2); expect(c.items.size).toBe(0);
  });
  it("resolves native set methods from compiled function bodies", () => {
    const state = fixture("def f(s):\n s.add(2)\n return s.union([3]).difference([1])\nresult = f(s)\ncopy = frozen.copy()\n");
    state.hooks.expressions = () => ({ beginSet() { throw new Error("unused"); }, warn() {} });
    const items = new OrderedKeyMap<RuntimeValue, RuntimeValue>(state.keys, state.meter);
    items.set(state.values.integer(1), state.values.none);
    const frozen = state.values.frozenSet(items.copy());
    state.globals.set("s", state.values.set(items)); state.globals.set("frozen", frozen);
    state.run();
    const result = state.globals.get("result");
    if (result?.kind !== "set") throw new Error("expected set");
    expect(result.items.containsKey(state.values.integer(2))).toBe(true);
    expect(result.items.containsKey(state.values.integer(3))).toBe(true);
    expect(result.items.size).toBe(2); expect(state.globals.get("copy")).toBe(frozen);
  });
  it.each(["d.items.storage", "d.storage", "d.keys().mapping.clear"])("rejects unavailable native attributes: %s", expression => {
    const state = fixture(`d = {}\nresult = ${expression}\n`);
    state.hooks.expressions = () => ({ beginSet() { throw new Error("unused"); }, warn() {} });
    expect(state.run).toThrow(expect.objectContaining({ name: "AttributeError" }));
    expect(state.globals.has("result")).toBe(false);
  });
  it("keeps extracted native methods bound to their original receiver", () => {
    const state = fixture("d = {'a': 1}\nget = d.get\nd = {'a': 9}\nresult = get('a')\n");
    state.hooks.expressions = () => ({ beginSet() { throw new Error("unused"); }, warn() {} });
    state.run(); expect(state.globals.get("result")).toEqual(state.values.integer(1));
  });
  it("preserves explicit attribute policies even for native method names", () => {
    const state = fixture("result = {}.get\n");
    state.hooks.expressions = () => ({ attribute: () => state.values.true, beginSet() { throw new Error("unused"); }, warn() {} });
    state.run(); expect(state.globals.get("result")).toBe(state.values.true);
  });
  it.each([
    "def outer(a):\n def inner(b):\n  return a + b + token\n return inner\n",
    "def outer(a):\n return lambda b: a + b + token\n",
    "def outer(a):\n def make(x):\n  return lambda y: x + y + token\n return make(a)\n",
    "def outer(a):\n def deco(fn):\n  return lambda b: fn(b) + a\n @deco\n def inner(b): return b + token\n return inner\n",
    "def outer(a):\n def inner(b, fn=lambda x: x + token):\n  return a + fn(b)\n return inner\n"
  ])("retains definition ownership across separate compiled programs: %s", source => {
    const state = fixture(source); state.globals.set("token", state.values.integer(10)); state.run();
    const globals = new Map<string, RuntimeValue>([["outer", state.globals.get("outer")!], ["token", state.values.integer(99)]]);
    const caller = compileProgram<RuntimeValue>(analyzeModule("f = outer(2)\nresult = f(3)\n"), { stripDocstring: false }, state.values, state.meter);
    executeRuntimeProgram(caller, { ...state, globals }, state.meter);
    expect(globals.get("result")).toEqual(state.values.integer(15));
    expect(state.globals.has("f")).toBe(false); expect(state.calls.depth).toBe(0);
  });
  it("retains originating code through a bound method invoked by another program", () => {
    const state = fixture("def outer(self):\n return lambda b: self[0] + b + token\n");
    state.globals.set("token", state.values.integer(10)); state.run();
    const fn = state.globals.get("outer"); if (fn?.kind !== "function") throw new Error("expected function");
    const globals = new Map<string, RuntimeValue>([["method", state.values.boundMethod(fn, state.values.list([state.values.integer(2)]))]]);
    const caller = compileProgram<RuntimeValue>(analyzeModule("f = method()\nresult = f(3)\n"), { stripDocstring: false }, state.values, state.meter);
    executeRuntimeProgram(caller, { ...state, globals }, state.meter);
    expect(globals.get("result")).toEqual(state.values.integer(15)); expect(state.calls.depth).toBe(0);
  });
  it("executes against live Python dictionary locals without leaking them into function globals", () => {
    const state = fixture("x = 2\ndef f():\n return x\nresult = f()\ndel x\n");
    const dictionary = state.values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(state.keys, state.meter));
    state.globals.set("x", state.values.integer(9));
    state.run(new RuntimeDictionaryNamespace(dictionary, state.values, state.meter));
    expect(dictionary.items.lookup(state.values.string("result"))?.value).toEqual(state.values.integer(9));
    expect(dictionary.items.lookup(state.values.string("x"))).toBeUndefined();
    expect(dictionary.items.lookup(state.values.string("f"))?.value.kind).toBe("function");
    expect(state.globals.has("result")).toBe(false); expect(state.calls.depth).toBe(0);
  });
  it("calls methods produced by default function-descriptor lookup", () => {
    const state = fixture("def f(self, x=2):\n return self[0] + x\ninstance = [10]\nresult = instance.method(3)\n");
    state.hooks.expressions = () => ({
      attribute(instance, name) {
        expect(name).toBe("method"); const fn = state.globals.get("f")!;
        const attribute = resolveRuntimeClassAttribute(fn, { slots: () => undefined }, state.values, state.meter);
        return readInstanceAttribute(instance, state.values.integer(1), attribute, () => undefined, state.meter)!.value;
      },
      beginSet() { throw new Error("unused"); }, warn() { throw new Error("unused"); }
    });
    state.run(); expect(state.globals.get("result")).toEqual(state.values.integer(13));
  });
  it("prepends the bound instance before function argument binding", () => {
    const state = fixture("def f(self, x=2, **kw):\n return self[0] + x + kw['y']\nm = bind(f, [10])\nresult = m(y=3)\n");
    state.builtins.set("bind", state.values.builtinFunction({ name: "bind", invoke(positional) {
      const fn = positional[0]; if (fn.kind !== "function") throw new Error("function expected");
      return state.values.boundMethod(fn, positional[1]);
    } }));
    state.run(); expect(state.globals.get("result")).toEqual(state.values.integer(15)); expect(state.calls.depth).toBe(0);
  });
  it("does not publish a builtin result after its capability cancels execution", () => {
    const controller = new AbortController(), state = fixture("result = native()\nafter = 1\n", 100000, controller.signal);
    state.builtins.set("native", state.values.builtinFunction({ name: "native", invoke() { controller.abort(); return state.values.true; } }));
    expect(state.run).toThrow(ExecutionLimitError); expect(state.globals.has("result")).toBe(false); expect(state.globals.has("after")).toBe(false); expect(state.calls.depth).toBe(0);
  });
  it("stops between error-formatting callbacks after cancellation", () => {
    const controller = new AbortController(), state = fixture("def f():\n pass\nf(**{'x': 1}, **{'x': 2})\n", 100000, controller.signal);
    let formatted = false;
    state.hooks.name = () => { controller.abort(); return "f()"; };
    state.hooks.keywordName = () => { formatted = true; return "x"; };
    expect(state.run).toThrow(ExecutionLimitError); expect(formatted).toBe(false); expect(state.calls.depth).toBe(0);
  });
  it("runs registered len calls inside guest functions and formats expansion errors", () => {
    const state = fixture("def f(x):\n return len(x)\nresult = f({'a': 1, 'b': 2})\nlen(*1)\n");
    state.builtins.set("len", createLenBuiltin(state.values, state.meter));
    expect(state.run).toThrow("len() argument after * must be an iterable, not int");
    expect(state.globals.get("result")).toEqual(state.values.integer(2)); expect(state.calls.depth).toBe(0);
  });
  it("invokes explicitly registered builtins with their retained method owner", () => {
    const state = fixture("result = native(3, x=4)\n");
    const capability = { name: "native", result: state.values.integer(7), invoke(positional: readonly RuntimeValue[]) { expect(positional).toEqual([state.values.integer(3)]); return this.result; } };
    state.builtins.set("native", state.values.builtinFunction(capability));
    state.run(); expect(state.globals.get("result")).toBe(capability.result); expect(state.calls.depth).toBe(0);
  });
  it("keeps separate module locals out of function global lookup", () => {
    const state = fixture("x = 2\ndef f():\n return x\nresult = f()\n"), locals = new Map<string, RuntimeValue>();
    state.globals.set("x", state.values.integer(1));
    state.run({ lookup: name => locals.has(name) ? { value: locals.get(name)! } : undefined, store: (name, value) => { locals.set(name, value); }, delete: name => locals.delete(name), isGuest: () => false });
    expect(locals.get("x")).toEqual(state.values.integer(2)); expect(locals.get("result")).toEqual(state.values.integer(1));
    expect(state.globals.has("f")).toBe(false); expect(state.globals.get("x")).toEqual(state.values.integer(1));
  });
  it("runs modules, nested definitions, lambdas and dictionary kwargs together", () => {
    const state = fixture("def outer(x):\n def f(a=1, **kw):\n  return x + a + kw['b']\n return lambda y: f(y, **{'b': 3})\nf = outer(10)\nresult = f(2)\n"); state.run();
    expect(state.globals.get("result")).toEqual(state.values.integer(15)); expect(state.calls.depth).toBe(0);
  });
  it("uses each function's captured builtins when defining nested functions", () => {
    const state = fixture("__builtins__ = {'token': 1}\ndef outer():\n def inner():\n  return token\n return inner\n__builtins__ = {'token': 2}\ndel __builtins__\nf = outer()\nresult = f()\n");
    state.builtins.set("token", state.values.integer(3));
    state.hooks.resolveBuiltins = value => {
      if (value.kind !== "dict") throw new Error("dictionary expected");
      return new RuntimeDictionaryNamespace(value, state.values, state.meter);
    };
    state.run(); expect(state.globals.get("result")).toEqual(state.values.integer(1));
  });
  it("preserves hook method owners while supplying the active frame", () => {
    const state = fixture("sink.value = 3\nresult = sink.value\n"), frames: string[] = [];
    state.globals.set("sink", state.values.none);
    const object = { value: state.values.integer(0) as RuntimeValue };
    state.hooks.expressions = frame => {
      frames.push(frame instanceof ModuleFrame ? "module" : frame.scope.scope.kind);
      return { object, attribute() { return this.object.value; }, beginSet() { throw new Error("unused"); }, warn() { throw new Error("unused"); } };
    };
    state.hooks.statements = () => ({ object, setAttribute(_receiver, _name, value) { this.object.value = value; }, deleteAttribute() { throw new Error("unused"); }, executeUnhandled() { throw new Error("unused"); } });
    state.run(); expect(state.globals.get("result")).toEqual(state.values.integer(3)); expect(frames).toEqual(["module"]);
  });
  it("delegates non-function call capabilities without implicit host calls", () => {
    const state = fixture("result = native(3)\n"); state.globals.set("native", state.values.true);
    state.hooks.callable = value => value === state.values.true;
    state.hooks.invoke = (callee, positional, keywords, frame) => {
      expect(callee).toBe(state.values.true); expect(keywords.items.size).toBe(0); expect(frame).toBeInstanceOf(ModuleFrame);
      return positional[0];
    };
    state.run(); expect(state.globals.get("result")).toEqual(state.values.integer(3));
  });
  it("keeps unsupported leaves explicit and restores frames on failure", () => {
    const state = fixture("x = 1\ndef f():\n import unavailable\nf()\n");
    expect(state.run).toThrow(UnsupportedStatementError); expect(state.globals.get("x")).toEqual(state.values.integer(1)); expect(state.calls.depth).toBe(0);
  });
  it("shares fatal budgets across execution and stops after hook cancellation", () => {
    const loop = fixture("while True:\n pass\n", 1000); expect(loop.run).toThrow(ExecutionLimitError); expect(loop.calls.depth).toBe(0);
    const controller = new AbortController(), state = fixture("result = 1\n", 100000, controller.signal);
    let statements = false;
    state.hooks.expressions = () => { controller.abort(); return { attribute() { throw new Error("unused"); }, beginSet() { throw new Error("unused"); }, warn() { throw new Error("unused"); } }; };
    state.hooks.statements = () => { statements = true; throw new Error("must not run"); };
    expect(state.run).toThrow(ExecutionLimitError); expect(statements).toBe(false); expect(state.calls.depth).toBe(0);
  });
});
