import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";

describe("RegExp Symbol.search protocol", () => {
  it("retains data attached to the intrinsic method", async () => {
    const source = "RegExp.prototype[Symbol.search].payload='x'.repeat(4000);return 'y'.repeat(4000).length;";
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: 4000 });
  });
  it.each([
    "const target={get lastIndex(){return {payload:'x'.repeat(4000)}},set lastIndex(value){},exec(){const temporary='y'.repeat(4000);throw 'retained'}};try{return RegExp.prototype[Symbol.search].call(target,'a')}catch(error){return error}",
    "let cursor=1;const target={get lastIndex(){return cursor},set lastIndex(value){if(value===1){const temporary='y'.repeat(4000);throw 'retained'}cursor=value},exec(){return {payload:'x'.repeat(4000),index:2}}};try{return RegExp.prototype[Symbol.search].call(target,'a')}catch(error){return error}"
  ])("retains protocol state across guest hooks: %s", async source => {
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: "retained" });
  });
  it.each([
    "return /a/[Symbol.search]('ba');",
    "const method=RegExp.prototype[Symbol.search];const d=Object.getOwnPropertyDescriptor(RegExp.prototype,Symbol.search);return [method.name,method.length,d.writable,d.enumerable,d.configurable];",
    "const regex=/a/g;regex.lastIndex=2;return [regex[Symbol.search]('ba'),regex.lastIndex];",
    "const target={lastIndex:7,exec(value){return {index:value.length}}};return [RegExp.prototype[Symbol.search].call(target,'abc'),target.lastIndex];",
    "const marker={};const target={lastIndex:0,exec(){return {index:marker}}};return RegExp.prototype[Symbol.search].call(target,'a')===marker;",
    "const target={lastIndex:0,exec(){return null}};return RegExp.prototype[Symbol.search].call(target,'a');",
    "const log=[];let cursor=4;const target={get lastIndex(){log.push('get');return cursor},set lastIndex(value){log.push('set:'+value);cursor=value},exec(value){log.push('exec:'+value);cursor=2;return {get index(){log.push('index');return 3}}}};const result=RegExp.prototype[Symbol.search].call(target,{toString(){log.push('string');return 'abc'}});return [result,log];",
    "const method=RegExp.prototype[Symbol.search];const target={lastIndex:4,exec(){this.lastIndex=2;throw 'exec'}};try{method.call(target,'a')}catch(error){return [error,target.lastIndex]}",
    "const method=RegExp.prototype[Symbol.search];const target={lastIndex:4,exec(){this.lastIndex=2;return 7}};try{method.call(target,'a')}catch(error){return [error.name,target.lastIndex]}",
    "const target={lastIndex:-0,exec(){return null}};const result=RegExp.prototype[Symbol.search].call(target,'a');return [result,Object.is(target.lastIndex,-0)];",
    "const cursor={valueOf(){throw 'coercion'}};const target={lastIndex:cursor,exec(){return null}};return [RegExp.prototype[Symbol.search].call(target,'a'),target.lastIndex===cursor];",
    "const method=RegExp.prototype[Symbol.search];const log=[];try{method.call(null,{toString(){log.push('string');return 'a'}})}catch(error){return [error.name,log]}",
    "const method=RegExp.prototype[Symbol.search];let cursor=4;const target={get lastIndex(){return cursor},set lastIndex(value){if(value===4)throw 'restore';cursor=value},exec(){return {get index(){throw 'index'}}}};try{return method.call(target,'a')}catch(error){return error}",
    "const target=function(){};target.lastIndex=1;target.exec=function(){return {index:2}};return [RegExp.prototype[Symbol.search].call(target,'a'),target.lastIndex];"
  ])("matches native: %s", async source => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
