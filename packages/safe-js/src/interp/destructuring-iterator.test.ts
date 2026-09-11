import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../core.js";

describe("destructuring iterator protocol", () => {
  it.each([
    [
      "guest iterator and close",
      "const log=[];const source={[Symbol.iterator](){return {next(){return {done:false,value:7}},return(){log.push('close');return {}}}}};const [first]=source;return [first,log];"
    ],
    [
      "empty pattern closes without stepping",
      "const log=[];const source={[Symbol.iterator](){return {next(){throw 'unused'},return(){log.push('close');return {}}}}};const []=source;return log;"
    ],
    [
      "rest exhausts without closing",
      "const log=[];const source={[Symbol.iterator](){let n=0;return {next(){return {done:n===3,value:n++}},return(){log.push('close');return {}}}}};const [first,...rest]=source;return [first,rest,log];"
    ],
    [
      "elision skips value getter",
      "const log=[];const source={[Symbol.iterator](){let n=0;return {next(){const value=++n;return {done:false,get value(){log.push(value);return value}}},return(){return {}}}}};const [,second]=source;return [second,log];"
    ],
    [
      "custom array iterator",
      "const source=[1,2];source[Symbol.iterator]=function*(){yield 9};const [first,...rest]=source;return [first,rest];"
    ],
    [
      "generator closes",
      "const log=[];function* source(){try{yield 7;yield 8}finally{log.push('close')}}const [first]=source();return [first,log];"
    ],
    [
      "default failure closes and preserves error",
      "const log=[];const source={[Symbol.iterator](){return {next(){return {done:false,value:undefined}},return(){log.push('close');throw 'close error'}}}};try{const [first=(()=>{throw 'default error'})()]=source}catch(error){return [error,log]}"
    ],
    [
      "step failure does not close",
      "const log=[];const source={[Symbol.iterator](){return {next(){throw 'next error'},return(){log.push('close');return {}}}}};try{const [first]=source}catch(error){return [error,log]}"
    ],
    [
      "value failure does not close",
      "const log=[];const source={[Symbol.iterator](){return {next(){return {done:false,get value(){throw 'value error'}}},return(){log.push('close');return {}}}}};try{const [first]=source}catch(error){return [error,log]}"
    ],
    [
      "assignment closes",
      "const log=[];function* source(){try{yield 7}finally{log.push('close')}}let first;[first]=source();return [first,log];"
    ],
    [
      "function parameter closes",
      "const log=[];function* source(){try{yield 7}finally{log.push('close')}}function read([first]){return first}return [read(source()),log];"
    ],
    [
      "done suppresses further next and value reads",
      "let calls=0;const source={[Symbol.iterator](){return {next(){if(++calls>1)throw 'extra';return {done:true,get value(){throw 'unused'}}}}}};const [first=7,second=8]=source;return [first,second,calls];"
    ]
  ])("matches native %s", async (_name, source) => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
