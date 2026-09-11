/* eslint-disable require-yield -- Async protocol callbacks can complete without suspending. */
import { describe, expect, it } from "vitest";
import { parseModule } from "../module.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import type { Statement } from "../statement-ast.js";
import { createExpressionContinuation, type ExpressionContext } from "./expression-evaluation.js";
import { createStatementContinuation, type ResumableStatementContext } from "./statement-execution.js";

class Guest extends Error {}

function fixture(inputs: Record<string, unknown> = {}, maxAllocatedBytes = 1000000, signal?: AbortSignal) {
  const names = new Map(Object.entries(inputs)), events: unknown[] = [];
  const meter = new ExecutionBudget({ maxSteps: 1000000, maxAllocatedBytes, signal });
  let active: unknown;
  const unused = (): never => { throw Error("unsupported fixture operation"); };
  const expressions: ExpressionContext<unknown> = {
    literal: node => typeof node.value === "bigint" ? Number(node.value) : node.value,
    load(name) { events.push(`load:${name}`); return names.get(name); },
    store: (name, value) => { names.set(name, value); },
    truth: Boolean, boolean: value => value,
    unary: unused, binary: unused, compare: unused, attribute: unused,
    beginCall: unused, tuple: unused, list: unused, beginSet: unused,
    beginDictionary: unused, slice: unused, getItem: unused,
    iterate: value => (value as Iterable<unknown>)[Symbol.iterator]()
  };
  const context: ResumableStatementContext<unknown> = {
    evaluate: node => createExpressionContinuation(node, expressions, meter, null),
    test: node => createExpressionContinuation(node, expressions, meter, null, "branch"),
    iterate: expressions.iterate,
    *assign(target, value) {
      if (target.kind === "name") names.set(target.name, value);
      else if (target.kind === "subscript") {
        const { object, key } = yield* createExpressionContinuation(target, expressions, meter, null, "subscript-reference");
        (object as Map<unknown, unknown>).set(key, value);
      } else unused();
      events.push("assigned");
    },
    *execute(statement) {
      if (statement.kind === "expression-statement") events.push(yield* context.evaluate(statement.expression));
      else if (statement.kind === "assignment") {
        const value = yield* context.evaluate(statement.value);
        for (const target of statement.targets) yield* context.assign(target, value);
      } else if (statement.kind === "raise") {
        if (statement.exception === null) throw active;
        throw yield* context.evaluate(statement.exception);
      } else unused();
    },
    exceptions: {
      isGuest: error => error instanceof Guest,
      enter(error) { const previous = active; active = error; return () => { active = previous; }; },
      handlers: {
        match: (error, type) => error instanceof Guest && type === Guest,
        bind: (name, error) => { names.set(name, error); },
        clear: name => { events.push(`clear:${name}`); names.delete(name); }
      }
    }
  };
  return { context, meter, names, events, active: () => active,
    run: (source: string) => createStatementContinuation(parseModule(source).body, context, meter) };
}

