import { describe, expect, it, vi } from "vitest";
import { run } from "../core.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { SandboxError } from "./budget.js";
import { createSandboxClosure, createSandboxPromise } from "./values.js";

function program(source: string) {
  const module = parseModule(source);
  return { type: "BlockStatement" as const, body: module.body, span: module.span };
}

describe("for-of iterator closing", () => {
  it("preserves the body error after checkpoint resume", async () => {
    const source = "function* items(){try{yield 1}finally{throw 'close'}}try{for(const value of items()){await wait();throw 'body'}}catch(e){return e}";
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const original = run(source, { bindings: {
      wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(pending) })
    } });
    let snapshot: ReturnType<typeof JSON.parse>;
    try { snapshot = JSON.parse(await dump(original)); }
    finally { release(); await original; }
    expect(await original).toMatchObject({ ok: true, returnValue: "body" });
    expect(await run(source, { snapshot: restore(snapshot, { source }), bindings: {
      wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(Promise.resolve()) })
    } })).toMatchObject({ ok: true, returnValue: "body" });
  });

  it("does not run cleanup effects after cancellation", async () => {
    const controller = new AbortController();
    const cleanup = vi.fn();
    const source = "function* items(){try{yield 1}finally{cleanup()}}for(const value of items()){cancel()}";
    await expect(interpret(program(source), { signal: controller.signal, bindings: {
      cancel: createSandboxClosure({ call: () => { controller.abort(); } }),
      cleanup: createSandboxClosure({ call: () => { cleanup(); } })
    } })).rejects.toMatchObject({ name: "AbortError" });
    expect(cleanup).not.toHaveBeenCalled();
  });
  it.each([
    ["object binding failure", "let closed=false;function* items(){try{yield null}finally{closed=true}}try{for(const {x} of items()){}}catch(e){}return closed;"],
    ["array binding failure", "let closed=false;function* items(){try{yield undefined}finally{closed=true}}try{for(const [x] of items()){}}catch(e){}return closed;"],
    ["body error precedence", "function* items(){try{yield 1}finally{throw 'close'}}try{for(const value of items()){throw 'body'}}catch(e){return e}"],
    ["nested error precedence", "function* outer(){try{yield 1}finally{throw 'outer'}}function* inner(){try{yield 1}finally{throw 'inner'}}try{for(const a of outer()){for(const b of inner()){throw 'body'}}}catch(e){return e}"],
    ["normal break", "let closed=false;function* items(){try{yield 1}finally{closed=true}}for(const value of items()){break}return closed;"],
    ["return precedence", "function* items(){try{yield 1}finally{throw 9}}function f(){for(const x of items()){return 7}}try{return f()}catch(e){return e}"],
    ["labeled break", "const log=[];function* items(name){try{yield 1}finally{log.push(name)}}done:for(const a of items('outer')){for(const b of items('inner')){break done}}return log;"],
    ["labeled continue", "const log=[];function* items(name){try{yield 1;yield 2}finally{log.push(name)}}next:for(const a of items('outer')){for(const b of items('inner')){continue next}}return log;"]
  ])("matches native %s", async (_name, source) => {
    const expected = new Function(source)();
    const result = await run(source);
    expect(result).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["undefined", "null", "false", "0", "''"])("preserves body throw %s", async value => {
    const source = `function* items(){try{yield 1}finally{throw 9}}try{for(const x of items()){throw ${value}}}catch(e){return [true,e]}`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
  });

  it.each(["break;", "return value;", "throw 7;"])("closes ordinary iterators on %s", async body => {
    const close = vi.fn(() => ({ done: true, value: undefined }));
    const iterable = { [Symbol.iterator]: () => ({ next: () => ({ done: false, value: 1 }), return: close }) };
    const source = `try{for(const value of iterable){${body}}}catch(e){return e}`;
    new Function("iterable", source)(iterable);
    expect(close).toHaveBeenCalledTimes(1);
    close.mockClear();
    await interpret(program(source), { bindings: { iterable: iterable as never } });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(["break;", "throw 7;"])("validates return and preserves completion for %s", async body => {
    for (const mode of ["primitive", "getterThrow", "noncallable", "thenable", "callableResult", "nullResult"] as const) {
      const make = (log: string[]) => ({
        [Symbol.iterator]() {
          return {
            next: () => ({ done: false, value: 1 }),
            get return() {
              log.push("get");
              if (mode === "getterThrow") throw 9;
              if (mode === "noncallable") return 1;
              return () => {
                log.push("call");
                if (mode === "thenable") return { get then() { log.push("then"); return undefined; } };
                if (mode === "callableResult") return () => undefined;
                if (mode === "nullResult") return null;
                return 1;
              };
            }
          };
        }
      });
      const source = `try{for(const value of iterable){${body}}return 'ok'}catch(e){return typeof e==='object'?e.name:e}`;
      const nativeLog: string[] = [];
      const safeLog: string[] = [];
      const expected = new Function("iterable", source)(make(nativeLog));
      expect(await interpret(program(source), { bindings: { iterable: make(safeLog) as never } }))
        .toMatchObject({ ok: true, returnValue: expected });
      expect(safeLog).toEqual(nativeLog);
    }
  });

  it.each(["next", "done", "value"])("does not close after an iterator %s failure", async phase => {
    const close = vi.fn(() => ({ done: true }));
    const iterable = { [Symbol.iterator]() {
      return {
        next() {
          if (phase === "next") throw 7;
          return { get done() { if (phase === "done") throw 7; return false; }, get value() { throw 7; } };
        },
        return: close
      };
    } };
    const source = "try{for(const value of iterable){}}catch(e){return e}";
    expect(new Function("iterable", source)(iterable)).toBe(7);
    expect(await interpret(program(source), { bindings: { iterable: iterable as never } }))
      .toMatchObject({ ok: true, returnValue: 7 });
    expect(close).not.toHaveBeenCalled();
  });

  it.each([
    new SandboxError({ budget: "steps", current: 2, limit: 1 }),
    new SandboxError("reentry")
  ])("preserves fatal %s without cleanup effects", async fatal => {
    const cleanup = vi.fn();
    const source = "function* items(){try{yield 1}finally{cleanup()}}for(const value of items()){stop()}";
    await expect(interpret(program(source), { bindings: {
      stop: createSandboxClosure({ call: () => { throw fatal; } }),
      cleanup: createSandboxClosure({ call: () => { cleanup(); } })
    } })).rejects.toBe(fatal);
    expect(cleanup).not.toHaveBeenCalled();
  });
});
