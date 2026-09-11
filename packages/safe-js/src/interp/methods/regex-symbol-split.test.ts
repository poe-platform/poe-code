import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";

describe("RegExp Symbol.split", () => {
  it("retains a detached match while its length getter allocates", async () => {
    const source = "const target={flags:'',constructor:{[Symbol.species]:function(){return {exec(){this.lastIndex=1;return {payload:'x'.repeat(4000),get length(){const temporary='y'.repeat(4000);throw 'length'}}}}}}};try{RegExp.prototype[Symbol.split].call(target,'a')}catch(error){return error}";
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: "length" });
  });
  it.each([
    "const log=[];const matcher={lastIndex:0,exec(){this.lastIndex=1;return {get length(){log.push('length');return {valueOf(){log.push('number');return 3}}},get 1(){log.push('capture');return undefined},get 2(){throw 'extra'}}}};const target={flags:'',constructor:{[Symbol.species]:function(){return matcher}}};return [RegExp.prototype[Symbol.split].call(target,'a',2),log];",
    "const matcher={lastIndex:0,exec(){this.lastIndex=Infinity;return {length:1}}};const target={flags:'',constructor:{[Symbol.species]:function(){return matcher}}};return RegExp.prototype[Symbol.split].call(target,'abc');",
    "const target={flags:'',constructor:{[Symbol.species]:function(){return Object.freeze({lastIndex:0,exec(){return null}})}}};try{return RegExp.prototype[Symbol.split].call(target,'a')}catch(error){return error.name}",
    "return /a/[Symbol.split]('banana');",
    "return /(a)|(z)/[Symbol.split]('banana',4);",
    "return [/(?:)/[Symbol.split](''),/x/[Symbol.split](''),/(?:)/[Symbol.split]('ab')];",
    "const regex=/a/y;regex.lastIndex=0;const first=regex.exec('ba');regex.lastIndex=1;const second=regex.exec('ba');return [first,second.index,regex.lastIndex,regex.exec('ba'),regex.lastIndex];",
    "const regex=/a/gy;regex.lastIndex=1;return [regex.exec('ba').index,regex.lastIndex,regex.sticky,regex.flags];",
    "const d=Object.getOwnPropertyDescriptor(RegExp.prototype,Symbol.split);return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable];",
    "const log=[];const target={get constructor(){log.push('constructor');return {[Symbol.species]:function(target,flags){log.push(flags);return /a/y}}},get flags(){log.push('flags');return ''}};const result=RegExp.prototype[Symbol.split].call(target,{toString(){log.push('input');return 'aba'}},{valueOf(){log.push('limit');return 0}});return [log,result];",
    "const target={flags:'y',constructor:{[Symbol.species]:function(target,flags){return {exec(){return null},flags}}}};return RegExp.prototype[Symbol.split].call(target,'ab');",
    "const marker={value:1};const matcher={lastIndex:0,exec(){if(this.lastIndex!==1)return null;this.lastIndex=2;return {1:marker,2:undefined,length:3}}};const target={flags:'',constructor:{[Symbol.species]:function(){return matcher}}};const result=RegExp.prototype[Symbol.split].call(target,'abc');return [result[0],result[1]===marker,result[2]===undefined,result[3]];",
    "let calls=0;const target={flags:'u',constructor:{[Symbol.species]:function(){return {exec(){calls++;return null}}}}};return [RegExp.prototype[Symbol.split].call(target,'😀'),calls];",
    "const regex=/a/g;regex.lastIndex=9;return [regex[Symbol.split]('aba'),regex.lastIndex];",
    "class Pattern extends RegExp{exec(value){const result=super.exec(value);if(result){result[1]='capture';result.length=2}return result}}return 'aba'.split(new Pattern('a'));",
    "const target={flags:'',constructor:{[Symbol.species]:7}};try{return RegExp.prototype[Symbol.split].call(target,'a')}catch(error){return error.name}",
    "let calls=0;const matcher={exec(){calls++;throw 'exec'}};const target={flags:'',constructor:{[Symbol.species]:function(){return matcher}}};try{RegExp.prototype[Symbol.split].call(target,'')}catch(error){return [error,calls]}",
    "const matcher={lastIndex:0,exec(){this.lastIndex=1;return {get length(){throw 'length'}}}};const target={flags:'',constructor:{[Symbol.species]:function(){return matcher}}};return RegExp.prototype[Symbol.split].call(target,'a',1);"
  ])("matches native: %s", async source => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });
});
