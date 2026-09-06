import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../core.js";

describe("destructuring assignment reference order", () => {
  it.each([
    [
      "array target before next",
      "const log=[];const target={};function key(){log.push('key');return 'x'}function* source(){log.push('next');yield 7}[target[key()]]=source();return [log,target.x];"
    ],
    [
      "array rest target before exhaustion",
      "const log=[];const target={};function key(){log.push('key');return 'x'}function* source(){log.push('next');yield 7}[...target[key()]]=source();return [log,target.x];"
    ],
    [
      "object target before getter",
      "const log=[];const target={};function key(){log.push('key');return 'x'}const source={get x(){log.push('get');return 7}};({x:target[key()]}=source);return [log,target.x];"
    ],
    [
      "object rest target before copying",
      "const log=[];const target={};function key(){log.push('key');return 'x'}const source={get x(){log.push('get');return 7}};({...target[key()]}=source);return [log,target.x];"
    ],
    [
      "target before default",
      "const log=[];const target={};function key(){log.push('key');return 'x'}function fallback(){log.push('default');return 7}[target[key()]=fallback()]=[];return [log,target.x];"
    ],
    [
      "computed source key before target before getter",
      "const log=[];const target={};function sourceKey(){log.push('source key');return 'x'}function targetKey(){log.push('target key');return 'y'}const source={get x(){log.push('get');return 7}};({[sourceKey()]:target[targetKey()]}=source);return [log,target.y];"
    ],
    [
      "capture target before iterator mutates binding",
      "let target={};const original=target;function* source(){target={};yield 7}[target.x]=source();return [original.x,target.x];"
    ],
    [
      "target error closes before next",
      "const log=[];const source={[Symbol.iterator](){return {next(){log.push('next');return {done:false,value:7}},return(){log.push('close');return {}}}}};function target(){log.push('target');throw 'failure'}try{[target().x]=source}catch(error){return [error,log]}"
    ],
    [
      "primitive target fails only after stepping",
      "const log=[];function* source(){try{log.push('next');yield 7}finally{log.push('close')}}try{[(1).x]=source()}catch(error){return [error.name,log]}"
    ],
    [
      "null target failure ordering",
      "const log=[];const source={[Symbol.iterator](){return {next(){log.push('next');return {done:false,value:7}},return(){log.push('close');return {}}}}};try{[null.x]=source}catch(error){return [error.name,log]}"
    ],
    [
      "nested pattern prepares target after outer value",
      "const log=[];const target={};function key(){log.push('key');return 'x'}function* source(){log.push('outer');yield [7]}[[target[key()]]]=source();return [log,target.x];"
    ]
  ])("matches native %s", async (_name, source) => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
