import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

describe("RegExp Symbol.matchAll and species construction", () => {
  it("retains the execution result across cursor coercion", async () => {
    const source = "const matcher={exec(){return {0:'',payload:'x'.repeat(4000)}},get lastIndex(){const temporary='y'.repeat(4000);throw 'cursor'},set lastIndex(value){}};const iterator=RegExp.prototype[Symbol.matchAll].call({flags:'g',lastIndex:0,constructor:{[Symbol.species]:function(){return matcher}}},'a');try{iterator.next()}catch(error){return error}";
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: "cursor" });
  });
  it.each([
    ["const iterator=RegExp.prototype[Symbol.matchAll].call({flags:'',lastIndex:0,constructor:{[Symbol.species]:function(){return /a/g}}},'aba');await 0;return [iterator.next().value.index,iterator.next().done];", [0, true]],
    ["const matcher=/(?:)/;const iterator=RegExp.prototype[Symbol.matchAll].call({flags:'gu',lastIndex:0,constructor:{[Symbol.species]:function(){return matcher}}},'😀');await 0;iterator.next();return matcher.lastIndex;", 2],
    ["const iterator=/a/g[Symbol.matchAll]('aba');iterator.next();await 0;return iterator.next().value.index;", 2],
    ["let calls=0;const matcher={exec(){return ++calls<3?{0:String(calls)}:null}};const target={flags:'g',lastIndex:0,constructor:{[Symbol.species]:function(){return matcher}}};const iterator=RegExp.prototype[Symbol.matchAll].call(target,'a');delete target.constructor;iterator.next();await 0;return iterator.next().value[0];", "2"]
  ])("preserves lazy matcher state through checkpoint replay: %s", async (source, expected) => {
    const pending = run(String(source));
    const completed = pending.catch(error => error);
    try {
      const snapshot = restore(JSON.parse(await dump(pending)), { source: String(source) });
      expect(await completed).toMatchObject({ ok: true, returnValue: expected });
      expect(await run(String(source), { snapshot })).toMatchObject({ ok: true, returnValue: expected });
    } finally { await completed; }
  });
  it.each([
    "let calls=0;const target={flags:'g',lastIndex:0,constructor:{[Symbol.species]:function(){return {exec(){calls++;throw 'exec'}}}}};const iterator=RegExp.prototype[Symbol.matchAll].call(target,'a');const errors=[];for(let i=0;i<2;i++){try{iterator.next()}catch(value){errors.push(value)}}return [errors,calls];",
    "return Array.from(/a/g[Symbol.matchAll]('aba'),match=>match.index);",
    "return Array.from(/a/[Symbol.matchAll]('aba'),match=>match.index);",
    "const method=RegExp.prototype[Symbol.matchAll];const d=Object.getOwnPropertyDescriptor(RegExp.prototype,Symbol.matchAll);return [method.name,method.length,d.writable,d.enumerable,d.configurable];",
    "return [RegExp[Symbol.species]===RegExp,(class Pattern extends RegExp{})[Symbol.species].name];",
    "const regex=/a/g;regex.lastIndex=1;const iterator=regex[Symbol.matchAll]('aba');return [iterator.next().value.index,regex.lastIndex,iterator.next().done];",
    "let calls=0;const regex=/a/g;regex.constructor={[Symbol.species]:function(pattern,flags){calls++;return new RegExp(pattern,flags)}};const iterator=RegExp.prototype[Symbol.matchAll].call(regex,'aba');return [calls,Array.from(iterator,match=>match.index)];",
    "const log=[];const target={get constructor(){log.push('constructor');return {[Symbol.species]:function(pattern,flags){log.push('construct:'+flags);return /a/g}}},get flags(){log.push('flags');return 'g'},get lastIndex(){log.push('cursor');return 0}};const iterator=RegExp.prototype[Symbol.matchAll].call(target,{toString(){log.push('input');return 'a'}});return [log,iterator.next().value[0]];",
    "let calls=0;const result={0:'x',length:1};const target={flags:'g',lastIndex:0,constructor:{[Symbol.species]:function(){return {lastIndex:0,exec(){return ++calls===1?result:null}}}}};const iterator=RegExp.prototype[Symbol.matchAll].call(target,'a');const before=calls;const first=iterator.next();const second=iterator.next();return [before,first.value===result,first.done,second.done,calls];",
    "let calls=0;const target={flags:'',lastIndex:0,constructor:{[Symbol.species]:function(){return {exec(){calls++;return {0:'x'}}}}}};const iterator=RegExp.prototype[Symbol.matchAll].call(target,'a');return [iterator.next().done,iterator.next().done,calls];",
    "let matcher;const target={flags:'gu',lastIndex:0,constructor:{[Symbol.species]:function(){matcher={exec(){return {0:''}}};return matcher}}};const iterator=RegExp.prototype[Symbol.matchAll].call(target,'😀');iterator.next();return matcher.lastIndex;",
    "class Pattern extends RegExp{exec(value){const result=super.exec(value);if(result)result.marker='derived';return result}}return Array.from(new Pattern('a','g')[Symbol.matchAll]('aba'),match=>match.marker);",
    "const method=RegExp.prototype[Symbol.matchAll];const target={flags:'g',constructor:{[Symbol.species]:7}};try{return method.call(target,'a')}catch(error){return error.name}",
    "const regex=/a/g;regex.constructor={[Symbol.species]:null};return Array.from(RegExp.prototype[Symbol.matchAll].call(regex,'aba'),match=>match.index);"
  ])("matches native: %s", async source => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });
});