describe("resumable statement execution", () => {
  it("retains manager-specific locations across suspended entry, body and cleanup",()=>{
    const state=fixture({a:"a",b:"b",body:"body"});let line=0;
    state.context.position=site=>{line=site.start.line;};
    state.context.asyncManagers={prepare(value){return {*enter(){yield `enter:${value}`;return value;},*exit(){yield `exit:${value}`;return false;}};},truth:Boolean};
    const cursor=state.run("async with (\n a,\n b\n):\n yield body");
    for(const [value,expectedLine] of [["enter:a",2],["enter:b",3],["body",5],["exit:b",3],["exit:a",2]] as const){
      expect(cursor.next(null)).toEqual({done:false,value});expect(line).toBe(expectedLine);
    }
    expect(cursor.next(null)).toEqual({done:true,value:{kind:"normal"}});
  });

  it("restores handled state when cleanup location bookkeeping cancels",()=>{
    const controller=new AbortController(),state=fixture({a:"a"},1000000,controller.signal),failure=new Guest("body");let armed=false;
    state.context.position=()=>{if(armed){expect(state.active()).toBe(failure);controller.abort();}};
    state.context.asyncManagers={prepare(){return {*enter(){return null;},*exit(){state.events.push("exit");return false;}};},truth:Boolean};
    const cursor=state.run("async with a:\n yield 1");expect(cursor.next(null)).toEqual({done:false,value:1});armed=true;
    expect(()=>cursor.throw(failure)).toThrow(ExecutionLimitError);expect(state.active()).toBeUndefined();expect(state.events).not.toContain("exit");
  });
  it("awaits prepared async entries and reverse-order exits while preserving a return",()=>{
    const state=fixture({a:"a",b:"b"});
    state.context.asyncManagers={prepare(value){
      const manager={
        *enter(){state.events.push(`enter:${value}`);manager.exit=function*(){throw Error("replaced exit");};yield `${value}:enter`;return value;},
        *exit(){state.events.push(`exit:${value}`);yield `${value}:exit`;return false;}
      };return manager;
    },truth(){throw Error("normal exit must not test truth");}};
    const cursor=state.run("async with a as x, b as y:\n return 7");
    for(const value of ["a:enter","b:enter","b:exit","a:exit"])expect(cursor.next(null)).toEqual({done:false,value});
    expect(cursor.next(null)).toEqual({done:true,value:{kind:"return",value:7}});
    expect(state.names.get("x")).toBe("a");expect(state.names.get("y")).toBe("b");
    expect(state.events.filter(value=>typeof value==="string"&&value.startsWith("exit:"))).toEqual(["exit:b","exit:a"]);
  });

  it("unwinds only entered async managers when a later entry await fails",()=>{
    const state=fixture({a:"a",b:"b"}),failure=new Guest("entry");
    state.context.asyncManagers={prepare(value){return {
      *enter(){yield `${value}:enter`;return value;},
      *exit(error){state.events.push([value,error?.error]);yield `${value}:exit`;return false;}
    };},truth:Boolean};
    const cursor=state.run("async with a, b:\n yield 1");
    expect(cursor.next().value).toBe("a:enter");expect(cursor.next(null).value).toBe("b:enter");
    expect(cursor.throw(failure).value).toBe("a:exit");expect(state.active()).toBe(failure);
    expect(()=>cursor.next(null)).toThrow(failure);expect(state.active()).toBeUndefined();
    expect(state.events.filter(Array.isArray)).toEqual([["a",failure]]);
  });

  it("awaits async target-failure suppression with the original exception active",()=>{
    const obj=new Map(),state=fixture({obj,a:"a"}),failure=new Guest("target");
    state.context.asyncManagers={prepare(){return {
      *enter(){return 7;},*exit(error){expect(error?.error).toBe(failure);expect(state.active()).toBe(failure);yield 8;return true;}
    };},truth(value){expect(state.active()).toBe(failure);return Boolean(value);}};
    const cursor=state.run("async with a as obj[(yield 1)]:\n yield 2\nyield 3");
    expect(cursor.next().value).toBe(1);expect(cursor.throw(failure).value).toBe(8);
    expect(cursor.next(null).value).toBe(3);expect(state.active()).toBeUndefined();expect(obj.size).toBe(0);
  });

  it.each(["fatal","return"] as const)("restores async-exit bookkeeping on host %s without running outer guest cleanup",mode=>{
    const failure=new Guest("body"),state=fixture({a:"a",b:"b",failure});
    state.context.asyncManagers={prepare(value){return {
      *enter(){return value;},*exit(){state.events.push(`exit:${value}`);yield 8;return false;}
    };},truth:Boolean};
    const cursor=state.run("async with a, b:\n raise failure");
    expect(cursor.next().value).toBe(8);expect(state.active()).toBe(failure);
    if(mode==="fatal")expect(()=>cursor.throw(new ExecutionLimitError("cancelled"))).toThrow(ExecutionLimitError);
    else expect(cursor.return({kind:"normal"}).done).toBe(true);
    expect(state.active()).toBeUndefined();expect(state.events).not.toContain("exit:a");
  });

  it("rejects missing async-manager capability before evaluating a manager",()=>{
    const state=fixture({a:"a"});
    state.context.managers={prepare(){throw Error("must not use synchronous manager");},truth:Boolean};
    expect(()=>state.run("async with a:\n pass").next()).toThrow("unsupported statement: with");
    expect(state.events).toEqual([]);
  });

  it("retains loop and pending continue frames across yielding finalizers", () => {
    const state = fixture({ items: [1, 2] });
    const cursor = state.run("for x in items:\n try:\n  yield x\n  continue\n finally:\n  yield 9\nelse:\n yield 8\nreturn 7");
    expect(state.events).toEqual([]);
    for (const value of [1, 9, 2, 9, 8]) expect(cursor.next(null)).toEqual({ done: false, value });
    expect(cursor.next(null)).toEqual({ done: true, value: { kind: "return", value: 7 } });
    expect(state.events.filter(event => event === "load:items")).toHaveLength(1);
  });

  it("keeps the sent return value while a finally suite yields", () => {
    const state = fixture(), cursor = state.run("try:\n return (yield 1)\nfinally:\n yield 2");
    expect(cursor.next()).toEqual({ done: false, value: 1 });
    expect(cursor.next(7)).toEqual({ done: false, value: 2 });
    expect(cursor.next(99)).toEqual({ done: true, value: { kind: "return", value: 7 } });
  });

  it("routes an injected guest exception into handlers and retains alias cleanup", () => {
    const state = fixture({ E: Guest }), failure = new Guest("injected");
    const cursor = state.run("try:\n yield 1\nexcept E as error:\n yield 2\nfinally:\n yield 3\nreturn 7");
    expect(cursor.next()).toEqual({ done: false, value: 1 });
    expect(cursor.throw(failure)).toEqual({ done: false, value: 2 });
    expect(state.names.get("error")).toBe(failure); expect(state.active()).toBe(failure);
    expect(cursor.next(null)).toEqual({ done: false, value: 3 });
    expect(state.names.has("error")).toBe(false); expect(state.active()).toBeUndefined();
    expect(cursor.next(null)).toEqual({ done: true, value: { kind: "return", value: 7 } });
    expect(state.events.filter(event => event === "clear:error")).toHaveLength(1);
  });

  it("resumes branching conditions without evaluating unselected suites", () => {
    const state = fixture(), cursor = state.run("if (yield 1):\n yield 2\nelse:\n yield 3\nwhile (yield 4):\n yield 5\nelse:\n return 6");
    expect(cursor.next()).toEqual({ done: false, value: 1 });
    expect(cursor.next(false)).toEqual({ done: false, value: 3 });
    expect(cursor.next(null)).toEqual({ done: false, value: 4 });
    expect(cursor.next(true)).toEqual({ done: false, value: 5 });
    expect(cursor.next(null)).toEqual({ done: false, value: 4 });
    expect(cursor.next(false)).toEqual({ done: true, value: { kind: "return", value: 6 } });
  });

  it("retains the for iterator and current target receiver across target yields", () => {
    const first = new Map(), second = new Map(), state = fixture({ obj: first });
    const cursor = state.run("for obj[(yield 1)] in (yield 0):\n yield 2\nelse:\n return 3");
    expect(cursor.next()).toEqual({ done: false, value: 0 });
    expect(cursor.next([4, 5])).toEqual({ done: false, value: 1 });
    state.names.set("obj", second);
    expect(cursor.next("a")).toEqual({ done: false, value: 2 });
    expect([...first]).toEqual([["a", 4]]); expect([...second]).toEqual([]);
    expect(cursor.next(null)).toEqual({ done: false, value: 1 });
    expect(cursor.next("b")).toEqual({ done: false, value: 2 });
    expect([...second]).toEqual([["b", 5]]);
    expect(cursor.next(null)).toEqual({ done: true, value: { kind: "return", value: 3 } });
  });

  it("registers with cleanup before a suspended target can receive an exception", () => {
    const obj = new Map(), state = fixture({ obj }), failure = new Guest("target");
    state.context.managers = {
      prepare(value) {
        state.events.push(`prepare:${value}`);
        return { enter: () => 7, exit: error => { state.events.push(error?.error); return true; } };
      }, truth: Boolean
    };
    const cursor = state.run("with (yield 0) as obj[(yield 1)]:\n yield 2\nyield 3");
    expect(cursor.next()).toEqual({ done: false, value: 0 });
    expect(cursor.next("cm")).toEqual({ done: false, value: 1 });
    expect(cursor.throw(failure)).toEqual({ done: false, value: 3 });
    expect(state.events).toEqual(["prepare:cm", "load:obj", failure]);
    expect(obj.size).toBe(0); expect(state.active()).toBeUndefined();
    expect(cursor.next(null)).toEqual({ done: true, value: { kind: "normal" } });
  });

  it("retains prepared exits and unwinds nested managers once in reverse order", () => {
    const state = fixture({ a: "a", b: "b" });
    state.context.managers = {
      prepare(value) {
        const manager = {
          enter() { state.events.push(`enter:${value}`); manager.exit = () => { throw Error("replacement exit"); }; return null; },
          exit() { state.events.push(`exit:${value}`); return false; }
        };
        return manager;
      }, truth: Boolean
    };
    const cursor = state.run("with a, b:\n return (yield 1)");
    expect(cursor.next()).toEqual({ done: false, value: 1 });
    expect(state.events).toEqual(["load:a", "enter:a", "load:b", "enter:b"]);
    expect(cursor.next(7)).toEqual({ done: true, value: { kind: "return", value: 7 } });
    expect(state.events.slice(-2)).toEqual(["exit:b", "exit:a"]);
  });

  it("keeps handler-search state while its exception type expression yields", () => {
    const failure = new Guest("first"), state = fixture({ failure });
    const cursor = state.run("try:\n raise failure\nexcept (yield 1) as error:\n yield error\nreturn 2");
    expect(cursor.next()).toEqual({ done: false, value: 1 });
    expect(state.active()).toBe(failure); expect(state.names.has("error")).toBe(false);
    expect(cursor.next(Guest)).toEqual({ done: false, value: failure });
    expect(cursor.next(null)).toEqual({ done: true, value: { kind: "return", value: 2 } });
    expect(state.active()).toBeUndefined(); expect(state.names.has("error")).toBe(false);
  });

  it("unwinds a suspended handler search when matching receives another exception", () => {
    const first = new Guest("first"), second = new Guest("second"), state = fixture({ first, E: Guest });
    const cursor = state.run("try:\n try:\n  raise first\n except (yield 1) as inner:\n  yield 99\nexcept E as outer:\n yield outer\nreturn 2");
    expect(cursor.next()).toEqual({ done: false, value: 1 });
    expect(cursor.throw(second)).toEqual({ done: false, value: second });
    expect(state.active()).toBe(second); expect(state.names.has("inner")).toBe(false);
    expect(cursor.next(null)).toEqual({ done: true, value: { kind: "return", value: 2 } });
    expect(state.active()).toBeUndefined(); expect(state.events).not.toContain("clear:inner");
  });

  it("allows a suspended finalizer to replace a pending return", () => {
    const state = fixture(), cursor = state.run("try:\n return 1\nfinally:\n return (yield 2)");
    expect(cursor.next()).toEqual({ done: false, value: 2 });
    expect(cursor.next(7)).toEqual({ done: true, value: { kind: "return", value: 7 } });
  });

  it("routes an exception injected into a finalizer instead of resuming its old return", () => {
    const failure = new Guest("replacement"), state = fixture({ E: Guest });
    const cursor = state.run("try:\n try:\n  return 1\n finally:\n  yield 2\nexcept E as error:\n return error");
    expect(cursor.next()).toEqual({ done: false, value: 2 });
    expect(cursor.throw(failure)).toEqual({ done: true, value: { kind: "return", value: failure } });
    expect(state.active()).toBeUndefined(); expect(state.names.has("error")).toBe(false);
  });

  it("preserves bare raise across a yielding handler and finalizer", () => {
    const failure = new Guest("original"), state = fixture({ failure, E: Guest });
    const cursor = state.run("try:\n try:\n  raise failure\n except E as error:\n  yield 1\n  raise\nfinally:\n yield 2");
    expect(cursor.next()).toEqual({ done: false, value: 1 });
    expect(cursor.next(null)).toEqual({ done: false, value: 2 });
    expect(state.active()).toBe(failure); expect(state.names.has("error")).toBe(false);
    expect(() => cursor.next(null)).toThrow(failure); expect(state.active()).toBeUndefined();
  });

  it("suspends assertion conditions and messages but not disabled assertions", () => {
    const failure = new Guest("assertion"), state = fixture({ E: Guest }), messages: unknown[] = [];
    state.context.assertions = { enabled: true, fail(message) { messages.push(message); throw failure; } };
    const cursor = state.run("try:\n assert (yield 1), (yield 2)\nexcept E:\n yield 3\nreturn 4");
    expect(cursor.next()).toEqual({ done: false, value: 1 });
    expect(cursor.next(false)).toEqual({ done: false, value: 2 });
    const message = {};
    expect(cursor.next(message)).toEqual({ done: false, value: 3 });
    expect(messages).toEqual([{ value: message }]);
    expect(cursor.next(null)).toEqual({ done: true, value: { kind: "return", value: 4 } });
    state.context.assertions.enabled = false;
    expect(state.run("assert (yield 1), (yield 2)\nreturn 5").next()).toEqual({ done: true, value: { kind: "return", value: 5 } });
    expect(messages).toHaveLength(1);
  });

  it("restores bookkeeping without guest cleanup after fatal resume or cancellation", () => {
    for (const cancel of [false, true]) {
      const controller = new AbortController(), failure = new Guest("original"), state = fixture({ failure, E: Guest }, 1000000, controller.signal);
      const cursor = state.run("try:\n try:\n  raise failure\n except E as error:\n  yield 1\nfinally:\n yield 2");
      expect(cursor.next()).toEqual({ done: false, value: 1 });
      if (cancel) {
        controller.abort();
        expect(() => cursor.next(null)).toThrow(ExecutionLimitError);
      } else expect(() => cursor.throw(Error("host fault"))).toThrow("host fault");
      expect(state.active()).toBeUndefined();
      expect(state.events).not.toContain("clear:error");
      expect(cursor.next(null)).toEqual({ done: true, value: undefined });
    }
  });

  it("checks cancellation before starting and reserves storage before construction", () => {
    const controller = new AbortController(), state = fixture({}, 1000000, controller.signal);
    const cursor = state.run("yield missing"); controller.abort();
    expect(() => cursor.next()).toThrow(ExecutionLimitError); expect(state.events).toEqual([]);
    const limited = fixture({}, 223);
    expect(() => limited.run("yield missing")).toThrow("execution allocation limit exceeded");
    expect(limited.events).toEqual([]);
  });

  it("resumes deeply nested finalizers without recursive host statement traversal", () => {
    const template = parseModule("try:\n pass\nfinally:\n yield 1").body[0];
    if (template.kind !== "try") throw Error("invalid fixture");
    let body: readonly Statement[] = parseModule("return 2").body;
    for (let index = 0; index < 5000; index++) body = [{ ...template, body }];
    const state = fixture({}, 2000000), cursor = createStatementContinuation(body, state.context, state.meter);
    for (let index = 0; index < 5000; index++) expect(cursor.next(null)).toEqual({ done: false, value: 1 });
    expect(cursor.next(null)).toEqual({ done: true, value: { kind: "return", value: 2 } });
  });
});
