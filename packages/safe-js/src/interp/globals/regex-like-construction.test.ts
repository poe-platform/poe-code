import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";

describe("RegExp identity and regex-like inputs", () => {
  it.each([
    "const pattern={[Symbol.match]:{valueOf(){throw 'coerce'}},source:'a',flags:'i'};return RegExp(pattern).test('A');",
    "const pattern={get [Symbol.match](){Object.defineProperty(this,Symbol.match,{value:false});return true},source:'a',flags:'i'};return RegExp(pattern).test('A');",
    "const regex=/a/;regex[Symbol.match]=false;return RegExp(regex)===regex;",
    "const regex=/a/;regex.constructor=function Other(){};return RegExp(regex)===regex;",
    "const regex=/a/;regex.constructor=undefined;return RegExp(regex)===regex;",
    "const pattern={[Symbol.match]:true,source:'a',flags:'i'};return RegExp(pattern).test('A');",
    "const pattern={[Symbol.match]:true,constructor:RegExp};return RegExp(pattern)===pattern;",
    "const regex=/a/g;Object.defineProperty(regex,Symbol.match,{get(){throw 'match'}});try{return new RegExp(regex)}catch(error){return error}",
    "const regex=/a/;Object.defineProperty(regex,'constructor',{get(){throw 'constructor'}});try{return RegExp(regex)}catch(error){return error}",
    "const regex=/a/;Object.defineProperty(regex,'constructor',{get(){throw 'constructor'}});return new RegExp(regex).source;",
    "const regex=/a/;Object.defineProperty(regex,'constructor',{get(){throw 'constructor'}});return RegExp(regex,'i').flags;",
    "const log=[];const pattern={get [Symbol.match](){log.push('match');return true},get constructor(){log.push('constructor');return undefined},get source(){log.push('source');return {toString(){log.push('source string');return 'a'}}},get flags(){log.push('flags');return {toString(){log.push('flags string');return 'i'}}}};const regex=RegExp(pattern);return [regex.source,regex.flags,log];",
    "const pattern={[Symbol.match]:true,source:'a',get flags(){throw 'flags'}};return new RegExp(pattern,'i').flags;",
    "const pattern={[Symbol.match]:false,source:'b',flags:'i',toString(){return 'a'}};return RegExp(pattern).source;",
    "const regex=/a/g;regex.lastIndex=2;regex[Symbol.match]=false;Object.defineProperty(regex,'source',{get(){throw 'source'}});Object.defineProperty(regex,'flags',{get(){throw 'flags'}});const copy=RegExp(regex);return [copy.source,copy.flags,copy.lastIndex];",
    "const pattern=()=>0;pattern[Symbol.match]=true;pattern.source='a';pattern.flags='i';return RegExp(pattern).test('A');"
  ])("matches native: %s", async source => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });

  it("retains a detached source while reading flags", async () => {
    const source = "const pattern={[Symbol.match]:true,get source(){return {payload:'x'.repeat(4000),toString(){return 'a'}}},get flags(){const temporary='y'.repeat(4000);throw 'flags'}};try{return RegExp(pattern)}catch(error){return error}";
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: 'budgetExceeded', budget: 'dataSize' });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: 'flags' });
  });

  it("retains detached flags while coercing source", async () => {
    const source = "const pattern={[Symbol.match]:true,get source(){return {toString(){const temporary='y'.repeat(4000);throw 'source'}}},get flags(){return {payload:'x'.repeat(4000),toString(){return 'i'}}}};try{return RegExp(pattern)}catch(error){return error}";
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: 'budgetExceeded', budget: 'dataSize' });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: 'source' });
  });
});
