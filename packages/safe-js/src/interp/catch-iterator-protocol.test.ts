import { expect, it } from "vitest";
import { run } from "../run.js";

it("uses Proxy reflection for catch object rest", async () => {
  const source = `const log=[];const value=new Proxy({a:1,b:2},{
    ownKeys(t){log.push('keys');return Reflect.ownKeys(t)},
    getOwnPropertyDescriptor(t,k){log.push('desc:'+k);return Reflect.getOwnPropertyDescriptor(t,k)},
    get(t,k){log.push('get:'+String(k));return t[k]}});
    try{throw value}catch({a,...rest}){return [a,rest.b,log]}`;
  const actual = await run(source);
  expect(actual.ok).toBe(true);
  if (actual.ok)
    expect(structuredClone(actual.returnValue)).toStrictEqual(
      Function('"use strict";' + source)(),
    );
});

it.each([
  "try { throw new Set([1,2]); } catch ([a,b]) { return [a,b]; }",
  "try { throw '😀x'; } catch ([a,...rest]) { return [a,rest]; }",
  "const a=[1];a[Symbol.iterator]=function*(){yield 7};try{throw a}catch([x]){return x}",
  "let closed=false;function* values(){try{yield 1;yield 2}finally{closed=true}}try{throw values()}catch([x]){return [x,closed]}",
  "const log=[];const value={[Symbol.iterator](){return this},next(){log.push('next');return {done:false,value:1}},return(){log.push('close');return {}}};try{throw value}catch([]){return log}",
  "try{throw [1,2]}catch([a,b]){return [a,b]}",
  "let closed=false;function* values(){try{yield undefined}finally{closed=true}}try{try{throw values()}catch([x=(()=>{throw 'default'})()]){}}catch(e){return [e,closed]}",
  "let x=3;try{try{throw [undefined]}catch([x=x]){}}catch(e){return e.name}",
  "try{throw new Set([undefined,2])}catch([a=()=>1,b]){return [a.name,a(),b]}",
  "try{throw new Map([['a',1],['b',2]])}catch([[a,b],...rest]){return [a,b,rest]}",
  "let reads=0;const value={[Symbol.iterator](){return this},next(){return {done:false,get value(){reads++;return 1}}},return(){return {}}};try{throw value}catch([,x]){return [reads,x]}",
])("catch destructuring follows the iterator protocol: %s", async (source) => {
  const expected = Function('"use strict";' + source)();
  const actual = await run(source);
  expect(actual.ok).toBe(true);
  if (actual.ok)
    expect(structuredClone(actual.returnValue)).toStrictEqual(expected);
});

it.each(
  ["next", "done", "value", "none"].flatMap((failure) =>
    ['throw "close"', "return 1", "return {}"].map((closing) => ({
      failure,
      closing,
    })),
  ),
)(
  "catch iterator failure at $failure with $closing",
  async ({ failure, closing }) => {
    const source = `const log=[];const iterable={
      [Symbol.iterator](){return this},
      next(){log.push('next');${failure === "next" ? 'throw "next";' : ""}
        return {get done(){log.push('done');${failure === "done" ? 'throw "done";' : ""}return false},
          get value(){log.push('value');${failure === "value" ? 'throw "value";' : ""}return 1}}},
      return(){log.push('return');${closing}}};
      let result='ok';try{try{throw iterable}catch([x]){}}
      catch(e){result=e instanceof TypeError?'TypeError':e}return [result,log];`;
    const expected = Function('"use strict";' + source)();
    const actual = await run(source);
    expect(actual.ok).toBe(true);
    if (actual.ok)
      expect(structuredClone(actual.returnValue)).toStrictEqual(expected);
  },
);
