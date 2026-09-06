import { describe, expect, it, vi } from "vitest";
import { run } from "../core.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { createSandboxClosure, createSandboxPromise } from "./values.js";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";

describe("async generators", () => {
  // ECMAScript 2026 27.1.5.2.3 and 27.1.5.4; Node 22 predates these cleanup rules.
  it.each([false, true])("closes a delegate without throw and reports TypeError (async=%s)", async async => {
    const close = vi.fn(() => ({ done: true, value: undefined }));
    const iterable = { [Symbol.iterator]: () => ({ next: () => ({done:false,value:1}), return: close }) };
    const source = `${async ? "async " : ""}function* items(){yield* iterable}const iterator=items();await iterator.next();try{await iterator.throw(7)}catch(error){return error.name}`;
    const module = parseModule(source);
    expect(await interpret({ type: "BlockStatement", body: module.body, span: module.span }, {bindings:{iterable}}))
      .toMatchObject({ok:true,returnValue:"TypeError"});
    expect(close).toHaveBeenCalledOnce();
  });
  it("closes a sync delegate when its yielded promise rejects", async () => {
    const source = "const events=[];function* inner(){try{yield Promise.reject(7)}finally{events.push('closed')}}async function* outer(){try{yield* inner()}catch(error){events.push(error)}}await outer().next();return events;";
    expect(await run(source)).toMatchObject({ok:true,returnValue:["closed",7]});
  });
  it.each([
    {method:"next",done:false,returns:1},
    {method:"next",done:true,returns:0},
    {method:"throw",done:false,returns:1},
    {method:"return",done:false,returns:1}
  ])("applies close-on-rejection for $method with done=$done", async ({method,done,returns}) => {
    const rejectedResult = () => ({done,value:createSandboxPromise(Promise.reject(7))});
    const close = vi.fn(() => method === "return" ? rejectedResult() : {done:true,value:undefined});
    const iterable = { [Symbol.iterator]: () => {
      let first = true;
      return {
        next: () => { if (first) { first=false; return {done:false,value:1}; } return rejectedResult(); },
        throw: rejectedResult,
        return: close
      };
    } };
    const source = `async function* items(){yield* iterable}const iterator=items();await iterator.next();try{await iterator.${method}()}catch(error){return error}`;
    const module = parseModule(source);
    expect(await interpret({type:"BlockStatement",body:module.body,span:module.span},{bindings:{iterable}}))
      .toMatchObject({ok:true,returnValue:7});
    expect(close).toHaveBeenCalledTimes(returns);
  });
  it.each(["next", "return", "throw"].flatMap(method => [null, undefined, 0, false, "entry"].map(value => ({method,value}))))(
    "rejects primitive delegate $method results: $value", async ({method,value}) => {
      const iterable = { [Symbol.iterator]: () => {
        let first = true;
        return {
          next: () => { if (first) { first = false; return {done:false,value:7}; } return value; },
          return: () => value,
          throw: () => value
        };
      } };
      const source = `async function* items(){yield* iterable}const iterator=items();await iterator.next();return await iterator.${method}(9);`;
      await expect(new Function("iterable", "return async function(){" + source + "}")(iterable)()).rejects.toBeInstanceOf(TypeError);
      const module = parseModule(source);
      await expect(interpret({ type: "BlockStatement", body: module.body, span: module.span }, {
        bindings: { iterable }
      })).rejects.toMatchObject({ name: "TypeError" });
    }
  );
  it("does not mutate sync delegate results and reads done before value", async () => {
    const events: string[] = [];
    const iterable = { [Symbol.iterator]: () => ({ next: () => Object.freeze({
      get done() { events.push("done"); return false; },
      get value() { events.push("value"); return 7; }
    }) }) };
    const source = "async function* items(){yield* iterable}return await items().next();";
    const native = await new Function("iterable", "return async function(){" + source + "}")(iterable)();
    const expectedEvents = [...events];
    events.length = 0;
    const module = parseModule(source);
    expect(await interpret({ type: "BlockStatement", body: module.body, span: module.span }, {
      bindings: { iterable }
    })).toMatchObject({ ok: true, returnValue: native });
    expect(events).toEqual(expectedEvents);
  });
  it("enforces the step budget during async generator consumption", async () => {
    const source = "async function* items(){while(true){yield 1}}const iterator=items();while(true){await iterator.next()}";
    const module = parseModule(source);
    await expect(interpret({ type: "BlockStatement", body: module.body, span: module.span }, {
      budget: new Budget({ maxSteps: 100 })
    })).rejects.toMatchObject({ name: "SandboxError", code: "budgetExceeded" });
  });
  it("does not continue the body or run cleanup after cancellation", async () => {
    const controller = new AbortController();
    const cleanup = vi.fn();
    const source = "async function* items(){try{yield 1;cancel();yield 2}finally{cleanup()}}const iterator=items();await iterator.next();await iterator.next();";
    const module = parseModule(source);
    await expect(interpret({ type: "BlockStatement", body: module.body, span: module.span }, {
      signal: controller.signal,
      bindings: {
        cancel: createSandboxClosure({ call: () => { controller.abort(); } }),
        cleanup: createSandboxClosure({ call: () => { cleanup(); } })
      }
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(cleanup).not.toHaveBeenCalled();
  });
  it.each([
    "async function* items(value=await 1){}",
    "async function* items(value=yield 1){}",
    "async function* items(){function nested(){yield 1}}",
    "async function* items(){const nested=()=>yield 1}",
    "const object={async\n*items(){}};",
    "class Box{async *constructor(){}}",
    "async function* items(){yield\n* []}"
  ])("rejects native-invalid grammar: %s", source => {
    expect(() => new Function(source)).toThrow(SyntaxError);
    expect(() => parseModule(source)).toThrow();
  });
  it.each(["start", "suspended", "done"])("restores an async generator in %s state", async state => {
    const advance = state === "start" ? "" : state === "suspended" ? "await iterator.next();" : "await iterator.next();await iterator.next();await iterator.next();";
    const source = `let effects=0;async function* items(){effects+=1;yield 1;yield 2;return 3}const iterator=items();${advance}await wait();const result=await iterator.next();return [result,effects,typeof iterator.next().then];`;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const original = run(source, { bindings: {
      wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(pending) })
    } });
    let snapshot: ReturnType<typeof JSON.parse>;
    try { snapshot = JSON.parse(await dump(original)); }
    finally { release(); await original; }
    const expected = await original;
    expect(expected.ok).toBe(true);
    expect(await run(source, { snapshot: restore(snapshot, { source }), bindings: {
      wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(Promise.resolve()) })
    } })).toMatchObject({ ok: true, returnValue: expected.ok ? expected.returnValue : undefined });
  });
  it.each([
    ["declaration", "async function* items(){yield 7}return await items().next();"],
    ["expression", "const items=async function*(){yield 7};return await items().next();"],
    ["object method", "const object={value:7,async *items(){yield this.value}};return await object.items().next();"],
    ["class method", "class Box{value=7;async *items(){yield this.value}}return await new Box().items().next();"],
    ["class super", "class Base{read(){return 7}}class Box extends Base{async *items(){yield super.read()+1}}return await new Box().items().next();"],
    ["await in body", "async function* items(){yield await Promise.resolve(7)}return await items().next();"],
    ["promised yield", "async function* items(){yield Promise.resolve(7)}return await items().next();"],
    ["thenable yield", "async function* items(){yield {then(resolve){resolve(7)}}}return await items().next();"],
    ["promised return", "async function* items(){return Promise.resolve(7)}return await items().next();"],
    ["next returns promise", "async function* items(){yield 7}return typeof items().next().then;"],
    ["queued next", "async function* items(){yield await Promise.resolve(1);yield 2;return 3}const iterator=items();return await Promise.all([iterator.next(),iterator.next(),iterator.next(),iterator.next()]);"],
    ["sent value", "async function* items(){const value=yield 1;yield value}const iterator=items();await iterator.next();return await iterator.next(7);"],
    ["sent promise remains promise", "async function* items(){const value=yield 1;yield typeof value.then}const iterator=items();await iterator.next();return await iterator.next(Promise.resolve(7));"],
    ["return before start", "let started=false;async function* items(){started=true;yield 1}const result=await items().return(Promise.resolve(7));return [started,result];"],
    ["rejected return before start closes the generator", "let started=false;async function* items(){started=true;yield 1}const iterator=items();let error;try{await iterator.return(Promise.reject(7))}catch(value){error=value}return [started,error,await iterator.next(),started];"],
    ["throw before start", "let started=false;async function* items(){started=true;yield 1}let error;try{await items().throw(7)}catch(value){error=value}return [started,error];"],
    ["caught throw", "async function* items(){try{yield 1}catch(value){yield value}}const iterator=items();await iterator.next();return await iterator.throw(7);"],
    ["uncaught throw", "async function* items(){yield 1}const iterator=items();await iterator.next();let error;try{await iterator.throw(7)}catch(value){error=value}return [error,await iterator.next()];"],
    ["yield in finally", "async function* items(){try{yield 1}finally{yield Promise.resolve(2)}}const iterator=items();await iterator.next();return [await iterator.return(7),await iterator.next()];"],
    ["queued return", "async function* items(){try{yield 1;yield 2}finally{yield 3}}const iterator=items();return await Promise.all([iterator.next(),iterator.return(7),iterator.next(),iterator.next()]);"],
    ["yield rejection enters catch", "async function* items(){try{yield Promise.reject(7)}catch(value){yield value}}return await items().next();"],
    ["return after completion", "async function* items(){return 1}const iterator=items();await iterator.next();return await iterator.return(Promise.resolve(7));"],
    ["throw after completion", "async function* items(){return 1}const iterator=items();await iterator.next();try{await iterator.throw(7)}catch(value){return value}"],
    ["sync delegation", "async function* items(){yield* [Promise.resolve(1),2]}const iterator=items();return [await iterator.next(),await iterator.next(),await iterator.next()];"],
    ["async delegation", "async function* inner(){yield 1;return 7}async function* outer(){const end=yield* inner();yield end}const iterator=outer();return [await iterator.next(),await iterator.next(),await iterator.next()];"],
    ["sync delegate return promise", "function* inner(){return Promise.resolve(7)}async function* outer(){const end=yield* inner();yield typeof end}return await outer().next();"],
    ["async is not sync iterable", "async function* items(){yield 7}try{return [...items()]}catch(error){return error.name}"],
    ["not constructible", "async function* items(){yield 7}try{new items()}catch(error){return error.name}"],
    ["sync generator control", "function* items(){yield 7}return items().next();"],
    ["async function control", "async function value(){return 7}return await value();"],
    ["computed method", "const key='items';const object={async *[key](){yield 7}};return await object.items().next();"],
    ["static method", "class Box{static async *items(){yield 7}}return await Box.items().next();"],
    ["synchronous prefix", "const events=[];async function* items(){events.push('body');yield 7}const iterator=items();events.push('created');const pending=iterator.next();events.push('called');await pending;return events;"],
    ["return rejection is caught before finally", "const events=[];async function* items(){try{return Promise.reject(7)}catch(value){events.push(value);yield 2}finally{events.push('finally')}}const iterator=items();return [await iterator.next(),await iterator.next(),events];"],
    ["return promise settles before finally", "const events=[];async function* items(){try{return {then(resolve){events.push('then');resolve(7)}}}finally{events.push('finally')}}const result=await items().next();return [result,events];"],
    ["rejected return request enters catch", "async function* items(){try{yield 1}catch(error){yield error}finally{yield 3}}const iterator=items();await iterator.next();return [await iterator.return(Promise.reject(7)),await iterator.next(),await iterator.next()];"],
    ["queued rejection recovery", "async function* items(){yield 1;throw 7}const iterator=items();return await Promise.allSettled([iterator.next(),iterator.next(),iterator.next(),iterator.return(8)]);"],
    ["throw argument is not unwrapped", "async function* items(){try{yield 1}catch(error){yield typeof error.then}}const iterator=items();await iterator.next();return await iterator.throw(Promise.resolve(7));"],
    ["nested ordinary function cannot inherit yield", "async function* items(){function value(){return 7}yield value()}return await items().next();"],
    ["nested ordinary return stays a promise", "async function* items(){function value(){return Promise.resolve(7)}yield typeof value().then}return await items().next();"],
    ["delegated throw", "async function* inner(){try{yield 1}catch(error){yield error}}async function* outer(){yield* inner()}const iterator=outer();await iterator.next();return [await iterator.throw(7),await iterator.next()];"],
    ["delegated return finally", "async function* inner(){try{yield 1}finally{yield 2}}async function* outer(){yield* inner()}const iterator=outer();await iterator.next();return [await iterator.return(7),await iterator.next(),await iterator.next()];"],
  ])("matches native %s", async (_name, source) => {
    const native = new Function(`return async function(){'use strict';${source}}`)();
    const expected = await native();
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
