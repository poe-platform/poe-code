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
import { createPrintBuiltin } from "./builtin-print.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
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
  it.each([false, true])("shares multiplication policies with nested frames (numeric handled=%s)", handled => {
    const state = fixture("def repeat():\n return 'x' * guest\nfirst='x' * guest\nsecond=repeat()\n"), v = state.values, guest = v.cell({});
    state.globals.set("guest", guest);
    let prepared = 0, indexed = 0;
    state.hooks.expressions = () => {
      const owner = { warn() {}, multiplication(left: RuntimeValue, right: RuntimeValue) {
        expect(this).toBe(owner); expect(left.kind).toBe("str"); expect(right).toBe(guest); prepared++;
        return {
          numeric: { relation: "other" as const, notImplemented: v.notImplemented,
            forward: () => v.notImplemented, reflected: () => handled ? v.false : v.notImplemented, reflectedIsOverridden: () => false },
          integerIndex: {
            integer: (value: RuntimeValue) => value.kind === "int" ? value.value : undefined,
            isExactInteger: (value: RuntimeValue) => value.kind === "int",
            lookupIndex(value: RuntimeValue) { expect(value).toBe(guest); indexed++; return () => v.integer(2); },
            typeName: () => "Index", warn() { throw Error("unexpected warning"); }
          }
        };
      } };
      return owner;
    };
    state.run();
    expect(state.globals.get("first")).toEqual(handled ? v.false : v.string("xx"));
    expect(state.globals.get("second")).toEqual(handled ? v.false : v.string("xx"));
    expect(prepared).toBe(2); expect(indexed).toBe(handled ? 0 : 2);
  });
  it.each([['items=[]\nitems.append(3)\nresult=items.count(3)\n', 1], ['result="ab".upper()\n', "AB"], ['result=(3).real\n', 3]] as const)("does not acquire formatting for native members: %s", (source, expected) => {
    const state = fixture(source);
    state.hooks.expressions = () => ({ warn() {} });
    const program = compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, state.values, state.meter);
    executeRuntimeProgram(program, { ...state, get formatting(): never { throw Error("native member does not need formatting"); } }, state.meter);
    expect(state.globals.get("result")).toEqual(typeof expected === "string" ? state.values.string(expected) : state.values.integer(expected));
  });
  it("does not acquire execution formatting for an arithmetic-only program", () => {
    const state = fixture("result=1+2\n");
    const expressions = state.hooks.expressions;
    state.hooks.expressions = frame => ({ ...expressions(frame), get formattedString(): never { throw Error("unused f-string capability"); }, get integerIndex(): never { throw Error("unused index capability"); } });
    const program = compileProgram<RuntimeValue>(analyzeModule("result=1+2\n"), { stripDocstring: false }, state.values, state.meter);
    executeRuntimeProgram(program, { ...state, get formatting(): never { throw Error("unused execution formatting"); } }, state.meter);
    expect(state.globals.get("result")).toEqual(state.values.integer(3));
  });
  it("retains and caches an explicit index policy ahead of MRO dispatch", () => {
    const state = fixture("first=[10,20][index]\nsecond=[30,40][index]\n"), v = state.values, index = v.cell({}); let acquisitions = 0;
    state.globals.set("index", index);
    const policy = {
      integer: (value: RuntimeValue) => value.kind === "int" ? value.value : undefined,
      isExactInteger: (value: RuntimeValue) => value.kind === "int",
      lookupIndex(value: RuntimeValue) { expect(this).toBe(policy); expect(value).toBe(index); return () => v.integer(1); },
      typeName: () => "Guest", warn() { throw Error("unexpected warning"); }
    };
    state.hooks.expressions = () => ({ warn() {}, get integerIndex() { acquisitions++; return policy; } });
    state.hooks.specialMethods = () => ({ typeOf() { throw Error("explicit index policy must win"); }, slots() { throw Error("unexpected descriptor"); } });
    state.run();
    expect(state.globals.get("first")).toEqual(v.integer(20)); expect(state.globals.get("second")).toEqual(v.integer(40)); expect(acquisitions).toBe(1);
  });
  it("runs print through explicit builtin and stream capabilities", () => {
    const state = fixture("result=print(12, 'hello', sep='|', end='!', flush=True)\n"), v = state.values, stream = v.cell({}), chunks: string[] = []; let flushed = false;
    state.builtins.set("print", createPrintBuiltin(v, state.meter, {
      representation: createRuntimeRepresentationContext(v, state.meter, { defaultRepr() { throw Error("unexpected representation"); } }),
      stdout: () => stream,
      lookupWrite(file) { expect(file).toBe(stream); return value => { if (value.kind !== "str") throw Error("expected string"); chunks.push(String.fromCodePoint(...value.value)); }; },
      flush(file) { expect(file).toBe(stream); flushed = true; }
    }));
    state.run(); expect(state.globals.get("result")).toBe(v.none); expect(chunks).toEqual(["12", "|", "hello", "!"]); expect(flushed).toBe(true);
  });
  it.each(["==", "!=", "<", ">", "<=", ">="])("preserves mapping-proxy guest results and reflected operators for %s", operator => {
    for (const side of ["left", "right", "both"]) {
      const state = fixture(`result=left${operator}right\n`), v = state.values, source = v.dictionary(new OrderedKeyMap(state.keys, state.meter)), answer = v.cell({});
      const proxy = v.mappingProxy(source), other = side === "both" ? v.mappingProxy(v.dictionary(new OrderedKeyMap(state.keys, state.meter))) : v.cell({});
      state.globals.set("left", side === "right" ? other : proxy); state.globals.set("right", side === "right" ? proxy : other);
      const reflected: Record<string, string> = { "==": "==", "!=": "!=", "<": ">", ">": "<", "<=": ">=", ">=": "<=" }; let calls = 0;
      state.hooks.expressions = () => ({ warn() {}, richComparison(op, left, right) {
        if (left !== source) return undefined;
        calls++; expect(right).toBe(other); expect(op).toBe(side === "right" ? reflected[operator] : operator);
        return { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented, reflected: () => v.notImplemented, forward: () => answer } };
      }, truth() { throw Error("direct proxy result must not be truth-converted"); } });
      state.run(); expect(state.globals.get("result")).toBe(answer); expect(calls).toBe(1);
    }
  });
  it.each(["==", "!="])("truth-converts nested mapping-proxy equality for %s", operator => {
    const state = fixture(`result=[left]${operator}[right]\n`), v = state.values, source = v.dictionary(new OrderedKeyMap(state.keys, state.meter)), answer = v.cell({}), other = v.cell({}); let conversions = 0;
    state.globals.set("left", v.mappingProxy(source)); state.globals.set("right", other);
    state.hooks.expressions = () => ({ warn() {}, richComparison(op, left, right) {
      if (left !== source) return undefined;
      expect(op).toBe("=="); expect(right).toBe(other);
      return { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented, reflected: () => v.notImplemented, forward: () => answer } };
    }, truth(value) { expect(value).toBe(answer); conversions++; return true; } });
    state.run(); expect(state.globals.get("result")).toBe(v.boolean(operator === "==")); expect(conversions).toBe(1);
  });
  it.each(["==", "!="])("preserves raw guest cell comparison results for %s", operator => {
    const state = fixture(`result=left${operator}right\n`), v = state.values, member = v.cell({}), needle = v.cell({}), answer = v.cell({});
    state.globals.set("left", v.cell({ content: { value: member } })); state.globals.set("right", v.cell({ content: { value: needle } }));
    state.hooks.expressions = () => ({ warn() {}, richComparison(op, left, right) {
      if (left !== member || right !== needle) return undefined;
      expect(op).toBe(operator);
      return { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented, reflected: () => v.notImplemented, forward: () => answer } };
    }, truth() { throw Error("direct cell result must not be truth-converted"); } });
    state.run(); expect(state.globals.get("result")).toBe(answer);
  });
  it.each(["==", "!="])("truth-converts guest cell results inside a list for %s", operator => {
    const state = fixture(`result=[left]${operator}[right]\n`), v = state.values, member = v.cell({}), needle = v.cell({}), answer = v.cell({}); let conversions = 0;
    state.globals.set("left", v.cell({ content: { value: member } })); state.globals.set("right", v.cell({ content: { value: needle } }));
    state.hooks.expressions = () => ({ warn() {}, richComparison(op, left, right) {
      if (left !== member || right !== needle) return undefined;
      expect(op).toBe("==");
      return { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented, reflected: () => v.notImplemented, forward: () => answer } };
    }, truth(value) { expect(value).toBe(answer); conversions++; return true; } });
    state.run(); expect(state.globals.get("result")).toBe(v.boolean(operator === "==")); expect(conversions).toBe(1);
  });
  it.each(["==", "!="])("retains the dictionary scan position across clear and refill for %s", operator => {
    const state = fixture(`left={'a':member}\nright={'a':needle}\nresult=left${operator}right\n`), v = state.values;
    const member = v.cell({}), needle = v.cell({}); let probes = 0;
    state.globals.set("member", member); state.globals.set("needle", needle);
    state.hooks.expressions = () => ({ warn() {}, richComparison(op, left, right) {
      if (left !== member || right !== needle) return undefined;
      expect(op).toBe("==");
      return { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented, reflected: () => v.notImplemented, forward() {
        probes++;
        const source = state.globals.get("left"); if (source?.kind !== "dict") throw Error("expected dictionary");
        source.items.clear(); source.items.set(v.string("new"), v.integer(1)); return v.true;
      } } };
    } });
    state.run(); expect(state.globals.get("result")).toBe(v.boolean(operator === "==")); expect(probes).toBe(1);
  });
  it.each(["<", "<=", ">", ">="])("rereads list elements after equality before %s", operator => {
    const state = fixture(`left=[member]\nright=[needle]\nresult=left${operator}right\n`), v = state.values;
    const member = v.cell({}), needle = v.cell({}), replacement = v.cell({}), ordered = v.cell({}), trace: string[] = [];
    state.globals.set("member", member); state.globals.set("needle", needle);
    state.hooks.expressions = () => ({ warn() {}, richComparison(op, left, right) {
      if (left.kind === "list") return undefined;
      expect(right).toBe(needle);
      return { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented, reflected: () => v.notImplemented, forward() {
        trace.push(op);
        if (op === "==") {
          const source = state.globals.get("left"); if (source?.kind !== "list") throw Error("expected list");
          source.items.set(0n, replacement); return v.false;
        }
        expect(left).toBe(replacement); return ordered;
      } } };
    } });
    state.run(); expect(state.globals.get("result")).toBe(ordered); expect(trace).toEqual(["==", operator]);
  });
  it.each(["==", "!=", "<", "<=", ">", ">="])("uses current list lengths after an unequal probe clears both lists for %s", operator => {
    const state = fixture(`left=[member]\nright=[needle]\nresult=left${operator}right\n`), v = state.values;
    const member = v.cell({}), needle = v.cell({}); let probes = 0;
    state.globals.set("member", member); state.globals.set("needle", needle);
    state.hooks.expressions = () => ({ warn() {}, richComparison(op, left) {
      if (left.kind === "list") return undefined;
      expect(op).toBe("==");
      return { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented, reflected: () => v.notImplemented, forward() {
        probes++;
        for (const name of ["left", "right"]) {
          const source = state.globals.get(name); if (source?.kind !== "list") throw Error("expected list");
          source.items.clear();
        }
        return v.false;
      } } };
    } });
    state.run(); expect(state.globals.get("result")).toBe(v.boolean(["==", "<=", ">="].includes(operator))); expect(probes).toBe(1);
  });
  it.each(["[member]<[needle]", "(member,)>(needle,)", "[[member]]<=[[needle]]", "(member,)>=(needle,)"])("preserves guest ordering results in %s", expression => {
    const state = fixture(`result=${expression}\n`), v = state.values, member = v.cell({}), needle = v.cell({}), ordered = v.cell({}), trace: string[] = [];
    state.globals.set("member", member); state.globals.set("needle", needle);
    state.hooks.expressions = () => ({ warn() {}, richComparison(operator, left, right) {
      if (left !== member || right !== needle) return undefined;
      trace.push(operator);
      return { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented, forward: () => operator === "==" ? v.false : ordered, reflected: () => v.notImplemented } };
    }, truth(value) { expect(value).toBe(v.false); return false; } });
    state.run(); expect(state.globals.get("result")).toBe(ordered);
    expect(trace[0]).toBe("=="); expect(trace.at(-1)).not.toBe("==");
  });
  it.each(["[member]==[needle]", "(member,)==(needle,)", "{'k':member}=={'k':needle}", "[[member]]==[[needle]]"])("uses guest member equality in %s", expression => {
    const state = fixture(`result=${expression}\n`), v = state.values, member = v.cell({}), needle = v.cell({}), truth = v.cell({}), trace: string[] = [];
    state.globals.set("member", member); state.globals.set("needle", needle);
    state.hooks.expressions = () => ({ warn() {}, richComparison(operator, left, right) {
      if (left !== member || right !== needle) return undefined;
      expect(operator).toBe("==");
      return { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented, forward() { trace.push("equal"); return truth; }, reflected: () => v.notImplemented } };
    }, truth(value) { expect(value).toBe(truth); trace.push("truth"); return false; } });
    state.run(); expect(state.globals.get("result")).toEqual(v.false); expect(trace).toEqual(["equal", "truth"]);
  });
  it.each(["needle in mapping.values()", "('key',needle) in mapping.items()"])("uses guest equality for dictionary view membership: %s", expression => {
    const state = fixture(`mapping={'key':member}\nresult=${expression}\n`), v = state.values, member = v.cell({}), needle = v.cell({}), truth = v.cell({}), trace: string[] = [];
    state.globals.set("member", member); state.globals.set("needle", needle);
    state.hooks.expressions = () => ({ warn() {}, richComparison(operator, left, right) {
      expect(operator).toBe("=="); expect(left).toBe(member); expect(right).toBe(needle);
      return { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented, forward() { trace.push("equal"); return truth; }, reflected: () => v.notImplemented } };
    }, truth(value) { expect(value).toBe(truth); trace.push("truth"); return true; } });
    state.run(); expect(state.globals.get("result")).toEqual(v.true); expect(trace).toEqual(["equal", "truth"]);
  });
  it.each(["[member]", "(member,)"])("uses rich equality and guest truth for membership in %s", container => {
    const state = fixture(`result=needle in ${container}\n`), v = state.values, member = v.cell({}), needle = v.cell({}), truth = v.cell({}), trace: string[] = [];
    state.globals.set("member", member); state.globals.set("needle", needle);
    state.hooks.expressions = () => ({ warn() {}, richComparison(operator, left, right) {
      expect(operator).toBe("=="); expect(left).toBe(member); expect(right).toBe(needle);
      return { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented, forward() { trace.push("equal"); return truth; }, reflected: () => v.notImplemented } };
    }, truth(value) { expect(value).toBe(truth); trace.push("truth"); return true; } });
    state.run(); expect(state.globals.get("result")).toEqual(v.true); expect(trace).toEqual(["equal", "truth"]);
  });
  it("continues list membership through elements appended by guest equality", () => {
    const state = fixture("source=[member]\nresult=needle in source\n"), v = state.values, member = v.cell({}), needle = v.cell({});
    state.globals.set("member", member); state.globals.set("needle", needle);
    let comparisons = 0;
    state.hooks.expressions = () => ({ warn() {}, richComparison() { return { slots: {
      rightIsStrictSubtype: false, notImplemented: v.notImplemented, reflected: () => v.notImplemented,
      forward() { comparisons++; const source = state.globals.get("source"); if (source?.kind !== "list") throw Error("expected list"); source.items.append(needle); return v.false; }
    } }; } });
    state.run(); expect(state.globals.get("result")).toEqual(v.true); expect(comparisons).toBe(1);
  });
  it.each(["", "61", "61 62"])("decodes fromhex buffer input %s", text => {
    const state = fixture("result=b''.fromhex(source)\n"), v = state.values; let released = false;
    state.globals.set("source", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() { return { byteLength: text.length, copy: () => v.bytes(new TextEncoder().encode(text)).value, release() { released = true; } }; }
    } });
    state.run(); expect(state.globals.get("result")).toEqual(v.bytes(text === "" ? new Uint8Array() : text === "61" ? Uint8Array.of(97) : Uint8Array.of(97,98))); expect(released).toBe(true);
  });
  it("releases malformed fromhex buffer input", () => {
    const state = fixture("result=b''.fromhex(source)\n"), v = state.values; let released = false;
    state.globals.set("source", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() { return { byteLength: 2, copy: () => v.bytes(Uint8Array.of(54,103)).value, release() { released = true; } }; }
    } });
    expect(() => state.run()).toThrow("non-hexadecimal number found in fromhex() arg at position 1"); expect(released).toBe(true);
  });
  it("releases fromhex buffers after acquisition cancellation", () => {
    const controller = new AbortController(), state = fixture("result=b''.fromhex(source)\n", 100000, controller.signal), v = state.values; let released = false;
    state.globals.set("source", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() { controller.abort(); return { byteLength: 0, copy() { throw Error("must not copy"); }, release() { released = true; } }; }
    } });
    expect(() => state.run()).toThrow(ExecutionLimitError); expect(released).toBe(true);
  });
  it.each([false,true])("negotiates reflected addition before byte buffers (handled=%s)", handled => {
    const state = fixture("result=b'a'+source\n"), v = state.values, trace: string[] = [];
    state.globals.set("source", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, addition: () => ({ numeric: {
      relation: "other", notImplemented: v.notImplemented, forward: () => v.notImplemented,
      reflectedIsOverridden: () => false,
      reflected() { trace.push("reflected"); return handled ? v.integer(42) : v.notImplemented; }
    } }), buffers: {
      acquireSimple() { trace.push("acquire"); return { byteLength: 1, copy: () => v.bytes(Uint8Array.of(98)).value, release() { trace.push("release"); } }; }
    } });
    state.run(); expect(state.globals.get("result")).toEqual(handled ? v.integer(42) : v.bytes(Uint8Array.of(97,98)));
    expect(trace).toEqual(handled ? ["reflected"] : ["reflected", "acquire", "release"]);
  });
  it.each(["result=b'a'+source", "result=b'a'\nresult+=source"])("concatenates bytes with buffer exports: %s", body => {
    const state = fixture(`${body}\n`), v = state.values; let released = false;
    state.globals.set("source", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() { return { byteLength: 1, copy: () => v.bytes(Uint8Array.of(98)).value, release() { released = true; } }; }
    } });
    state.run(); expect(state.globals.get("result")).toEqual(v.bytes(Uint8Array.of(97,98))); expect(released).toBe(true);
  });
  it("rewrites guest byte-concatenation buffer failures", () => {
    const state = fixture("result=b'a'+source\n"), v = state.values;
    state.globals.set("source", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      typeName: () => "Exporter", acquireSimple() { throw new PythonRuntimeError("BufferError", "bad export"); }
    } });
    expect(() => state.run()).toThrow("can't concat Exporter to bytes");
  });
  it("releases byte-concatenation exports after cancellation", () => {
    const controller = new AbortController(), state = fixture("result=b'a'+source\n", 100000, controller.signal), v = state.values; let released = false;
    state.globals.set("source", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() { controller.abort(); return { byteLength: 1, copy() { throw Error("must not copy"); }, release() { released = true; } }; }
    } });
    expect(() => state.run()).toThrow(ExecutionLimitError); expect(released).toBe(true);
  });
  it.each([["in", true], ["not in", false]])("checks buffer byte membership with %s", (operator, expected) => {
    const state = fixture(`result=needle ${operator} b'aba'\n`), v = state.values; let released = false;
    state.globals.set("needle", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() { return { byteLength: 1, copy: () => v.bytes(Uint8Array.of(97)).value, release() { released = true; } }; }
    } });
    state.run(); expect(state.globals.get("result")).toEqual(v.boolean(expected)); expect(released).toBe(true);
  });
  it("prefers integer index over buffer exports for byte membership", () => {
    const state = fixture("result=needle in b'a'\n"), v = state.values;
    state.globals.set("needle", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, integerIndex: {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", warn() {}, typeName: () => "Needle",
      lookupIndex: () => () => v.integer(98)
    }, buffers: { acquireSimple() { throw Error("must not acquire"); } } });
    state.run(); expect(state.globals.get("result")).toEqual(v.false);
  });
  it("releases membership buffers after acquisition cancellation", () => {
    const controller = new AbortController(), state = fixture("result=needle in b'a'\n", 100000, controller.signal), v = state.values; let released = false;
    state.globals.set("needle", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() { controller.abort(); return { byteLength: 1, copy() { throw Error("must not copy"); }, release() { released = true; } }; }
    } });
    expect(() => state.run()).toThrow(ExecutionLimitError); expect(released).toBe(true);
  });
  it.each([["center", "xax"], ["ljust", "axx"], ["rjust", "xxa"]])("accepts bytearray payloads as %s fill", (method, expected) => {
    const state = fixture(`result=b'a'.${method}(3,fill)\n`), v = state.values, fill = v.cell({});
    state.globals.set("fill", fill);
    state.hooks.expressions = () => ({ warn() {}, bytes: {
      byteString: () => undefined,
      byteArray(value) { expect(value).toBe(fill); return v.bytes(Uint8Array.of(120)).value; },
      lookupBytes() { throw Error("must not coerce"); }, typeName: () => "bytearray"
    } });
    state.run(); expect(state.globals.get("result")).toEqual(v.bytes(new TextEncoder().encode(expected)));
  });
  it("validates bytearray fill length even when no padding is needed", () => {
    const state = fixture("result=b'a'.center(0,fill)\n"), v = state.values;
    state.globals.set("fill", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, bytes: {
      byteString: () => undefined, byteArray: () => v.bytes(Uint8Array.of(120,121)).value,
      lookupBytes() { throw Error("must not coerce"); }, typeName: () => "bytearray"
    } });
    expect(() => state.run()).toThrow("center(): argument 2 must be a byte string of length 1, not a bytearray object of length 2");
  });
  it("observes same-size source-list replacements during buffer acquisition", () => {
    const state = fixture("source=[first,b'b']\nresult=b'-'.join(source)\n"), v = state.values;
    state.globals.set("first", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() {
        const source = state.globals.get("source"); if (source?.kind !== "list") throw Error("expected list");
        source.items.set(1n, v.bytes(Uint8Array.of(122)));
        return { byteLength: 1, copy: () => v.bytes(Uint8Array.of(97)).value, release() {} };
      }
    } });
    state.run(); expect(state.globals.get("result")).toEqual(v.bytes(Uint8Array.of(97,45,122)));
  });
  it.each(["append", "clear", "pop"] as const)("rejects source-list %s during join buffer acquisition", mode => {
    const state = fixture("source=[first,b'b']\nresult=b'-'.join(source)\n"), v = state.values; let released = false;
    state.globals.set("first", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() {
        const source = state.globals.get("source"); if (source?.kind !== "list") throw Error("expected list");
        if (mode === "append") source.items.append(v.none);
        else if (mode === "clear") source.items.clear();
        else source.items.pop();
        return { byteLength: 1, copy() { throw Error("must not copy"); }, release() { released = true; } };
      }
    } });
    expect(() => state.run()).toThrow("sequence changed size during iteration"); expect(released).toBe(true);
  });
  it("rewrites guest join export failures with sequence position and type", () => {
    const state = fixture("result=b''.join([source])\n"), v = state.values;
    state.globals.set("source", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      typeName: () => "Exporter",
      acquireSimple() { throw new PythonRuntimeError("BufferError", "bad export"); }
    } });
    expect(() => state.run()).toThrow("sequence item 0: expected a bytes-like object, Exporter found");
  });
  it("keeps joined buffers acquired until later exports finish", () => {
    const state = fixture("result=b'-'.join([first,second])\n"), v = state.values, first = v.cell({}), second = v.cell({}), trace: string[] = [];
    const data = Uint8Array.of(97);
    state.globals.set("first", first); state.globals.set("second", second);
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple(value) {
        const name = value === first ? "first" : "second"; trace.push(`acquire ${name}`);
        if (value === second) data[0] = 99;
        return { byteLength: 1, copy: () => v.bytes(value === first ? data : Uint8Array.of(98)).value, release() { trace.push(`release ${name}`); } };
      }
    } });
    state.run(); expect(state.globals.get("result")).toEqual(v.bytes(Uint8Array.of(99,45,98)));
    expect(trace).toEqual(["acquire first", "acquire second", "release first", "release second"]);
  });
  it("releases earlier join exports before an invalid member error", () => {
    const state = fixture("result=b''.join([first,None])\n"), v = state.values; let released = false;
    state.globals.set("first", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple(value) { return value.kind === "none" ? undefined : { byteLength: 1, copy() { throw Error("must not copy"); }, release() { released = true; } }; }
    } });
    expect(() => state.run()).toThrow("sequence item 1: expected a bytes-like object, NoneType found"); expect(released).toBe(true);
  });
  it("releases all join exports when the last acquisition cancels execution", () => {
    const controller = new AbortController(), state = fixture("result=b''.join([first,second])\n", 100000, controller.signal), v = state.values;
    const first = v.cell({}), second = v.cell({}), trace: string[] = [];
    state.globals.set("first", first); state.globals.set("second", second);
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple(value) {
        if (value === second) controller.abort();
        return { byteLength: 1, copy() { throw Error("must not copy"); }, release() { trace.push(value === first ? "first" : "second"); } };
      }
    } });
    expect(() => state.run()).toThrow(ExecutionLimitError); expect(trace).toEqual(["first", "second"]);
  });
  it.each(["startswith", "endswith"])("releases each %s tuple buffer before trying the next", method => {
    const state = fixture(`result=b'aba'.${method}((first,second,None))\n`), v = state.values, first = v.cell({}), second = v.cell({}), trace: string[] = [];
    state.globals.set("first", first); state.globals.set("second", second);
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple(value) {
        const name = value === first ? "first" : "second"; trace.push(`acquire ${name}`);
        return { byteLength: 1, copy: () => v.bytes(Uint8Array.of(value === first ? 122 : 97)).value, release() { trace.push(`release ${name}`); } };
      }
    } });
    state.run(); expect(state.globals.get("result")).toEqual(v.true);
    expect(trace).toEqual(["acquire first", "release first", "acquire second", "release second"]);
  });
  it.each(["startswith", "endswith"])("cleans up %s buffers after acquisition cancellation", method => {
    const controller = new AbortController(), state = fixture(`result=b'a'.${method}(affix)\n`, 100000, controller.signal), v = state.values; let released = false;
    state.globals.set("affix", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() { controller.abort(); return { byteLength: 1, copy() { throw Error("must not copy"); }, release() { released = true; } }; }
    } });
    expect(() => state.run()).toThrow(ExecutionLimitError); expect(released).toBe(true);
  });
  it.each([["find",0], ["rfind",2], ["index",0], ["rindex",2], ["count",2]])("searches byte buffers with %s after bounds conversion", (method, expected) => {
    const state = fixture(`result=b'aba'.${method}(needle,start)\n`), v = state.values, needle = v.cell({}), start = v.cell({}), trace: string[] = [];
    state.globals.set("needle", needle); state.globals.set("start", start);
    state.hooks.expressions = () => ({ warn() {}, integerIndex: {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", warn() {}, typeName: () => "Guest",
      lookupIndex: value => value === start ? () => { trace.push("bound"); return v.integer(0); } : () => { throw Error("buffer must precede needle index"); }
    }, buffers: {
      acquireSimple(value) { expect(value).toBe(needle); trace.push("acquire"); return { byteLength: 1, copy: () => v.bytes(Uint8Array.of(97)).value, release() { trace.push("release"); } }; }
    } });
    state.run(); expect(state.globals.get("result")).toEqual(v.integer(expected));
    expect(trace).toEqual(["bound", "acquire", "release"]);
  });
  it("releases search buffers when a required match is absent", () => {
    const state = fixture("result=b'a'.index(needle)\n"), v = state.values; let released = false;
    state.globals.set("needle", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() { return { byteLength: 1, copy: () => v.bytes(Uint8Array.of(98)).value, release() { released = true; } }; }
    } });
    expect(() => state.run()).toThrow("subsection not found"); expect(released).toBe(true);
  });
  it.each([["split", "", "ba"], ["rsplit", "ab", ""]])("acquires %s separator buffers after maxsplit conversion", (method, left, right) => {
    const state = fixture(`result=b'aba'.${method}(separator,count)\n`), v = state.values, trace: string[] = [];
    const data = Uint8Array.of(98);
    state.globals.set("separator", v.cell({})); state.globals.set("count", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, integerIndex: {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", warn() {}, typeName: () => "Count",
      lookupIndex: () => () => { trace.push("index"); data[0] = 97; return v.integer(1); }
    }, buffers: {
      acquireSimple() { trace.push("acquire"); return { byteLength: 1, copy: () => v.bytes(data).value, release() { trace.push("release"); } }; }
    } });
    state.run(); const result = state.globals.get("result");
    if (result?.kind !== "list") throw Error("expected list");
    expect(result.items.snapshot()).toEqual([v.bytes(new TextEncoder().encode(left)),v.bytes(new TextEncoder().encode(right))]);
    expect(trace).toEqual(["index", "acquire", "release"]);
  });
  it("releases split separator buffers on cancellation", () => {
    const controller = new AbortController(), state = fixture("result=b'a'.split(separator)\n", 100000, controller.signal), v = state.values;
    let released = false;
    state.globals.set("separator", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() { controller.abort(); return { byteLength: 1, copy() { throw Error("must not copy"); }, release() { released = true; } }; }
    } });
    expect(() => state.run()).toThrow(ExecutionLimitError); expect(released).toBe(true);
  });
  it("copies replacement buffers after guest count conversion", () => {
    const state = fixture("result=b'aaa'.replace(old,new,count)\n"), v = state.values, old = v.cell({}), replacement = v.cell({}), count = v.cell({}), trace: string[] = [];
    const data = Uint8Array.of(98);
    state.globals.set("old", old); state.globals.set("new", replacement); state.globals.set("count", count);
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple(value) { const name = value === old ? "old" : "new"; trace.push(`acquire ${name}`); return { byteLength: 1, copy: () => v.bytes(value === old ? Uint8Array.of(97) : data).value, release() { trace.push(`release ${name}`); } }; }
    }, integerIndex: {
      integer(value) { return value.kind === "int" ? value.value : undefined; },
      lookupIndex(value) { expect(value).toBe(count); return () => { trace.push("index"); data[0] = 99; return v.integer(1); }; },
      isExactInteger: value => value.kind === "int", warn() {},
      typeName: () => "Count"
    } });
    state.run(); expect(state.globals.get("result")).toEqual(v.bytes(Uint8Array.of(99,97,97)));
    expect(trace).toEqual(["acquire old", "acquire new", "index", "release old", "release new"]);
  });
  it.each(["acquisition", "count", "cancel"] as const)("releases replacement buffers after %s failure", mode => {
    const controller = new AbortController(), state = fixture("result=b'a'.replace(old,new,count)\n", 100000, controller.signal), v = state.values;
    const old = v.cell({}), replacement = v.cell({}), trace: string[] = [];
    state.globals.set("old", old); state.globals.set("new", replacement); state.globals.set("count", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple(value) {
        if (value === replacement && mode === "acquisition") throw new PythonRuntimeError("BufferError", "bad buffer");
        return { byteLength: 1, copy() { throw Error("must not copy"); }, release() { trace.push(value === old ? "old" : "new"); } };
      }
    }, integerIndex: {
      integer: () => undefined,
      lookupIndex: () => () => { if (mode === "cancel") controller.abort(); throw new PythonRuntimeError("TypeError", "bad count"); },
      isExactInteger: value => value.kind === "int", warn() {},
      typeName: () => "Count"
    } });
    expect(() => state.run()).toThrow(mode === "acquisition" ? "bad buffer" : mode === "count" ? "bad count" : "execution cancelled");
    expect(trace).toEqual(mode === "acquisition" ? ["old"] : ["old", "new"]);
  });
  it.each([["partition", "", "ba"], ["rpartition", "ab", ""]])("partitions bytes using the export object with %s", (method, left, right) => {
    const state = fixture(`result=b'aba'.${method}(separator)\n`), v = state.values, separator = v.cell({}), exported = v.cell({});
    let released = false;
    state.globals.set("separator", separator);
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple(value) {
        expect(value).toBe(separator);
        return { object: exported, byteLength: 1, copy: () => v.bytes(Uint8Array.of(97)).value, release() { released = true; } };
      }
    } });
    state.run(); expect(released).toBe(true);
    expect(state.globals.get("result")).toEqual(v.tuple([v.bytes(new TextEncoder().encode(left)), exported, v.bytes(new TextEncoder().encode(right))]));
  });
  it("retains direct buffer exporters in matched partition results", () => {
    const state = fixture("result=b'aba'.partition(separator)\nsame=result[1] is separator\n"), v = state.values;
    state.globals.set("separator", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() { return { byteLength: 1, copy: () => v.bytes(Uint8Array.of(97)).value, release() {} }; }
    } });
    state.run(); expect(state.globals.get("same")).toEqual(v.true);
  });
  it("releases empty partition separator exports before reporting the error", () => {
    const state = fixture("result=b'a'.partition(separator)\n"), v = state.values; let released = false;
    state.globals.set("separator", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() { return { byteLength: 0, copy: () => v.bytes(new Uint8Array()).value, release() { released = true; } }; }
    } });
    expect(() => state.run()).toThrow("empty separator"); expect(released).toBe(true);
  });
  it.each([["removeprefix", "ba"], ["removesuffix", "ab"]])("removes a byte buffer with %s", (method, expected) => {
    const state = fixture(`result=b'aba'.${method}(affix)\n`), v = state.values, trace: string[] = [];
    state.globals.set("affix", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() { trace.push("acquire"); return { byteLength: 1, copy: () => v.bytes(Uint8Array.of(97)).value, release() { trace.push("release"); } }; }
    } });
    state.run(); expect(state.globals.get("result")).toEqual(v.bytes(new TextEncoder().encode(expected)));
    expect(trace).toEqual(["acquire", "release"]);
  });
  it.each(["removeprefix", "removesuffix"])("releases %s buffers on cancellation", method => {
    const controller = new AbortController(), state = fixture(`result=b'a'.${method}(affix)\n`, 100000, controller.signal), v = state.values;
    let released = false;
    state.globals.set("affix", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() { controller.abort(); return { byteLength: 1, copy() { throw Error("must not copy"); }, release() { released = true; } }; }
    } });
    expect(() => state.run()).toThrow(ExecutionLimitError); expect(released).toBe(true);
  });
  it.each([["strip", "b"], ["lstrip", "ba"], ["rstrip", "ab"]])("strips bytes with a buffer using %s", (method, expected) => {
    const state = fixture(`result=b'aba'.${method}(chars)\n`), v = state.values, chars = v.cell({}), trace: string[] = [];
    state.globals.set("chars", chars);
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple(value) {
        expect(value).toBe(chars); trace.push("acquire");
        return { byteLength: 1, copy: () => v.bytes(Uint8Array.of(97)).value, release() { trace.push("release"); } };
      }
    } });
    state.run(); expect(state.globals.get("result")).toEqual(v.bytes(new TextEncoder().encode(expected)));
    expect(trace).toEqual(["acquire", "release"]);
  });
  it.each(["", "bbb"])("acquires and releases strip buffers even for unchanged %s", source => {
    const state = fixture(`source=b'${source}'\nresult=source.strip(chars)\nsame=result is source\n`), v = state.values;
    let released = false;
    state.globals.set("chars", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() { return { byteLength: 1, copy: () => v.bytes(Uint8Array.of(97)).value, release() { released = true; } }; }
    } });
    state.run(); expect(released).toBe(true); expect(state.globals.get("same")).toEqual(v.true);
  });
  it("releases strip buffers on copy cancellation", () => {
    const controller = new AbortController(), state = fixture("result=b'a'.strip(chars)\n", 100000, controller.signal), v = state.values;
    const data = v.bytes(Uint8Array.of(97)).value; let released = false;
    state.globals.set("chars", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() { return { byteLength: 1, copy() { controller.abort(); return data; }, release() { released = true; } }; }
    } });
    expect(() => state.run()).toThrow(ExecutionLimitError); expect(released).toBe(true);
  });
  it("constructs byte translation tables from live buffer leases", () => {
    const state = fixture("result=b'a'.translate(b''.maketrans(source,target))\n"), v = state.values, source = v.cell({}), target = v.cell({}), trace: string[] = [];
    const data = Uint8Array.of(98);
    state.globals.set("source", source); state.globals.set("target", target);
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple(value) {
        const name = value === source ? "source" : "target"; trace.push(`acquire ${name}`);
        if (value === target) data[0] = 97;
        return { byteLength: 1, copy: () => v.bytes(value === source ? data : Uint8Array.of(99)).value, release() { trace.push(`release ${name}`); } };
      }
    } });
    state.run(); expect(state.globals.get("result")).toEqual(v.bytes(Uint8Array.of(99)));
    expect(trace).toEqual(["acquire source", "acquire target", "release source", "release target"]);
  });
  it.each(["length", "acquisition", "cancel"] as const)("cleans up byte maketrans leases after %s failure", mode => {
    const controller = new AbortController(), state = fixture("result=b''.maketrans(source,target)\n", 100000, controller.signal), v = state.values;
    const source = v.cell({}), target = v.cell({}), trace: string[] = [];
    state.globals.set("source", source); state.globals.set("target", target);
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple(value) {
        const name = value === source ? "source" : "target";
        if (value === target && mode === "acquisition") throw new PythonRuntimeError("BufferError", "bad buffer");
        if (value === target && mode === "cancel") controller.abort();
        return { byteLength: value === target ? 2 : 1, copy() { throw Error("must not copy"); }, release() { trace.push(name); } };
      }
    } });
    expect(() => state.run()).toThrow(mode === "length" ? "maketrans arguments must have same length" : mode === "acquisition" ? "bad buffer" : "execution cancelled");
    expect(trace).toEqual(mode === "acquisition" ? ["source"] : ["source", "target"]);
  });
  it("retains translation buffers until both inputs have been acquired", () => {
    const state = fixture("result=b'ab'.translate(table,deleted)\n"), v = state.values, table = v.cell({}), deleted = v.cell({}), trace: string[] = [];
    const data = Uint8Array.from({ length: 256 }, (_, index) => index);
    state.globals.set("table", table); state.globals.set("deleted", deleted);
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple(value) {
        const name = value === table ? "table" : "delete";
        trace.push(`acquire ${name}`);
        if (value === deleted) data[98] = 99;
        return { byteLength: value === table ? 256 : 1,
          copy: () => v.bytes(value === table ? data : Uint8Array.of(97)).value,
          release() { trace.push(`release ${name}`); }
        };
      }
    } });
    state.run(); expect(state.globals.get("result")).toEqual(v.bytes(Uint8Array.of(99)));
    expect(trace).toEqual(["acquire table", "acquire delete", "release table", "release delete"]);
  });
  it("releases an acquired table when deletion buffer acquisition fails", () => {
    const state = fixture("result=b'a'.translate(table,deleted)\n"), v = state.values, table = v.cell({}), deleted = v.cell({}), trace: string[] = [];
    state.globals.set("table", table); state.globals.set("deleted", deleted);
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple(value) {
        if (value === deleted) throw new PythonRuntimeError("BufferError", "not contiguous");
        return { byteLength: 256, copy: () => v.bytes(new Uint8Array(256)).value, release() { trace.push("released"); } };
      }
    } });
    expect(() => state.run()).toThrow("not contiguous"); expect(trace).toEqual(["released"]);
  });
  it("releases translation buffers when acquisition cancels execution", () => {
    const controller = new AbortController(), state = fixture("result=b'a'.translate(table)\n", 100000, controller.signal), v = state.values;
    let released = false;
    state.globals.set("table", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, buffers: {
      acquireSimple() {
        controller.abort();
        return { byteLength: 256, copy() { throw Error("must not copy"); }, release() { released = true; } };
      }
    } });
    expect(() => state.run()).toThrow(ExecutionLimitError); expect(released).toBe(true);
  });
  it.each(["lookup", "isLookupError", "integer", "string"] as const)("stops translation after cancellation in %s", stage => {
    const controller = new AbortController(), state = fixture("result='a'.translate(table)\n", 100000, controller.signal);
    const value = state.values.cell({}), missing = new Error("guest missing key"), calls: string[] = [];
    state.globals.set("table", value);
    state.hooks.expressions = () => ({ warn() {}, translation: {
      lookup() {
        calls.push("lookup");
        if (stage === "lookup") { controller.abort(); return value; }
        if (stage === "isLookupError") throw missing;
        return value;
      },
      isLookupError(error) { expect(error).toBe(missing); calls.push("isLookupError"); controller.abort(); return true; },
      integer() { calls.push("integer"); if (stage === "integer") controller.abort(); return undefined; },
      string() { calls.push("string"); controller.abort(); return undefined; }
    } });
    expect(() => state.run()).toThrow(ExecutionLimitError);
    expect(calls).toEqual(stage === "lookup" ? ["lookup"] : stage === "isLookupError" ? ["lookup", "isLookupError"] : stage === "integer" ? ["lookup", "integer"] : ["lookup", "integer", "string"]);
    expect(state.globals.has("result")).toBe(false);
  });
  it.each(["integer", "string"] as const)("translates guest %s subclass payloads without coercion", kind => {
    const state = fixture("result='aéa'.translate(table)\n"), v = state.values, table = v.cell({}), payload = v.cell({});
    const replacement = v.string("XY");
    state.globals.set("table", table);
    state.hooks.expressions = () => ({ warn() {}, translation: {
      lookup(mapping, key) {
        expect(mapping).toBe(table);
        if (key.kind === "int" && key.value === 97n) return payload;
        throw new PythonRuntimeError("IndexError", "missing ordinal");
      },
      integer(value) { expect(value).toBe(payload); return kind === "integer" ? 98n : undefined; },
      string(value) { expect(value).toBe(payload); return replacement.value; }
    } });
    state.run(); expect(state.globals.get("result")).toEqual(v.string(kind === "integer" ? "béb" : "XYéXY"));
  });
  it("only suppresses recognized guest LookupError during translation", () => {
    const state = fixture("result='a'.translate(table)\n"), missing = new Error("guest missing key");
    state.globals.set("table", state.values.cell({}));
    state.hooks.expressions = () => ({ warn() {}, translation: {
      lookup() { throw missing; }, isLookupError(error) { return error === missing; }
    } });
    state.run(); expect(state.globals.get("result")).toEqual(state.values.string("a"));
  });
  it("preserves unrecognized translation lookup failures", () => {
    const state = fixture("result='a'.translate(table)\n"), failure = new Error("lookup failed");
    state.globals.set("table", state.values.cell({}));
    state.hooks.expressions = () => ({ warn() {}, translation: {
      lookup() { throw failure; }, isLookupError() { return false; }
    } });
    expect(() => state.run()).toThrow(failure);
    expect(state.globals.has("result")).toBe(false);
  });
  it("copies maketrans dictionaries without validating values or integer ranges", () => {
    const state = fixture("payload=[]\nsource={-1:payload,1 << 100:payload,True:payload}\nresult=''.maketrans(source)\nshared=result[-1] is payload\nseparate=result is not source\n");
    state.hooks.expressions = () => ({ warn() {} });
    state.run();
    expect(state.globals.get("shared")).toEqual(state.values.boolean(true));
    expect(state.globals.get("separate")).toEqual(state.values.boolean(true));
    const result = state.globals.get("result");
    expect(result?.kind === "dict" && result.items.size).toBe(3);
  });
  it.each([
    ["'abé'.translate(''.maketrans('aé','xy','b'))", "xy"],
    ["'ab'.translate(''.maketrans({'a':'XY','b':None}))", "XY"],
    ["'a'.translate(''.maketrans('aa','xy'))", "y"],
    ["'😀a'.translate(''.maketrans('😀a','éz'))", "éz"]
  ])("builds Unicode translation tables: %s", (expression, expected) => {
    const state = fixture(`result=${expression}\n`);
    state.hooks.expressions = () => ({ warn() {} });
    state.run(); expect(state.globals.get("result")).toEqual(state.values.string(expected));
  });
  it.each([
    ["1", "if you give only one argument to maketrans it must be a dict"],
    ["{'ab':1}", "string keys in translatetable must be of length 1"],
    ["{None:1}", "keys in translate table mustbe strings or integers"],
    ["1,2,3", "maketrans() argument 2 must be str, not int"],
    ["'aa','b',None", "maketrans() argument 3 must be str, not None"],
    ["'aa','b'", "the first two maketrans arguments must have equal length"]
  ])("validates translation table inputs %s", (argumentsText, message) => {
    const state = fixture(`result=''.maketrans(${argumentsText})\n`);
    state.hooks.expressions = () => ({ warn() {} });
    expect(() => state.run()).toThrow(message);
  });
  it.each([
    ["[]", "character mapping must return integer, None or str"],
    ["-1", "character mapping must be in range(0x110000)"],
    ["1 << 100", "character mapping must be in range(0x110000)"]
  ])("validates translation result %s", (value, message) => {
    const state = fixture(`result='a'.translate({97:${value}})\n`);
    state.hooks.expressions = () => ({ warn() {} });
    expect(() => state.run()).toThrow(message);
    expect(state.globals.has("result")).toBe(false);
  });
  it.each([
    ["'ababa'.translate({97:'xy',98:None})", "xyxyxy"],
    ["'aéa'.translate({97:98})", "béb"],
    ["'abc'.translate({97:False})", "\0bc"],
    ["''.translate(None)", ""]
  ])("executes native string translation: %s", (expression, expected) => {
    const state = fixture(`result=${expression}\n`);
    state.hooks.expressions = () => ({ warn() {} });
    state.run(); expect(state.globals.get("result")).toEqual(state.values.string(expected));
  });
  it("preserves guest translation lookup schedules", () => {
    const state = fixture("result='ababa'.translate(table)\n"), v = state.values, table = v.cell({}), calls: bigint[] = [];
    state.globals.set("table", table);
    state.hooks.expressions = () => ({ warn() {}, translation: {
      lookup(mapping, key) {
        expect(mapping).toBe(table); if (key.kind !== "int") throw Error("expected key");
        calls.push(key.value);
        if (key.value === 97n) return v.string("xy");
        throw new PythonRuntimeError("LookupError", "missing");
      }
    } });
    state.run(); expect(state.globals.get("result")).toEqual(v.string("xybxybxy"));
    expect(calls).toEqual([97n,97n,98n,97n,98n,97n]);
  });
  it.each(["Guest", "x".repeat(300)])("reports guest byte-input types with bounded diagnostics: %s", name => {
    const state = fixture("result=(0).from_bytes(source)\n"), v = state.values;
    state.globals.set("source", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, bytes: {
      lookupBytes: () => undefined, byteString: () => undefined, typeName: () => name
    } });
    expect(() => state.run()).toThrow(`cannot convert '${name.slice(0, 200)}' object to bytes`);
  });
  it.each(["buffer", "bytes", "failure", "cancelled"])("decodes buffer-capable inputs (%s)", mode => {
    const controller = new AbortController(), state = fixture("result=(0).from_bytes(source)\n", 100000, controller.signal), v = state.values;
    const source = v.cell({}), payload = v.bytes(Uint8Array.of(1,2)), events: string[] = [];
    const failure = new PythonRuntimeError("BufferError", "buffer unavailable");
    state.globals.set("source", source);
    state.hooks.expressions = () => ({ warn() {}, bytes: {
      byteString: value => value.kind === "bytes" ? value.value : undefined,
      typeName: value => value.kind,
      lookupBytes: () => { events.push("lookup"); return mode === "bytes" ? () => { events.push("bytes"); return payload; } : undefined; },
      bufferBytes: value => {
        expect(value).toBe(source); events.push("buffer");
        if (mode === "failure") throw failure;
        if (mode === "cancelled") controller.abort();
        return payload.value;
      }
    } });
    if (mode === "failure") expect(() => state.run()).toThrow(failure);
    else if (mode === "cancelled") expect(() => state.run()).toThrow(ExecutionLimitError);
    else { state.run(); expect(state.globals.get("result")).toEqual(v.integer(258)); }
    expect(events).toEqual(mode === "bytes" ? ["lookup", "bytes"] : ["lookup", "buffer"]);
    if (mode === "failure" || mode === "cancelled") expect(state.globals.has("result")).toBe(false);
  });
  it.each(["success", "invalid", "raises"])("uses guest __bytes__ before iterable fallback (%s)", mode => {
    const state = fixture("result=(0).from_bytes(source,signed=True)\n"), v = state.values, source = v.cell({});
    const failure = new PythonRuntimeError("ValueError", "bytes failed"); let calls = 0;
    state.globals.set("source", source);
    state.hooks.expressions = () => ({ warn() {}, bytes: {
      byteString: value => value.kind === "bytes" ? value.value : undefined,
      typeName: value => value.kind,
      lookupBytes: value => () => {
        expect(value).toBe(source); calls++;
        if (mode === "raises") throw failure;
        return mode === "invalid" ? v.integer(1) : v.bytes(Uint8Array.of(255));
      }
    } });
    if (mode === "success") { state.run(); expect(state.globals.get("result")).toEqual(v.integer(-1)); }
    else expect(() => state.run()).toThrow(mode === "invalid" ? "__bytes__ returned non-bytes (type int)" : failure);
    expect(calls).toBe(1);
  });
  it.each([false, true, "invalid-hint"])("decodes guest byte iterables with signed truth (%s)", signed => {
    const state = fixture("result=(0).from_bytes(source,signed=flag)\n"), v = state.values;
    const source = v.cell({}), cursor = v.cell({}), byte = v.cell({}), flag = v.cell({}), events: string[] = []; let index = 0;
    const stop = new PythonRuntimeError("StopIteration", "done");
    state.globals.set("source", source); state.globals.set("flag", flag);
    const iteration: IterationContext<RuntimeValue> = {
      lookupIter: value => () => { expect(value).toBe(source); events.push("iter"); return cursor; },
      hasNext: value => value === cursor,
      next() { events.push("next"); if (index++ === 0) return byte; throw stop; },
      hasSequenceItem: () => false, getItem() { throw Error("unexpected item"); },
      isStopIteration: error => error === stop, isIndexError: () => false, typeName: () => "Source",
      hints: {
        length: value => { expect(value).toBe(source); return undefined; },
        lookupHint: () => () => { events.push("hint"); return signed === "invalid-hint" ? v.none : v.integer(0); },
        integer: value => value.kind === "int" ? value.value : undefined,
        isNotImplemented: () => false, isTypeError: () => false, typeName: () => "Source"
      }
    };
    state.hooks.expressions = () => ({ warn() {}, iteration, integerIndex: {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", typeName: () => "Byte", warn() {},
      lookupIndex: value => () => { expect(value).toBe(byte); events.push("index"); return v.integer(255); }
    }, truth(value) { expect(value).toBe(flag); events.push("signed"); return signed === true; } });
    if (signed === "invalid-hint") {
      expect(() => state.run()).toThrow("__length_hint__ must be an integer, not Source");
      expect(events).toEqual(["signed", "iter", "hint"]);
      return;
    }
    state.run(); expect(state.globals.get("result")).toEqual(v.integer(signed ? -1 : 255));
    expect(events).toEqual(["signed", "iter", "hint", "next", "index", "next"]);
  });
  it.each([true, false])("converts guest to_bytes length and signed flag (%s)", signed => {
    const state = fixture(`result=(255).to_bytes(length,'little',signed=flag)\nexpected=(255).to_bytes(2,'little',signed=${signed ? "True" : "False"})\n`), v = state.values;
    const length = v.cell({}), flag = v.cell({}), events: string[] = [];
    state.globals.set("length", length); state.globals.set("flag", flag);
    state.hooks.expressions = () => ({ warn() {}, integerIndex: {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", typeName: () => "Length", warn() {},
      lookupIndex: value => () => { expect(value).toBe(length); events.push("length"); return v.integer(2); }
    }, truth(value) { if (value === flag) { events.push("signed"); return signed; } return runtimeTruth(value, state.meter); } });
    state.run();
    expect(events).toEqual(["length", "signed"]);
    expect(state.globals.get("result")).toEqual(state.globals.get("expected"));
  });
  it.each([["", false], ["", true], ["b", false], ["b", true]] as const)("uses guest truth for splitlines keepends (%s, %s)", (prefix, retain) => {
    const state = fixture(`result=${prefix}'a\\nb'.splitlines(keepends=flag)\nexpected=${prefix}'a\\nb'.splitlines(${retain ? "True" : "False"})\n`), v = state.values, flag = v.cell({}); let calls = 0;
    state.globals.set("flag", flag);
    state.hooks.expressions = () => ({ warn() {}, truth(value) {
      if (value === flag) { calls++; return retain; }
      return runtimeTruth(value, state.meter);
    } });
    state.run(); expect(calls).toBe(1);
    expect(state.globals.get("result")).toEqual(state.globals.get("expected"));
  });
  it.each([2, -2])("converts guest hex grouping %s", group => {
    const state = fixture(`result=b'abcde'.hex('-',bytes_per_sep=group)\nexpected=b'abcde'.hex('-',${group})\n`), v = state.values; let calls = 0;
    state.globals.set("group", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, integerIndex: {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", typeName: () => "Group", warn() {},
      lookupIndex: () => () => { calls++; return v.integer(group); }
    } });
    state.run(); expect(calls).toBe(1);
    expect(state.globals.get("result")).toEqual(state.globals.get("expected"));
  });
  it.each(["", "b"])("converts guest tab sizes for %s text", prefix => {
    const state = fixture(`result=${prefix}'a\\tb'.expandtabs(tabsize=size)\nexpected=${prefix}'a   b'\n`), v = state.values; let calls = 0;
    state.globals.set("size", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, integerIndex: {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", typeName: () => "Size", warn() {},
      lookupIndex: () => () => { calls++; return v.integer(4); }
    } });
    state.run(); expect(calls).toBe(1);
    expect(state.globals.get("result")).toEqual(state.globals.get("expected"));
  });
  it.each(["split", "rsplit", "center", "ljust", "rjust", "zfill"])("converts guest text %s sizes", method => {
    for (const prefix of ["", "b"]) {
      const splitting = method === "split" || method === "rsplit";
      const args = splitting ? `${prefix}'a',size` : "size";
      const exact = splitting ? `${prefix}'a',1` : "8";
      const state = fixture(`text=${prefix}'aba'\nresult=text.${method}(${args})\nexpected=text.${method}(${exact})\n`), v = state.values; let calls = 0;
      state.globals.set("size", v.cell({}));
      state.hooks.expressions = () => ({ warn() {}, integerIndex: {
        integer: value => value.kind === "int" ? value.value : undefined,
        isExactInteger: value => value.kind === "int", typeName: () => "Size", warn() {},
        lookupIndex: () => () => { calls++; return v.integer(splitting ? 1 : 8); }
      } });
      state.run(); expect(calls).toBe(1);
      expect(state.globals.get("result")).toEqual(state.globals.get("expected"));
    }
  });
  it.each(["'ababa'.replace('a','x',count)", "'ababa'.replace('a','x',count=count)", "b'ababa'.replace(b'a',b'x',count)"])("converts guest replacement counts: %s", expression => {
    const state = fixture(`result=${expression}\n`), v = state.values; let calls = 0;
    state.globals.set("count", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, integerIndex: {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", typeName: () => "Count", warn() {},
      lookupIndex: () => () => { calls++; return v.integer(2); }
    } });
    state.run(); expect(calls).toBe(1);
    expect(state.globals.get("result")).toEqual(expression.startsWith("b") ? v.bytes(Uint8Array.of(120,98,120,98,97)) : v.string("xbxba"));
  });
  it.each([["", false], ["", true], ["b", false], ["b", true]] as const)("joins guest iterables (%s, failure=%s)", (prefix, fail) => {
    const state = fixture(`result=${prefix}','.join(guest)\nexpected=${prefix}'a,b'\n`), v = state.values;
    const guest = v.cell({}), cursor = v.cell({}), events: string[] = []; let index = 0;
    const stop = new PythonRuntimeError("StopIteration", "done"), failure = new PythonRuntimeError("ValueError", "join failed");
    const parts = prefix === "b" ? [v.bytes(Uint8Array.of(97)), v.bytes(Uint8Array.of(98))] : [v.string("a"), v.string("b")];
    const iteration: IterationContext<RuntimeValue> = {
      lookupIter: value => () => { events.push(value === guest ? "source" : "cursor"); return cursor; },
      hasNext: value => value === cursor,
      next() { events.push("next"); if (index === 0 && fail) { index++; return v.none; } if (fail) throw failure; if (index < parts.length) return parts[index++]; throw stop; },
      hasSequenceItem: () => false, getItem() { throw Error("unexpected item"); },
      isStopIteration: error => error === stop, isIndexError: () => false, typeName: () => "Guest",
      hints: {
        length: value => { expect(value).toBe(cursor); return undefined; },
        lookupHint: () => () => { events.push("hint"); return v.integer(0); },
        integer: value => value.kind === "int" ? value.value : undefined,
        isNotImplemented: () => false, isTypeError: () => false, typeName: () => "Guest"
      }
    };
    state.globals.set("guest", guest); state.hooks.expressions = () => ({ warn() {}, iteration });
    if (fail) expect(() => state.run()).toThrow(failure); else {
      state.run(); expect(state.globals.get("result")).toEqual(state.globals.get("expected"));
    }
    expect(events).toEqual(fail ? ["source", "cursor", "hint", "next", "next"] : ["source", "cursor", "hint", "next", "next", "next"]);
  });
  it.each(["negative", "oversized", "invalid", "raises"])("validates guest bytes needles (%s)", mode => {
    const state = fixture("result=b'abc'.find(needle)\n"), v = state.values;
    const failure = new PythonRuntimeError("TypeError", "guest failure");
    state.globals.set("needle", v.cell({}));
    state.hooks.expressions = () => ({ warn() {}, integerIndex: {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", typeName: value => value.kind === "none" ? "NoneType" : "Index", warn() {},
      lookupIndex: () => () => {
        if (mode === "raises") throw failure;
        return mode === "invalid" ? v.none : v.integer(mode === "negative" ? -1n : 1n << 100n);
      }
    } });
    expect(() => state.run()).toThrow(mode === "raises" ? failure : mode === "invalid" ? "__index__ returned non-int (type NoneType)" : "byte must be in range(0, 256)");
    expect(state.globals.has("result")).toBe(false);
  });
  it.each(["find", "rfind", "index", "rindex", "count"])("converts bytes %s needles after search bounds", method => {
    const state = fixture(`result=b'ababa'.${method}(needle,start,stop)\nexpected=b'ababa'.${method}(98,1,5)\n`), v = state.values;
    const needle = v.cell({}), start = v.cell({}), stop = v.cell({}), events: string[] = [];
    state.globals.set("needle", needle); state.globals.set("start", start); state.globals.set("stop", stop);
    state.hooks.expressions = () => ({ warn() {}, integerIndex: {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", typeName: () => "Index", warn() {},
      lookupIndex: value => () => { events.push(value === needle ? "needle" : value === start ? "start" : "stop"); return v.integer(value === needle ? 98 : value === start ? 1 : 5); }
    } });
    state.run();
    expect(events).toEqual(["start", "stop", "needle"]);
    expect(state.globals.get("result")).toEqual(state.globals.get("expected"));
  });
  it.each(["find", "rfind", "index", "rindex", "count", "startswith", "endswith"])("converts guest bounds for text %s methods", method => {
    for (const prefix of ["", "b"]) {
      const state = fixture(`text=${prefix}'ababa'\nresult=text.${method}(${prefix}'ba',start,stop)\nexpected=text.${method}(${prefix}'ba',1,None)\n`), v = state.values;
      const start = v.cell({}), stop = v.cell({}), events: string[] = [];
      state.globals.set("start", start); state.globals.set("stop", stop);
      state.hooks.expressions = () => ({ warn() {}, integerIndex: {
        integer: value => value.kind === "int" ? value.value : undefined,
        isExactInteger: value => value.kind === "int", typeName: () => "Index", warn() {},
        lookupIndex: value => () => { events.push(value === start ? "start" : "stop"); return v.integer(value === start ? 1n : 1n << 100n); }
      } });
      state.run();
      expect(events).toEqual(["start", "stop"]);
      expect(state.globals.get("result")).toEqual(state.globals.get("expected"));
    }
  });
  it("hints the original slice cursor while consuming its replacement", () => {
    const state = fixture("items=[1]\nitems[:]=guest\n"), v = state.values;
    const guest = v.cell({}), cursor = v.cell({}), replacement = v.cell({}), events: string[] = [];
    const stop = new PythonRuntimeError("StopIteration", "done");
    const iteration: IterationContext<RuntimeValue> = {
      lookupIter: value => () => {
        expect(value).not.toBe(replacement);
        events.push(value === guest ? "source iter" : "cursor iter");
        return value === guest ? cursor : replacement;
      },
      hasNext: value => value === cursor || value === replacement,
      next(value) { expect(value).toBe(replacement); events.push("replacement next"); throw stop; },
      hasSequenceItem: () => false, getItem() { throw Error("unexpected item"); },
      isStopIteration: error => error === stop, isIndexError: () => false, typeName: () => "Guest",
      hints: {
        length: value => { expect(value).toBe(cursor); return undefined; },
        lookupHint: () => () => { events.push("original hint"); return v.integer(0); },
        integer: value => value.kind === "int" ? value.value : undefined,
        isNotImplemented: () => false, isTypeError: () => false, typeName: () => "Guest"
      }
    };
    state.globals.set("guest", guest); state.hooks.expressions = () => ({ warn() {}, iteration });
    state.run();
    expect(events).toEqual(["source iter", "cursor iter", "original hint", "replacement next"]);
    const items = state.globals.get("items"); if (items?.kind !== "list") throw Error("expected list");
    expect(items.items.length).toBe(0);
  });
  it.each([
    ["clear", false], ["clear", true], ["append", false],
    ["append", true], ["pop", false], ["pop", true]
  ] as const)("preserves %s callbacks during slice collection (failure=%s)", (mutation, fail) => {
    const state = fixture("items=[0,1,2,3]\nitems[:]=guest\n"), v = state.values;
    const guest = v.cell({}), cursor = v.cell({}); let index = 0;
    const stop = new PythonRuntimeError("StopIteration", "done"), failure = new PythonRuntimeError("ValueError", "collection failed");
    const iteration: IterationContext<RuntimeValue> = {
      lookupIter: () => () => cursor, hasNext: value => value === cursor,
      next() {
        if (index++ === 0) {
          const items = state.globals.get("items"); if (items?.kind !== "list") throw Error("expected list");
          if (mutation === "clear") items.items.clear();
          else if (mutation === "append") items.items.append(v.integer(7));
          else items.items.pop(0n);
          return v.integer(9);
        }
        if (fail) throw failure;
        throw stop;
      },
      hasSequenceItem: () => false, getItem() { throw Error("unexpected item"); },
      isStopIteration: error => error === stop, isIndexError: () => false, typeName: () => "Guest"
    };
    state.globals.set("guest", guest); state.hooks.expressions = () => ({ warn() {}, iteration });
    if (fail) expect(() => state.run()).toThrow(failure); else state.run();
    const items = state.globals.get("items"); if (items?.kind !== "list") throw Error("expected list");
    const expected = !fail ? [9] : mutation === "clear" ? [] : mutation === "append" ? [0,1,2,3,7] : [1,2,3];
    expect(items.items.snapshot()).toEqual(expected.map(value => v.integer(value)));
  });
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
  it("retains comprehension scopes and captured cells across separately compiled programs", () => {
    const origin=fixture("token=10\ndef f():\n return [lambda: x+token for x in [1,2,3]]\n");origin.run();
    const caller=fixture("token=100\ncallbacks=f()\nresult=[callback() for callback in callbacks]\n");
    caller.globals.set("f",origin.globals.get("f")!);caller.run();
    const result=caller.globals.get("result");
    expect(result?.kind==="list"?result.items.snapshot():result).toEqual([13,13,13].map(n=>caller.values.integer(n)));
    expect(caller.calls.depth).toBe(0);
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
  it("reports a missing import hook and restores frames on failure", () => {
    const state = fixture("x = 1\ndef f():\n import unavailable\nf()\n");
    expect(state.run).toThrow(expect.objectContaining({name:"ImportError",message:"__import__ not found"})); expect(state.globals.get("x")).toEqual(state.values.integer(1)); expect(state.calls.depth).toBe(0);
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
