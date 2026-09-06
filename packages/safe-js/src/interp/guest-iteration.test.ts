import { describe, expect, it } from "vitest";
import { run } from "../core.js";

describe("guest iterator protocol", () => {
  it.each([
    [
      "lookup order and receiver",
      "const log=[];const iterator={get next(){log.push('get next');return function(){log.push(this===iterator?'next receiver':'wrong');return {get done(){log.push('done');return true},get value(){throw 'unused'}}}}};const source={get [Symbol.iterator](){log.push('get iterator');return function(){log.push(this===source?'factory receiver':'wrong');return iterator}}};for(const item of source){throw 'unused'}return log;"
    ],
    [
      "cached next and lazy close",
      "const log=[];let index=0;const iterator={get next(){log.push('get next');return function(){return {done:false,value:++index}}},get return(){log.push('get return');return function(){log.push(this===iterator?'close receiver':'wrong');return {}}}};const source={[Symbol.iterator](){return iterator}};for(const item of source){log.push(item);if(item===2)break}return log;"
    ],
    [
      "spread",
      "const source={[Symbol.iterator](){let index=0;return {next(){return {done:index>=2,value:++index}}}}};return [...source];"
    ],
    [
      "delegation completion",
      "const log=[];const source={[Symbol.iterator](){return {next(){return {get done(){log.push('done');return true},get value(){log.push('value');return 7}}}}}};function* values(){return yield* source}const result=values().next();return [result.done,result.value,log];"
    ],
    [
      "inherited factory",
      "const prototype={[Symbol.iterator](){let done=false;return {next(){const previous=done;done=true;return {done:previous,value:7}}}}};const source=Object.create(prototype);return [...source];"
    ],
    [
      "async results and cleanup",
      "const log=[];const iterator={get next(){log.push('get next');return async function(){log.push(this===iterator?'next receiver':'wrong');return {get done(){log.push('done');return false},get value(){log.push('value');return 7}}}},async return(){log.push(this===iterator?'close receiver':'wrong');return {}}};const source={[Symbol.asyncIterator](){return iterator}};for await(const item of source){log.push(item);break}return log;"
    ],
    [
      "async-from-sync values",
      "let index=0;const source={[Symbol.iterator](){return {next(){return {done:index>=2,value:Promise.resolve(++index)}}}}};const result=[];for await(const value of source)result.push(value);return result;"
    ],
    [
      "async completed result skips value",
      "const source={[Symbol.asyncIterator](){return {async next(){return {done:true,get value(){throw 'unused'}}}}}};for await(const value of source){throw 'unused'}return 7;"
    ]
  ])("matches native %s", async (_name, source) => {
    const expected = await new Function("return async function(){" + source + "}")()();
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
