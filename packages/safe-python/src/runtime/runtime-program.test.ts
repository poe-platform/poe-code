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
import { createPowBuiltin } from "./builtin-pow.js";
import { resolveRuntimeClassAttribute } from "./runtime-descriptor.js";
import { readInstanceAttribute } from "./instance-attributes.js";
import { RuntimeDictionaryNamespace } from "./runtime-dictionary-namespace.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { protocolTruth, type TruthProtocolContext } from "./truth-protocol.js";
import { runtimeTruth } from "./runtime-truth.js";
import type { ContainmentContext } from "./containment-protocol.js";
import type { IterationContext } from "./protocol-iterator.js";
import { PythonRuntimeError } from "./error.js";
import type { LengthHintContext } from "./length-hint.js";

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
  it.each(["success", "next-error", "hint-error"])("collects guest slice replacements with cursor hints (%s)", mode => {
    const state = fixture("items=[0,1,2]\nitems[1:]=guest\n"), v = state.values;
    const guest = v.cell({}), cursor = v.cell({}), events: string[] = [];
    const stop = new PythonRuntimeError("StopIteration", "done"), failure = new PythonRuntimeError("ValueError", "collection failed"); let index = 0;
    const iteration: IterationContext<RuntimeValue> = {
      lookupIter: value => () => { events.push(value === guest ? "source iter" : "cursor iter"); return cursor; },
      hasNext: value => value === cursor,
      next() { events.push("next"); if (index++ === 0) return v.integer(9); if (mode === "next-error") throw failure; throw stop; },
      hasSequenceItem: () => false, getItem() { throw Error("unexpected item"); },
      isStopIteration: error => error === stop, isIndexError: () => false, typeName: () => "Guest",
      hints: {
        length: value => { expect(value).toBe(cursor); return undefined; },
        lookupHint: () => () => { events.push("hint"); if (mode === "hint-error") throw failure; return v.integer(0); },
        integer: value => value.kind === "int" ? value.value : undefined,
        isNotImplemented: value => value === v.notImplemented, isTypeError: () => false, typeName: () => "Guest"
      }
    };
    state.globals.set("guest", guest); state.hooks.expressions = () => ({ warn() {}, iteration });
    if (mode === "success") state.run(); else expect(() => state.run()).toThrow(failure);
    const items = state.globals.get("items"); if (items?.kind !== "list") throw Error("expected list");
    expect(items.items.snapshot()).toEqual((mode === "success" ? [0,9] : [0,1,2]).map(value => v.integer(value)));
    expect(events).toEqual(mode === "hint-error" ? ["source iter", "cursor iter", "hint"] : ["source iter", "cursor iter", "hint", "next", "next"]);
  });
  it.each([
    ["items[guest]=9", [0,9,2], 1], ["del items[guest]", [0,2], 1],
    ["items[guest]+=9", [0,10,2], 2],
    ["items[guest:]=[9]", [0,9], 1], ["del items[guest:]", [0], 1]
  ] as const)("converts guest indices for %s", (operation, expected, count) => {
    const state = fixture(`items=[0,1,2]\n${operation}\n`), v = state.values; let calls = 0;
    state.globals.set("guest", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, integerIndex: {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", typeName: () => "Index", warn() {},
      lookupIndex: () => () => { calls++; return v.integer(1); }
    } });
    state.run();
    expect(calls).toBe(count);
    const items = state.globals.get("items"); if (items?.kind !== "list") throw Error("expected list");
    expect(items.items.snapshot()).toEqual(expected.map(value => v.integer(value)));
  });
  it.each(["[0,1,2,3]", "(0,1,2,3)", "'abcd'", "b'abcd'"])("converts guest slice components in Python order for %s", source => {
    const state = fixture(`items=${source}\nresult=items[start:stop:step]\nexpected=items[0:3:2]\n`), v = state.values;
    const start = v.cell({}), stop = v.cell({}), step = v.cell({}), events: string[] = [];
    state.globals.set("start", start); state.globals.set("stop", stop); state.globals.set("step", step);
    state.hooks.expressions = () => ({ warn() {}, integerIndex: {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", typeName: () => "Index", warn() {},
      lookupIndex: value => () => { events.push(value === start ? "start" : value === stop ? "stop" : "step"); return v.integer(value === start ? 0 : value === stop ? 3 : 2); }
    } });
    state.run();
    expect(events).toEqual(["step", "start", "stop"]);
    expect(state.globals.get("result")).toEqual(state.globals.get("expected"));
  });
  it.each(["[False,True]", "(False,True)", "'ab'", "b'ab'"])("subscribes to %s using a guest index", source => {
    const state = fixture(`items=${source}\nresult=items[guest]\nexpected=items[1]\n`), v = state.values;
    state.globals.set("guest", v.cell({})); let calls = 0;
    state.hooks.expressions = () => ({ warn() {}, integerIndex: {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", typeName: () => "Index", warn() {},
      lookupIndex: () => () => { calls++; return v.integer(-1); }
    } });
    state.run();
    expect(calls).toBe(1);
    expect(state.globals.get("result")).toEqual(state.globals.get("expected"));
  });
  it.each(["insert", "pop"])("converts guest %s indices before observing current list storage", method => {
    const state = fixture(`items=[False,True]\nresult=items.${method}(guest${method === "insert" ? ",False" : ""})\n`), v = state.values;
    state.globals.set("guest", v.cell({})); let calls = 0;
    state.hooks.expressions = () => ({ warn() {}, integerIndex: {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", typeName: () => "Index", warn() {},
      lookupIndex: () => () => {
        calls++;
        const items = state.globals.get("items"); if (items?.kind !== "list") throw Error("expected list");
        items.items.pop(0n);
        return v.integer(0);
      }
    } });
    state.run();
    expect(calls).toBe(1);
    expect(state.globals.get("result")).toBe(method === "pop" ? v.true : v.none);
    const items = state.globals.get("items"); if (items?.kind !== "list") throw Error("expected list");
    expect(items.items.snapshot()).toEqual(method === "pop" ? [] : [v.false, v.true]);
  });
  it.each(["[False,True,True]", "(False,True,True)"])("converts guest search bounds left to right: %s", source => {
    const state = fixture(`items=${source}\nresult=items.index(True,start,stop)\n`), v = state.values;
    const start = v.cell({}), stop = v.cell({}), events: string[] = [];
    state.globals.set("start", start); state.globals.set("stop", stop);
    state.hooks.expressions = () => ({ warn() {}, integerIndex: {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", typeName: () => "Bound", warn() {},
      lookupIndex: value => () => { events.push(value === start ? "start" : "stop"); return v.integer(value === start ? 1n : 1n << 100n); }
    } });
    state.run();
    expect(state.globals.get("result")).toBe(v.integer(1));
    expect(events).toEqual(["start", "stop"]);
  });
  it.each([["list", "count"], ["list", "index"], ["list", "remove"], ["tuple", "count"], ["tuple", "index"]])("uses guest equality and truth for %s.%s", (kind, method) => {
    const state = fixture(`items=${kind === "tuple" ? "(a,a)" : "[a,a]"}\nresult=items.${method}(b)\n`), v = state.values;
    const a = v.cell({}), b = v.cell({}), truth = v.cell({}), events: string[] = [];
    state.globals.set("a", a); state.globals.set("b", b);
    state.hooks.expressions = () => ({ warn() {}, richComparison(operator, left, right) {
      expect([operator, left, right]).toEqual(["==", a, b]); events.push("equal");
      return { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented, forward: () => truth, reflected: () => { throw Error("unexpected reflected comparison"); } } };
    }, truth(value) { expect(value).toBe(truth); events.push("truth"); return true; } });
    state.run();
    expect(state.globals.get("result")).toEqual(method === "count" ? v.integer(2) : method === "index" ? v.integer(0) : v.none);
    expect(events).toEqual(method === "count" ? ["equal", "truth", "equal", "truth"] : ["equal", "truth"]);
  });
  it("keeps list removal tied to the current numeric index after guest equality mutates storage", () => {
    const state = fixture("items=[a,b]\nresult=items.remove(target)\n"), v = state.values;
    state.globals.set("a", v.cell({})); state.globals.set("b", v.cell({})); state.globals.set("target", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, richComparison() {
      return { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented, forward() {
        const items = state.globals.get("items"); if (items?.kind !== "list") throw Error("expected list");
        items.items.pop(0n); return v.true;
      }, reflected: () => v.notImplemented } };
    } });
    state.run();
    const items = state.globals.get("items"); if (items?.kind !== "list") throw Error("expected list");
    expect(items.items.length).toBe(0);
  });
  it.each([
    ["success", false], ["hint-error", false], ["next-error", false],
    ["success", true], ["hint-error", true], ["next-error", true]
  ] as const)("extends lists through guest iteration and source hints (%s, method=%s)", (mode, method) => {
    const state = fixture(`x=[0]\nalias=x\n${method ? "result=x.extend(guest)" : "x += guest"}\n`), v = state.values, guest = v.cell({}), cursor = v.cell({}), events: string[] = [];
    const stop = new PythonRuntimeError("StopIteration", "done"), failure = new PythonRuntimeError("ValueError", "extension failed");
    let index = 0;
    const iteration: IterationContext<RuntimeValue> = {
      lookupIter: value => { expect(value).toBe(guest); return () => { events.push("iter"); return cursor; }; },
      hasNext: value => value === cursor,
      next() { events.push("next"); if (index++ === 0) return v.integer(1); if (mode === "next-error") throw failure; throw stop; },
      hasSequenceItem: () => false, getItem: () => { throw Error("unexpected item"); },
      isStopIteration: error => error === stop, isIndexError: () => false, typeName: () => "Guest",
      hints: {
        length: value => { expect(value).toBe(guest); events.push("length"); return undefined; },
        lookupHint: value => { expect(value).toBe(guest); return () => { events.push("hint"); if (mode === "hint-error") throw failure; return v.integer(8); }; },
        integer: value => value.kind === "int" ? value.value : undefined,
        isNotImplemented: value => value === v.notImplemented, isTypeError: () => false, typeName: () => "Guest"
      }
    };
    state.globals.set("guest", guest); state.hooks.expressions = () => ({ warn() {}, iteration });
    if (mode === "success") state.run(); else expect(() => state.run()).toThrow(failure);
    if (method && mode === "success") expect(state.globals.get("result")).toBe(v.none);
    const list = state.globals.get("x");
    expect(list).toBe(state.globals.get("alias"));
    if (list?.kind !== "list") throw new Error("expected list");
    expect(list.items.snapshot()).toEqual(mode === "hint-error" ? [v.integer(0)] : [v.integer(0), v.integer(1)]);
    expect(events).toEqual(mode === "hint-error" ? ["iter", "length", "hint"] : ["iter", "length", "hint", "next", "next"]);
  });
  it.each(["**", "+"])("reports augmented-operator diagnostics after native decline: %s", operator => {
    const state = fixture(`x=None\nx ${operator}= 2`);
    expect(() => state.run()).toThrow(`unsupported operand type(s) for ${operator}=: 'NoneType' and 'int'`);
  });
  it.each(["absent", "decline", "success"])("negotiates augmented power before ordinary fallback: %s", mode => {
    const state = fixture("items=[a]\ndef key():\n trace.append('key')\n return 0\nitems[key()] **= b\nresult=items[0]");
    const a = state.values.cell({}), b = state.values.cell({}), result = state.values.cell({}), events: string[] = [];
    state.globals.set("a", a); state.globals.set("b", b); state.globals.set("trace", state.values.list([]));
    state.hooks.expressions = () => ({ warn() {}, power: { power(left, right, modulus) {
      events.push("power"); expect([left, right, modulus]).toEqual([a, b, state.values.none]); return result;
    } } });
    const statements = state.hooks.statements;
    state.hooks.statements = frame => ({ ...statements(frame), inplace: mode === "absent" ? undefined : (operator, left, right) => {
      events.push("inplace"); expect([operator, left, right]).toEqual(["**", a, b]);
      return mode === "success" ? result : state.values.notImplemented;
    } });
    state.run();
    expect(state.globals.get("result")).toBe(result);
    expect(events).toEqual(mode === "absent" ? ["power"] : mode === "decline" ? ["inplace", "power"] : ["inplace"]);
    const trace = state.globals.get("trace");
    if (trace?.kind !== "list") throw new Error("expected trace list");
    expect(trace.items.snapshot()).toEqual([state.values.string("key")]);
  });
  it("does not fall back or write back after an in-place hook fails", () => {
    const state = fixture("x=a\nx **= b"), a = state.values.cell({}), failure = new PythonRuntimeError("ValueError", "inplace failed");
    state.globals.set("a", a); state.globals.set("b", state.values.cell({}));
    state.hooks.expressions = () => ({ warn() {}, power: { power() { throw new Error("unexpected fallback"); } } });
    const statements = state.hooks.statements;
    state.hooks.statements = frame => ({ ...statements(frame), inplace() { throw failure; } });
    expect(() => state.run()).toThrow(failure);
    expect(state.globals.get("x")).toBe(a);
  });
  it.each(["result=a ** b", "result=pow(a,b)", "def f():\n return a ** b\nresult=f()", "def f():\n return pow(a,b)\nresult=f()"])("shares power capabilities across operators, builtins and frames: %s", source => {
    const state = fixture(source), a = state.values.cell({}), b = state.values.cell({});
    const result = state.values.list([]), seen: RuntimeValue[][] = [];
    const power = { power(base: RuntimeValue, exponent: RuntimeValue, modulus: RuntimeValue) {
      expect(this).toBe(power); seen.push([base, exponent, modulus]); return result;
    } };
    state.globals.set("a", a); state.globals.set("b", b);
    state.builtins.set("pow", createPowBuiltin(state.values, state.meter, power));
    state.hooks.expressions = () => ({ warn() {}, power });
    state.run();
    expect(state.globals.get("result")).toBe(result);
    expect(seen).toEqual([[a, b, state.values.none]]);
  });
  it.each([false, true])("checks cancellation after a power capability, including declines: %s", decline => {
    const controller = new AbortController(), state = fixture("result=a ** b", 100000, controller.signal);
    state.globals.set("a", state.values.cell({})); state.globals.set("b", state.values.cell({}));
    state.hooks.expressions = () => ({ warn() {}, power: { power() { controller.abort(); return decline ? state.values.notImplemented : state.values.none; } } });
    expect(() => state.run()).toThrow(ExecutionLimitError);
  });
  it.each([
    "a=(1,)\nb=(1,)\nresult=a is b\n",
    "a=-10\nb=-10\nresult=a is b\n",
    "def f():\n return ((1,),-10)\nresult=f() is f()\n"
  ])("reuses folded immutable constants from the originating compilation: %s", source => {
    const state = fixture(source); state.run();
    expect(state.globals.get("result")).toBe(state.values.true);
  });
  it.each(["[1]", "(x,)"])("does not pool mutable or dynamic displays: %s", expression => {
    const state = fixture(`x=1\ndef f():\n return ${expression}\nresult=f() is f()\n`); state.run();
    expect(state.globals.get("result")).toBe(state.values.false);
  });
  it.each([
    ["result=[*guest]\n", true], ["result=(*guest,)\n", true],
    ["def f(*args):\n return args\nresult=f(0,*guest)\n", true],
    ["def f(*args):\n return args\nresult=f(*guest)\n", false]
  ] as const)("consults source hints only for list-style expansion: %s", (source, hinted) => {
    const state = fixture(source), v = state.values, guest = v.cell({}), cursor = v.cell({}), events: string[] = [];
    const stop = new PythonRuntimeError("StopIteration", "done"), failure = new PythonRuntimeError("ValueError", "source hint failed");
    const iteration: IterationContext<RuntimeValue> = {
      hints: {
        length: value => { expect(value).toBe(guest); events.push("length"); return undefined; },
        lookupHint: value => { expect(value).toBe(guest); return () => { events.push("hint"); throw failure; }; },
        integer: () => undefined, isNotImplemented: () => false, isTypeError: () => false, typeName: () => "Guest"
      },
      lookupIter: value => { expect(value).toBe(guest); return () => { events.push("iter"); return cursor; }; },
      hasNext: value => value === cursor,
      next: () => { events.push("next"); throw stop; },
      hasSequenceItem: () => false, getItem: () => { throw Error("unexpected item"); },
      isStopIteration: error => error === stop, isIndexError: () => false, typeName: () => "Guest"
    };
    state.globals.set("guest", guest); state.hooks.expressions = () => ({ warn() {}, iteration });
    if (hinted) expect(state.run).toThrow(failure); else state.run();
    expect(events).toEqual(hinted ? ["iter", "length", "hint"] : ["iter", "next"]);
    expect(state.calls.depth).toBe(0);
  });
  it.each([false, true])("checks the original cursor hint after reacquisition (failure=%s)", fail => {
    const state = fixture("first,*rest=guest\n"), v = state.values;
    const guest = v.cell({}), cursor = v.cell({}), replacement = v.cell({}), events: string[] = [];
    const stop = new PythonRuntimeError("StopIteration", "done"), failure = new PythonRuntimeError("ValueError", "hint failed");
    const hints: LengthHintContext<RuntimeValue> = {
      length: value => { expect(value).toBe(cursor); events.push("length"); return undefined; },
      lookupHint: value => { expect(value).toBe(cursor); return () => { events.push("hint"); if (fail) throw failure; return v.integer(0); }; },
      integer: value => value.kind === "int" ? value.value : undefined,
      isNotImplemented: value => value === v.notImplemented,
      isTypeError: error => error instanceof PythonRuntimeError && error.name === "TypeError", typeName: value => value.kind
    };
    const iteration: IterationContext<RuntimeValue> = {
      hints,
      lookupIter: value => () => { events.push(value === guest ? "source iter" : "cursor iter"); return value === guest ? cursor : replacement; },
      hasNext: () => true,
      next(value) { events.push(value === cursor ? "prefix" : "remainder"); if (value === cursor) return v.integer(1); throw stop; },
      hasSequenceItem: () => false, getItem: () => { throw Error("unexpected item"); },
      isStopIteration: error => error === stop, isIndexError: () => false, typeName: () => "Guest"
    };
    state.globals.set("guest", guest); state.hooks.expressions = () => ({ warn() {}, iteration });
    if (fail) { expect(state.run).toThrow(failure); expect(state.globals.has("first")).toBe(false); }
    else { state.run(); expect(state.globals.get("rest")).toEqual(v.list([])); }
    expect(events).toEqual(["source iter", "prefix", "cursor iter", "length", "hint", ...(fail ? [] : ["remainder"])]);
  });
  it.each([false, true])("reacquires the cursor after the extended-unpack prefix (failure=%s)", fail => {
    const state = fixture("first,*rest=guest\n"), v = state.values;
    const guest = v.cell({}), cursor = v.cell({}), replacement = v.cell({}), events: string[] = [];
    const stop = new PythonRuntimeError("StopIteration", "done"), failure = new PythonRuntimeError("TypeError", "cursor iter failed");
    let remaining = 1;
    const iteration: IterationContext<RuntimeValue> = {
      lookupIter: value => () => {
        events.push(value === guest ? "source iter" : "cursor iter");
        if (value === guest) return cursor;
        if (fail) throw failure;
        return replacement;
      },
      hasNext: value => value === cursor || value === replacement,
      next(value) {
        events.push(value === cursor ? "prefix" : "remainder");
        if (value === cursor) return v.integer(1);
        if (remaining-- > 0) return v.integer(9);
        throw stop;
      },
      hasSequenceItem: () => false, getItem: () => { throw Error("unexpected item"); },
      isStopIteration: error => error === stop, isIndexError: () => false, typeName: () => "Guest"
    };
    state.globals.set("guest", guest); state.hooks.expressions = () => ({ warn() {}, iteration });
    if (fail) {
      expect(state.run).toThrow(failure);
      expect(state.globals.has("first")).toBe(false);
      expect(events).toEqual(["source iter", "prefix", "cursor iter"]);
    } else {
      state.run();
      expect(state.globals.get("first")).toBe(v.integer(1));
      expect(state.globals.get("rest")).toEqual(v.list([v.integer(9)]));
      expect(events).toEqual(["source iter", "prefix", "cursor iter", "remainder", "remainder"]);
    }
    expect(state.calls.depth).toBe(0);
  });
  it.each(["result=[*None]\n", "result=(*None,)\n"])("reports absent iteration in starred displays: %s", source => {
    const state = fixture(source);
    expect(state.run).toThrow("Value after * must be an iterable, not NoneType");
  });
  it.each([
    "a,b=guest\n", "result=(*guest,)\n", "result=[*guest]\n",
    "def f(*args):\n return args\nresult=f(*guest)\n",
    "def f(*args):\n return args\nresult=f(1,*guest)\n"
  ])("preserves guest iterator acquisition failures: %s", source => {
    const state = fixture(source), v = state.values, guest = v.cell({});
    const failure = new PythonRuntimeError("TypeError", "inside guest iter");
    const unused = (): never => { throw Error("unexpected callback"); };
    const iteration: IterationContext<RuntimeValue> = {
      lookupIter: () => () => { throw failure; }, hasNext: unused, next: unused,
      hasSequenceItem: unused, getItem: unused, isStopIteration: () => false, isIndexError: () => false, typeName: () => "Guest"
    };
    state.globals.set("guest", guest); state.hooks.expressions = () => ({ warn() {}, iteration });
    expect(state.run).toThrow(failure); expect(state.calls.depth).toBe(0);
  });
  it.each([
    "total=0\nfor item in guest:\n total=total+item\nresult=total\n",
    "a,b=guest\nresult=(a,b)\n",
    "result=(*guest,)\n",
    "def f(a,b):\n return (a,b)\nresult=f(*guest)\n",
    "def f():\n return (*guest,)\nresult=f()\n"
  ])("shares guest iteration with compiled consumers: %s", source => {
    const state = fixture(source), v = state.values, guest = v.cell({}), cursor = v.cell({}), events: string[] = [];
    let index = 0; const stop = new PythonRuntimeError("StopIteration", "done");
    const iteration: IterationContext<RuntimeValue> = {
      lookupIter(value) { expect(this).toBe(iteration); expect(value).toBe(guest); return () => { events.push("iter"); return cursor; }; },
      hasNext: value => value === cursor,
      next(value) { expect(value).toBe(cursor); events.push("next"); if (index === 2) throw stop; return v.integer(++index); },
      hasSequenceItem: () => false, getItem: () => { throw Error("unexpected indexed fallback"); },
      isStopIteration: error => error === stop, isIndexError: () => false, typeName: () => "Guest"
    };
    state.globals.set("guest", guest); state.hooks.expressions = () => ({ warn() {}, iteration });
    state.run();
    expect(state.globals.get("result")).toEqual(source.startsWith("total") ? v.integer(3) : v.tuple([v.integer(1), v.integer(2)]));
    expect(events).toEqual(["iter", "next", "next", "next"]); expect(state.calls.depth).toBe(0);
  });
  it.each(["contains", "iterate"] as const)("forwards guest containment through %s and nested frames", mode => {
    const state = fixture("module_result=needle in container\ndef f():\n return needle not in container\nresult=(module_result,f())\n"), v = state.values;
    const needle = v.cell({}), container = v.cell({}); let prepared = 0, calls = 0;
    state.globals.set("needle", needle); state.globals.set("container", container);
    const unused = (): never => { throw Error("unexpected callback"); };
    const protocol: ContainmentContext<RuntimeValue> = {
      lookupContains: () => mode === "contains" ? value => { expect(value).toBe(needle); calls++; return v.true; } : undefined,
      lookupIter: () => () => container, hasNext: () => true, next: () => { calls++; return needle; },
      hasSequenceItem: () => false, getItem: unused, equal: unused,
      truth: value => { expect(value).toBe(v.true); return true; },
      isStopIteration: () => false, isIndexError: () => false, isTypeError: () => false, typeName: () => "Guest"
    };
    state.hooks.expressions = () => {
      const owner = { warn() {}, containment(value: RuntimeValue) { expect(this).toBe(owner); expect(value).toBe(container); prepared++; return protocol; } };
      return owner;
    };
    state.run(); expect(state.globals.get("result")).toEqual(v.tuple([v.true, v.false]));
    expect(prepared).toBe(2); expect(calls).toBe(2); expect(state.calls.depth).toBe(0);
  });
  it("forwards rich comparisons and their result truth through nested frames", () => {
    const state = fixture("module_result = a < b\ndef f():\n return a < b < missing\nresult=f()\n"), v = state.values;
    const a = v.cell({}), b = v.cell({}), answer = v.cell({}); let comparisons = 0, truths = 0;
    state.globals.set("a", a); state.globals.set("b", b);
    state.hooks.expressions = () => {
      const owner = { warn() {}, truth(value: RuntimeValue) { expect(value).toBe(answer); truths++; return false; },
        richComparison(operator: string, left: RuntimeValue, right: RuntimeValue) {
          expect(this).toBe(owner); expect(operator).toBe("<"); expect(left).toBe(a); expect(right).toBe(b); comparisons++;
          return { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented, forward: () => answer, reflected: () => v.notImplemented } };
        } };
      return owner;
    };
    state.run(); expect(state.globals.get("module_result")).toBe(answer); expect(state.globals.get("result")).toBe(answer);
    expect(comparisons).toBe(2); expect(truths).toBe(1); expect(state.calls.depth).toBe(0);
  });
  it.each(["bool", "length"] as const)("uses guest %s truth for branches, not and nested functions", mode => {
    const state = fixture("if guest:\n x=1\nelse:\n x=2\ndef f():\n return not guest\nresult=(x,f(),1 if guest else 2)\n");
    const { values: v, meter } = state, guest = v.cell({}), events: string[] = [];
    state.globals.set("guest", guest);
    const protocol: TruthProtocolContext<RuntimeValue> = {
      boolean: value => value.kind === "bool" ? value.value : undefined, isNone: value => value === v.none,
      lookupBool: () => mode === "bool" ? () => { events.push("bool"); return v.false; } : undefined,
      lookupLength: () => () => { events.push("length"); return v.integer(0); },
      integer: value => value.kind === "int" ? value.value : undefined, isExactInteger: value => value.kind === "int",
      lookupIndex: () => undefined, typeName: value => value.kind, warn() {}
    };
    state.hooks.expressions = () => {
      const owner = { warn() {}, truth(value: RuntimeValue) { expect(this).toBe(owner); return value === guest ? protocolTruth(value, protocol, meter) : runtimeTruth(value, meter); } };
      return owner;
    };
    state.run();
    expect(state.globals.get("result")).toEqual(v.tuple([v.integer(2), v.true, v.integer(2)]));
    expect(events).toEqual([mode, mode, mode]); expect(state.calls.depth).toBe(0);
  });
  it("shares guest addition hooks with module and nested function frames", () => {
    const state = fixture("module_result = left + right\ndef f():\n return left + right\nresult = f()\n");
    const { values: v } = state, guest = v.cell({}), answer = v.string("guest addition"); let prepared = 0;
    state.globals.set("left", v.list([])); state.globals.set("right", guest);
    state.hooks.expressions = () => {
      const owner = { warn() {}, addition(left: RuntimeValue, right: RuntimeValue) {
        expect(this).toBe(owner); expect(left.kind).toBe("list"); expect(right).toBe(guest); prepared++;
        return { numeric: { relation: "other" as const, notImplemented: v.notImplemented,
          forward: () => v.notImplemented, reflected: () => answer, reflectedIsOverridden: () => false } };
      } };
      return owner;
    };
    state.run();
    expect(state.globals.get("module_result")).toBe(answer); expect(state.globals.get("result")).toBe(answer);
    expect(prepared).toBe(2); expect(state.calls.depth).toBe(0);
  });
  it("shares equal literal constants throughout one compiled program", () => {
    const state = fixture('a = "long value 😀"\nb = "long value 😀"\ndef f():\n return "long value 😀"\nresult = (a is b, a is f(), f() is f())\n');
    state.run();
    expect(state.globals.get("result")).toEqual(state.values.tuple([state.values.true, state.values.true, state.values.true]));
  });
  it("keeps literal types distinct while pooling equal scalar and byte literals", () => {
    const state = fixture('a=1000\nb=1000\nc=1.5\nd=1.5\ne=b"long bytes"\nf=b"long bytes"\nx=1\ny=1.0\nz=True\nresult=(a is b,c is d,e is f,x is y,x is z)\n');
    state.run();
    expect(state.globals.get("result")).toEqual(state.values.tuple([state.values.true, state.values.true, state.values.true, state.values.false, state.values.false]));
  });
  it("uses pooled literal identity for replacement without interning computed strings", () => {
    const state = fixture('s="payloadpayload"\na="payload"\nb="payload"\nc="".join(["pay","load"])\nresult=(a is b,a is c,s.replace(a,b) is s,s.replace(a,c) is s)\n');
    state.hooks.expressions = () => ({ warn() {} }); state.run();
    expect(state.globals.get("result")).toEqual(state.values.tuple([state.values.true, state.values.false, state.values.true, state.values.false]));
  });
  it("retains originating literal constants when another program invokes a function", () => {
    const origin = fixture('value="long origin value!"\ndef f():\n return "long origin value!"\n'); origin.run();
    const caller = fixture('result = f() is value\n');
    caller.globals.set("f", origin.globals.get("f")!); caller.globals.set("value", origin.globals.get("value")!);
    caller.run(); expect(caller.globals.get("result")).toBe(caller.values.true);
  });
  it("reuses constants when the same compiled program executes again", () => {
    const state = fixture('value="long reusable literal!"\n'); state.run();
    const first = state.globals.get("value"); state.run();
    expect(state.globals.get("value")).toBe(first);
  });
  it("does not use caller literal tables for standalone function code", () => {
    const origin = fixture('def f():\n return "standalone value!"\n'); origin.run();
    const fn = origin.globals.get("f"); if (fn?.kind !== "function") throw new Error("expected function");
    const caller = fixture('result = f()\n');
    caller.globals.set("f", origin.values.function({ ...fn.value, code: { ...fn.value.code, literals: undefined } }));
    caller.run(); const result = caller.globals.get("result");
    if (result?.kind !== "str") throw new Error("expected string");
    expect([...result.value]).toEqual([..."standalone value!"].map(c => c.codePointAt(0)));
  });
  it.each(["False", "True", "None", "[]", "[1]"])("sorts stably with guest keys and reverse=%s", reverse => {
    const state = fixture(`a = [(2, 0), (1, 1), (2, 2)]\ntrace = []\ndef key(x):\n trace.append((x, a.copy()))\n return x[0]\nresult = a.sort(key=key, reverse=${reverse})\n`);
    state.hooks.expressions = () => ({ warn() {} }); state.run();
    expect(state.globals.get("result")).toBe(state.values.none);
    const a = state.globals.get("a"), trace = state.globals.get("trace");
    if (a?.kind !== "list" || trace?.kind !== "list") throw new Error("expected lists");
    const ids = a.items.snapshot().map(x => x.kind === "tuple" ? x.items[1] : x);
    expect(ids).toEqual((reverse === "True" || reverse === "[1]" ? [0, 2, 1] : [1, 0, 2]).map(n => state.values.integer(n)));
    expect(trace.items.length).toBe(3);
    for (const entry of trace.items.snapshot()) {
      if (entry.kind !== "tuple" || entry.items[1].kind !== "list") throw new Error("expected trace");
      expect(entry.items[1].items.length).toBe(0);
    }
  });
  it("restores the original list when a guest sort key fails", () => {
    const state = fixture("a = [3, 1, 2]\ndef key(x):\n return 1 / 0\nresult = a.sort(key=key)\n");
    state.hooks.expressions = () => ({ warn() {} }); expect(state.run).toThrow("division by zero");
    const a = state.globals.get("a"); if (a?.kind !== "list") throw new Error("expected list");
    expect(a.items.snapshot()).toEqual([3, 1, 2].map(n => state.values.integer(n))); expect(state.calls.depth).toBe(0);
  });
  it("detects mutation during a guest sort key and discards temporary additions", () => {
    const state = fixture("a = [3, 1, 2]\ndef key(x):\n a.append(9)\n return x\na.sort(key=key)\n");
    state.hooks.expressions = () => ({ warn() {} }); expect(state.run).toThrow("list modified during sort");
    const a = state.globals.get("a"); if (a?.kind !== "list") throw new Error("expected list");
    expect(a.items.snapshot()).toEqual([1, 2, 3].map(n => state.values.integer(n)));
  });
  it("does not call an invalid key for an empty sort", () => {
    const state = fixture("a = []\nresult = a.sort(key=1)\n"); state.hooks.expressions = () => ({ warn() {} });
    state.run(); expect(state.globals.get("result")).toBe(state.values.none);
  });
  it("stops after a sort-key capability cancels execution", () => {
    const controller = new AbortController(), state = fixture("a = [2, 1]\nresult = a.sort(key=key)\nafter = 1\n", 100000, controller.signal);
    let calls = 0;
    state.hooks.expressions = () => ({ warn() {} });
    state.builtins.set("key", state.values.builtinFunction({ name: "key", invoke() { calls++; controller.abort(); return state.values.true; } }));
    expect(state.run).toThrow(ExecutionLimitError); expect(calls).toBe(1);
    expect(state.globals.has("result")).toBe(false); expect(state.globals.has("after")).toBe(false); expect(state.calls.depth).toBe(0);
  });
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
