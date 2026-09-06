import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../core.js";

describe("replacement and matchAll symbol protocols", () => {
  it("allows smaller converted strings at the same budget", async () => {
    let calls = 0;
    expect(await run("const search={toString(){return 'z'}};const replacement={toString(){const value='y'.repeat(2000);check();return value}};return 'text'.replace(search,replacement).length;", {
      budget: new Budget({ dataSize: 7500 }), bindings: { check: () => { calls++; } }
    })).toMatchObject({ ok: true, returnValue: 4 });
    expect(calls).toBe(1);
  });
  it("retains the converted search string during replacement conversion", async () => {
    let calls = 0;
    await expect(run("const search={toString(){return 'x'.repeat(4000)}};const replacement={toString(){const value='y'.repeat(4000);check();return value}};return 'text'.replace(search,replacement);", {
      budget: new Budget({ dataSize: 7500 }), bindings: { check: () => { calls++; } }
    })).rejects.toMatchObject({ budget: "dataSize" });
    expect(calls).toBe(0);
  });
  it.each([
    "const pattern=/t/;pattern[Symbol.replace]=null;return 'text'.replace(pattern,'x');",
    "const pattern=/t/g;pattern[Symbol.replace]=undefined;return 'text'.replaceAll(pattern,'x');",
    "const log=[];const pattern=/t/;pattern[Symbol.match]=false;pattern.lastIndex={valueOf(){log.push('cursor');return 2}};const matches=Array.from('text'.matchAll(pattern));return [matches.map(value=>value[0]),log];",
    "const pattern=/t/;pattern[Symbol.match]=false;return 'text'.replaceAll(pattern,'x');",
    "const pattern=/t/;pattern[Symbol.match]=false;return Array.from('text'.matchAll(pattern)).map(value=>value[0]);",
    "const log=[];const pattern={[Symbol.match]:true,flags:{toString(){log.push('flags-string');return 'g'}},get [Symbol.matchAll](){log.push('hook');return function(){return log}}};return 'text'.matchAll(pattern);",
    "const log=[];return ['text'.replace({toString(){log.push('search');return 't'}},{toString(){log.push('replacement');return 'x'}}),log];",
    "const replacement={};const pattern={[Symbol.replace](value,next){return [this===pattern,value,next===replacement]}};return 'text'.replace(pattern,replacement);",
    "const pattern={[Symbol.replace](value){return value+'!'}};return 'text'.replaceAll(pattern,'x');",
    "const pattern={[Symbol.matchAll](value){return value+'!'}};return 'text'.matchAll(pattern);",
    "const receiver={toString(){throw 'coerced'}};const pattern={[Symbol.replace](value){return value===receiver}};return ''.replace.call(receiver,pattern,{});",
    "const receiver={toString(){throw 'coerced'}};const pattern={[Symbol.matchAll](value){return value===receiver}};return ''.matchAll.call(receiver,pattern);",
    "const log=[];const pattern={get [Symbol.match](){log.push('match');return true},get flags(){log.push('flags');return 'g'},get [Symbol.replace](){log.push('replace');return function(){return log}}};return 'text'.replaceAll(pattern,'x');",
    "const log=[];const pattern={get [Symbol.match](){log.push('match');return true},get flags(){log.push('flags');return ''},get [Symbol.matchAll](){log.push('hook');return function(){return 7}}};try{'text'.matchAll(pattern)}catch(error){return [error.name,log]}",
    "const pattern={[Symbol.match]:false,get flags(){throw 'read'},[Symbol.replace](){return 7}};return 'text'.replaceAll(pattern,'x');",
    "const pattern=/t/;pattern[Symbol.replace]=function(){return 7};try{return 'text'.replaceAll(pattern,'x')}catch(error){return error.name}",
    "const pattern=/t/g;pattern[Symbol.matchAll]=function(value){return value+'!'};return 'text'.matchAll(pattern);",
    "const pattern={[Symbol.match]:true,flags:null,[Symbol.replace](){return 7}};try{return 'text'.replaceAll(pattern,'x')}catch(error){return error.name}",
    "const pattern={[Symbol.replace]:7};try{return 'text'.replace(pattern,'x')}catch(error){return error.name}",
    "const result=Promise.resolve(7);return 'text'.replace({[Symbol.replace](){return result}},'x')===result;",
    "return 'text'.replace({[Symbol.replace]:null,toString(){return 't'}},'x');"
  ])("matches native: %s", async (source) => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
