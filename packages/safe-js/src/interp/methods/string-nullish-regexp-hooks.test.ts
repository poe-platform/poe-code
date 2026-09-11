import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../core.js";

describe("nullish RegExp string protocol fallbacks", () => {
  it.each(["match", "matchAll", "search"] as const)("coerces a pattern after a nullish %s hook", async method => {
    for (const hook of ["null", "undefined"]) {
      const source = `const regex=/a/g;regex.lastIndex=2;regex[Symbol.${method}]=${hook};const result='a/a/g'.${method}(regex);return [${method === "search" ? "result" : method === "matchAll" ? "Array.from(result).map(value=>[value[0],value.index])" : "result===null?null:[result[0],result.index]"},regex.lastIndex];`;
      const expected = runInNewContext("(function(){'use strict';" + source + "})()");
      expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
    }
  });

  it.each([
    "const regex=/a/;regex.toString=()=> 'b';return String(regex);",
    "const regex=/a/;regex[Symbol.toPrimitive]=hint=>hint==='number'?7:'b';return [String(regex),Number(regex)];",
    "const log=[];const regex=/a/;Object.defineProperty(regex,'toString',{get(){log.push(this===regex);return function(){return this===regex?'b':'wrong'}}});return [String(regex),log];",
    "const regex=/a/;Object.defineProperty(regex,Symbol.match,{configurable:true,get(){delete regex[Symbol.match];return null}});return 'a/a/'.match(regex)[0];",
    "const regex=/a/;regex[Symbol.search]=null;const receiver={toString(){delete regex[Symbol.search];return 'a/a/'}};return ''.search.call(receiver,regex);",
    "const regex=/a/g;regex[Symbol.matchAll]=null;const receiver={toString(){delete regex[Symbol.matchAll];return 'a/a/g'}};return Array.from(''.matchAll.call(receiver,regex)).map(match=>[match[0],match.index]);",
    "const regex=/a/;regex[Symbol.match]=null;const result='a/a/'.match(regex);return [result[0],result.index];",
    "const regex=/a/g;regex[Symbol.match]=false;regex[Symbol.matchAll]=null;return Array.from('a/a/g'.matchAll(regex)).map(match=>[match[0],match.index]);",
    "const log=[];const regex=/a/g;regex.lastIndex={valueOf(){throw 'cursor'}};Object.defineProperty(regex,Symbol.matchAll,{get(){log.push('hook');return null}});regex.toString=()=>{log.push('pattern');return 'b'};return [Array.from('aba'.matchAll(regex)).map(match=>match.index),log];",
    "const log=[];const regex=/a/;regex.lastIndex={valueOf(){throw 'cursor'}};Object.defineProperty(regex,Symbol.match,{get(){log.push('hook');return null}});regex.toString=()=>{log.push('pattern');return 'b'};return ['aba'.match(regex)[0],log];",
    "const log=[];const receiver={toString(){log.push('receiver');return 'aba'}};const regex=/a/;Object.defineProperty(regex,Symbol.search,{get(){log.push('hook');return undefined}});regex.toString=()=>{log.push('pattern');return 'b'};return [''.search.call(receiver,regex),log];"
  ])("matches native: %s", async source => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
