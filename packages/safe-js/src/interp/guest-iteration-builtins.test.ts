import { describe, expect, it } from "vitest";
import { run } from "../core.js";

describe("built-in guest iterator consumers", () => {
  it.each([
    "Array.from(new Set(source))",
    "Array.from(new Map(source).entries())",
    "Object.fromEntries(source)"
  ])("consumes guest entry data in %s", async (consumer) => {
    const source = `let index=0;const source={[Symbol.iterator](){return {next(){return {done:index>=2,value:['key'+index,++index]}}}}};return ${consumer};`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
  });
  it.each(["new Map(source)", "Object.fromEntries(source)"])(
    "closes invalid guest entries in %s",
    async (consumer) => {
      const source = `const log=[];const iterator={next(){return {done:false,value:7}},return(){log.push(this===iterator?'closed':'wrong');return {}}};const source={[Symbol.iterator](){return iterator}};try{${consumer}}catch(error){log.push(error.name)}return log;`;
      expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
    }
  );
  it.each([
    "Array.from(source)",
    "await Promise.all(source)",
    "await Promise.allSettled(source)",
    "await Promise.race(source)",
    "await Promise.any(source)"
  ])("preserves protocol getter order in %s", async (consumer) => {
    const source = `const log=[];let index=0;const iterator={get next(){log.push('next');return function(){const done=index===2;const value=++index;return {get done(){log.push('done');return done},get value(){log.push('value');if(done)throw 'unused';return value}}}}};const source={get [Symbol.iterator](){log.push('iterator');return function(){return iterator}}};const result=${consumer};return [result,log];`;
    const expected = await new Function("return async function(){" + source + "}")()();
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    "Array.from(source,()=>{throw 'callback'})",
    "await (async()=>{function Result(executor){return new Promise(executor)}Result.resolve=()=>{throw 'callback'};return Promise.all.call(Result,source)})()"
  ])("closes a guest iterator after failure in %s", async (consumer) => {
    const source = `const log=[];const iterator={next(){return {done:false,value:7}},get return(){log.push('get return');return function(){log.push(this===iterator?'receiver':'wrong');throw 'cleanup'}}};const source={[Symbol.iterator](){return iterator}};try{${consumer}}catch(error){log.push(error)}return log;`;
    const expected = await new Function("return async function(){" + source + "}")()();
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
