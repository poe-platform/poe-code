import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";

describe("RegExp Symbol.replace protocol", () => {
  it.each([
    "return /a/g[Symbol.replace]('aba','x');",
    "const method=RegExp.prototype[Symbol.replace];const d=Object.getOwnPropertyDescriptor(RegExp.prototype,Symbol.replace);return [method.name,method.length,d.writable,d.enumerable,d.configurable];",
    "const target={flags:'',global:false,exec(){return {0:'b',index:1,length:1}}};return RegExp.prototype[Symbol.replace].call(target,'abc','<$&>');",
    "const target={flags:'',global:false,exec(){return {0:'b',1:'B',index:1,length:2}}};return RegExp.prototype[Symbol.replace].call(target,'abc','<$1>');",
    "const target={flags:'',global:false,exec(){return {0:'b',index:1,length:1,groups:{name:'B'}}}};return RegExp.prototype[Symbol.replace].call(target,'abc','<$<name>>');",
    "const target={flags:'',global:false,exec(){return null}};return RegExp.prototype[Symbol.replace].call(target,'abc','x');",
    "const groups={name:'B'};let observed;const target={flags:'',global:false,exec(){return {0:'b',1:undefined,index:1,length:2,groups}}};const result=RegExp.prototype[Symbol.replace].call(target,'abc',function(match,capture,index,input,names){observed=[this===undefined,match,capture,index,input,names===groups];return 'X'});return [result,observed];",
    "let count=0;const log=[];const target={flags:'g',global:true,exec(){log.push('exec');return ++count<3?{0:'a',index:count-1,length:1}:null}};const result=RegExp.prototype[Symbol.replace].call(target,'aa',()=>{log.push('replace');return 'x'});return [result,log];",
    "let count=0;let cursor=4;const log=[];const target={flags:'g',global:true,get lastIndex(){log.push('get');return cursor},set lastIndex(value){log.push('set:'+value);cursor=value},exec(){return ++count===1?{0:'',index:0,length:1}:null}};return [RegExp.prototype[Symbol.replace].call(target,'a','x'),log];",
    "const target=function(){};target.flags='';target.global=false;target.exec=function(){return {0:'a',index:0,length:1}};return RegExp.prototype[Symbol.replace].call(target,'a','b');",
    "const target={flags:'',global:false,exec(){return {0:'a',index:0,length:1}}};return RegExp.prototype[Symbol.replace].call(target,'a',()=>({toString(){return 'b'}}));"
  ])("matches native: %s", async source => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });

  it("coerces input and replacement before reading flags", async () => {
    const source = "const log=[];const target={get flags(){log.push('flags');return ''},get global(){throw 'global'},exec(){log.push('exec');return null}};const result=RegExp.prototype[Symbol.replace].call(target,{toString(){log.push('input');return 'a'}},{toString(){log.push('replacement');return 'x'}});return [result,log];";
    expect(await run(source)).toMatchObject({ ok: true, returnValue: ["a", ["input", "replacement", "flags", "exec"]] });
  });

  it("bounds a nonterminating borrowed matcher", async () => {
    const source = "return RegExp.prototype[Symbol.replace].call({flags:'g',exec(){return {0:'a',index:0,length:1}}},'a','b');";
    await expect(run(source, { budget: new Budget({ maxSteps: 300 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });
});
