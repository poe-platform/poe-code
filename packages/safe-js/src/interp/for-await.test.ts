import { describe, expect, it, vi } from "vitest";
import { run } from "../core.js";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { createSandboxClosure, createSandboxPromise } from "./values.js";
import { Budget } from "./budget.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

describe("for-await iteration", () => {
  it.each(["missing", "null", "noncallable", "primitive", "bad-next", "bad-result"])(
    "matches native async protocol acquisition: %s", async mode => {
      const events: string[] = [];
      const iterable = {
        get [Symbol.asyncIterator]() {
          events.push("async");
          if (mode === "missing") return undefined;
          if (mode === "null") return null;
          if (mode === "noncallable") return 1;
          return function(this: unknown) {
            events.push(this === iterable ? "receiver" : "wrong receiver");
            if (mode === "primitive") return 1;
            return {next: mode === "bad-next" ? 1 : () => Promise.resolve(1)};
          };
        },
        *[Symbol.iterator]() { events.push("sync"); yield 7; }
      };
      const source = "try{for await(const value of iterable){return value}}catch(error){return error.name}";
      const expected = await new Function("iterable", "return async function(){" + source + "}")(iterable)();
      const expectedEvents = [...events];
      events.length = 0;
      const module = parseModule(source);
      expect(await interpret({type:"BlockStatement",body:module.body,span:module.span},{bindings:{iterable}}))
        .toMatchObject({ok:true,returnValue:expected});
      expect(events).toEqual(expectedEvents);
    }
  );
  it.each([
    "let calls=0;function values(){calls+=1;return [1,2]}const out=[];for await(const value of values()){out.push(value);await wait()}return [out,calls];",
    "let calls=0;async function* values(){calls+=1;yield 1;yield 2}const out=[];for await(const value of values()){out.push(value);await wait()}return [out,calls];",
    "const events=[];async function* values(){try{yield 1}finally{events.push('close');await wait();events.push('closed')}}for await(const value of values()){events.push(value);break}return events;"
  ])("resumes without duplicating loop or close effects: %s", async source => {
    const expected=await new Function("wait","return async function(){"+source+"}")(()=>Promise.resolve())();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release=resolve; });
    const original = run(source, {bindings:{
      wait:createSandboxClosure({async:true,call:()=>createSandboxPromise(pending)})
    }});
    let snapshot: ReturnType<typeof JSON.parse>;
    try { snapshot=JSON.parse(await dump(original)); }
    finally { release(); await original; }
    expect(await original).toMatchObject({ok:true,returnValue:expected});
    expect(await run(source,{snapshot:restore(snapshot,{source}),bindings:{
      wait:createSandboxClosure({async:true,call:()=>createSandboxPromise(Promise.resolve())})
    }})).toMatchObject({ok:true,returnValue:expected});
  });
  it.each(["next", "done", "value"])("does not close an async iterator when %s fails before the body", async failure => {
    const close=vi.fn(() => ({done:true,value:undefined}));
    const iterable={ [Symbol.asyncIterator]:()=>({
      next:()=>{
        if(failure==="next") return Promise.reject(7);
        return {
          get done(){if(failure==="done")throw 7;return false;},
          get value(){throw 7;}
        };
      },
      return:close
    })};
    const source="try{for await(const value of iterable){}}catch(error){return error}";
    const expected=await new Function("iterable","return async function(){"+source+"}")(iterable)();
    const nativeCloses=close.mock.calls.length;
    close.mockClear();
    const module=parseModule(source);
    expect(await interpret({type:"BlockStatement",body:module.body,span:module.span},{bindings:{iterable}}))
      .toMatchObject({ok:true,returnValue:expected});
    expect(close).toHaveBeenCalledTimes(nativeCloses);
  });
  it("does not read the value of a completed async iterator", async () => {
    const read=vi.fn(()=>{throw new Error("value must not be read");});
    const iterable={ [Symbol.asyncIterator]:()=>({next:()=>({done:true,get value(){return read();}})})};
    const module=parseModule("for await(const value of iterable){}return 7;");
    expect(await interpret({type:"BlockStatement",body:module.body,span:module.span},{bindings:{iterable}}))
      .toMatchObject({ok:true,returnValue:7});
    expect(read).not.toHaveBeenCalled();
  });
  it.each([false, true])("does not assimilate an async iterator result twice (signal=%s)", async signal => {
    const events: string[] = [];
    const iterable = { [Symbol.asyncIterator]: () => ({next: () => ({
      get then() { events.push("then"); return undefined; },
      get done() { events.push("done"); return false; },
      get value() { events.push("value"); return 7; }
    })}) };
    const source = "for await(const value of iterable){return value}";
    const expected = await new Function("iterable", "return async function(){" + source + "}")(iterable)();
    const expectedEvents = [...events];
    events.length = 0;
    const module = parseModule(source);
    expect(await interpret({type:"BlockStatement",body:module.body,span:module.span},{
      bindings:{iterable},...(signal ? {signal:new AbortController().signal} : {})
    })).toMatchObject({ok:true,returnValue:expected});
    expect(events).toEqual(expectedEvents);
  });
  it.each([false, true])("accepts callable iterator-result objects (async=%s)", async async => {
    const result = Object.assign(function result() {}, {done:false,value:7});
    const iterable = { [async ? Symbol.asyncIterator : Symbol.iterator]: () => ({next: () => result}) };
    const source = "for await(const value of iterable){return value}";
    const expected = await new Function("iterable", "return async function(){" + source + "}")(iterable)();
    const module = parseModule(source);
    expect(await interpret({type:"BlockStatement",body:module.body,span:module.span},{bindings:{iterable}}))
      .toMatchObject({ok:true,returnValue:expected});
  });
  it("cancels a pending async iterator pull without cleanup effects", async () => {
    const controller = new AbortController();
    const close = vi.fn();
    const iterable = { [Symbol.asyncIterator]: () => ({
      next: () => { queueMicrotask(() => controller.abort()); return new Promise(() => {}); },
      return: close
    }) };
    const module = parseModule("for await(const value of iterable){};");
    await expect(interpret({type:"BlockStatement",body:module.body,span:module.span}, {
      signal:controller.signal,bindings:{iterable}
    })).rejects.toMatchObject({name:"AbortError"});
    expect(close).not.toHaveBeenCalled();
  });
  it("enforces the step budget during async iteration", async () => {
    const module = parseModule("async function* items(){while(true){yield 1}}for await(const value of items()){}");
    await expect(interpret({type:"BlockStatement",body:module.body,span:module.span}, {
      budget:new Budget({maxSteps:100})
    })).rejects.toMatchObject({name:"SandboxError",code:"budgetExceeded"});
  });
  it.each(["await 1;", "for await(const value of [1]){}"])("accounts for implicit await depth: %s", async source => {
    const module=parseModule(source);
    await expect(interpret({type:"BlockStatement",body:module.body,span:module.span},{
      budget:new Budget({maxCallDepth:0})
    })).rejects.toMatchObject({name:"SandboxError",code:"budgetExceeded",budget:"callDepth"});
  });
  it.each([false, true])("distinguishes promised values for async protocol=%s", async async => {
    let index = 0;
    const iterable = { [async ? Symbol.asyncIterator : Symbol.iterator]: () => ({
      next: () => {
        const result = {done:index++ > 0,value:createSandboxPromise(Promise.resolve(7))};
        return async ? Promise.resolve(result) : result;
      }
    }) };
    const module = parseModule("const out=[];for await(const value of iterable){out.push(typeof value.then)}return out;");
    expect(await interpret({type:"BlockStatement",body:module.body,span:module.span},{bindings:{iterable}}))
      .toMatchObject({ok:true,returnValue:[async ? "function" : "undefined"]});
  });
  it("does not await the result object from a synchronous iterator", async () => {
    const iterable = { [Symbol.iterator]: () => ({next: () => Promise.resolve({done:false,value:7})}) };
    const source = "for await(const value of iterable){return value}";
    const expected = await new Function("iterable", "return async function(){" + source + "}")(iterable)();
    const module = parseModule(source);
    expect(await interpret({type:"BlockStatement",body:module.body,span:module.span},{bindings:{iterable}}))
      .toMatchObject({ok:true,returnValue:expected});
  });
  it.each([
    ["array", "const out=[];for await(const value of [1,2]){out.push(value)}return out;"],
    ["promised array", "const out=[];for await(const value of [Promise.resolve(7)]){out.push(value)}return out;"],
    ["string", "const out=[];for await(const value of 'ab'){out.push(value)}return out;"],
    ["sync generator", "function* items(){yield Promise.resolve(7)}const out=[];for await(const value of items()){out.push(value)}return out;"],
    ["async generator", "async function* items(){yield 7}const out=[];for await(const value of items()){out.push(value)}return out;"],
    ["member target", "const out={};for await(out.value of [7]){}return out.value;"],
    ["destructuring", "let value;for await({value} of [{value:7}]){}return value;"],
    ["declaration destructuring", "const out=[];for await(const [value] of [[7]]){out.push(value)}return out;"],
    ["continue", "const out=[];for await(const value of [1,2,3]){if(value===2)continue;out.push(value)}return out;"],
    ["await close", "const out=[];async function* items(){try{yield 1}finally{await Promise.resolve();out.push(7)}}for await(const value of items()){break}return out;"],
    ["throw beats close rejection", "async function* items(){try{yield 1}finally{throw 9}}try{for await(const value of items()){throw 7}}catch(error){return error}"],
    ["break exposes close rejection", "async function* items(){try{yield 1}finally{throw 9}}try{for await(const value of items()){break}}catch(error){return error}"],
    ["async rejected yield cleanup", "const out=[];async function* items(){try{yield Promise.reject(7)}finally{out.push(9)}}try{for await(const value of items()){out.push(value)}}catch(error){out.push(error)}return out;"],
    ["body await", "const out=[];for await(const value of [1,2]){out.push(await Promise.resolve(value))}return out;"],
    ["async function", "async function read(){for await(const value of [7])return value}return await read();"],
    ["async arrow", "const read=async()=>{for await(const value of [7])return value};return await read();"],
    ["async method", "const object={async read(){for await(const value of [7])return value}};return await object.read();"],
    ["async generator body", "async function* items(){for await(const value of [7])yield value}return await items().next();"],
    ["empty loop", "let count=0;for await(const value of []){count+=1}return count;"],
    ["sync for-of control", "const out=[];for(const value of [1,2]){out.push(value)}return out;"]
  ])("matches native %s", async (_name, source) => {
    const expected = await new Function("return async function(){'use strict';" + source + "}")()();
    expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
  });

  it("closes a synchronous iterator on rejected yielded values under ES2026", async () => {
    // Node22 predates AsyncFromSyncIteratorContinuation's close-on-rejection rule.
    const source = "const out=[];function* items(){try{yield Promise.reject(7)}finally{out.push(9)}}try{for await(const value of items()){out.push(value)}}catch(error){out.push(error)}return out;";
    expect(await run(source)).toMatchObject({ok:true,returnValue:[9,7]});
  });

  it.each([
    "function read(){for await(const value of []){}}",
    "const read=()=>{for await(const value of []){}};",
    "function* read(){for await(const value of []){}}",
    "class Box{static{for await(const value of []){}}}",
    "for await(const value in {}){}",
    "for await(;;){}",
    "for await(let value=1 of []){}"
  ])("rejects native-invalid loop syntax: %s", source => {
    expect(() => new Function("return async function(){" + source + "}")).toThrow(SyntaxError);
    expect(() => parseModule(source)).toThrow();
  });
});
