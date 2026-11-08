import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";

describe("RegExp Symbol.match protocol", () => {
  it.each([
    "let count=0;let cursor=4;const log=[];const target={flags:'g',global:true,get lastIndex(){log.push('get');return cursor},set lastIndex(value){log.push('set:'+value);cursor=value},exec(){return ++count===1?{0:''}:null}};return [RegExp.prototype[Symbol.match].call(target,'a'),log];",
    "const method=RegExp.prototype[Symbol.match];const target={flags:'g',global:true,set lastIndex(value){throw 'set'},exec(){throw 'exec'}};try{return method.call(target,'a')}catch(error){return error}",
    "return /a/g[Symbol.match]('aba');",
    "return /a/[Symbol.match]('b');",
    "const method=RegExp.prototype[Symbol.match];const d=Object.getOwnPropertyDescriptor(RegExp.prototype,Symbol.match);return [method.name,method.length,d.writable,d.enumerable,d.configurable];",
    "const marker={index:2};const target={flags:'',global:false,exec(){return marker}};return RegExp.prototype[Symbol.match].call(target,'a')===marker;",
    "let count=0;const target={flags:'g',global:true,lastIndex:4,exec(){return ++count<3?{0:'x'}:null}};return [RegExp.prototype[Symbol.match].call(target,'a'),target.lastIndex,count];",
    "const target={flags:'g',global:true,exec(){return null}};return RegExp.prototype[Symbol.match].call(target,'a');",
    "let count=0;const target={flags:'gu',global:true,unicode:true,exec(){return ++count===1?{0:''}:null}};return [RegExp.prototype[Symbol.match].call(target,'😀'),target.lastIndex];",
    "let count=0;const target={flags:'g',global:true,exec(){return ++count===1?{0:{toString(){return 'x'}}}:null}};return RegExp.prototype[Symbol.match].call(target,'a');",
    "const method=RegExp.prototype[Symbol.match];const target={flags:'',global:false,exec(){return 1}};try{return method.call(target,'a')}catch(error){return error.name}",
    "const target=function(){};target.flags='';target.global=false;target.exec=function(){return {0:'x'}};return RegExp.prototype[Symbol.match].call(target,'a')[0];"
  ])("matches native: %s", async source => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });

  // Current ECMAScript reads flags, while older engines read global/unicode.
  it("reads and coerces flags after input and before executing", async () => {
    const source = "const log=[];const target={get flags(){log.push('flags');return {toString(){log.push('flags string');return ''}}},get global(){throw 'global'},exec(value){log.push('exec:'+value);return null}};const result=RegExp.prototype[Symbol.match].call(target,{toString(){log.push('input');return 'a'}});return [result,log];";
    expect(await run(source)).toMatchObject({ ok: true, returnValue: [null, ["input", "flags", "flags string", "exec:a"]] });
  });

  it("bounds nonterminating custom execution", async () => {
    const source = "return RegExp.prototype[Symbol.match].call({flags:'g',exec(){return {0:'x'}}},'a');";
    await expect(run(source, { budget: new Budget({ maxSteps: 300 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });

  it("advances empty matches by code point when flags contain v", async () => {
    const source = "let count=0;const target={flags:'gv',exec(){return ++count===1?{0:''}:null}};return [RegExp.prototype[Symbol.match].call(target,'😀'),target.lastIndex];";
    expect(await run(source)).toMatchObject({ ok: true, returnValue: [[""], 2] });
  });
});
