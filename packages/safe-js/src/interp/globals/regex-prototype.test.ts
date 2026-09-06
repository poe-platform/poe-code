import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";

describe("RegExp intrinsic prototype and derived construction", () => {
  it("accounts for symbol-keyed intrinsic mutations", async () => {
    const source = "RegExp.prototype[Symbol('payload')]='x'.repeat(4000);return 'y'.repeat(4000).length;";
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: 4000 });
  });
  it.each([
    "RegExp.prototype.toString=function(){return 'changed'};return String(/a/);",
    "delete RegExp.prototype.exec;return [typeof /a/.exec,'exec' in /a/];",
    "delete RegExp.prototype.global;const regex=/a/g;regex.global=42;return regex.global;",
    "const regex=/a/;Object.setPrototypeOf(regex,null);return [Object.getPrototypeOf(regex),typeof regex.exec,regex instanceof RegExp];",
    "return /a/.constructor === RegExp;",
    "return Object.getPrototypeOf(/a/) === RegExp.prototype;",
    "return Object.getPrototypeOf(RegExp.prototype) === Object.prototype;",
    "return [/a/.exec === /b/.exec, /a/.test === RegExp.prototype.test];",
    "const descriptor=Object.getOwnPropertyDescriptor(RegExp,'prototype');return [descriptor.writable,descriptor.enumerable,descriptor.configurable];",
    "const descriptor=Object.getOwnPropertyDescriptor(RegExp.prototype,'constructor');return [descriptor.value===RegExp,descriptor.writable,descriptor.enumerable,descriptor.configurable];",
    "return [RegExp.length,RegExp.prototype.exec.length,RegExp.prototype.test.length,RegExp.prototype.toString.length];",
    "return [RegExp.prototype.source,RegExp.prototype.flags,RegExp.prototype.global];",
    "return RegExp.prototype.toString.call({source:'a',flags:'i'});",
    "return RegExp.prototype.test.call({exec(){return {}}},'a');",
    "const exec=RegExp.prototype.exec;try{exec.call({},'a');return false}catch(error){return error instanceof TypeError}",
    "RegExp.prototype.marker=42;return /a/.marker;",
    "RegExp.prototype.exec=function(){return null};return /a/.test('a');",
    "class Pattern extends RegExp{}const regex=new Pattern('a');return [regex instanceof Pattern,regex instanceof RegExp,regex.test('a'),Object.getPrototypeOf(regex)===Pattern.prototype];",
    "class Pattern extends RegExp{constructor(){super('a','i');this.label='pattern'} describe(){return this.label}}const regex=new Pattern();return [regex.test('A'),regex.describe(),regex.constructor===Pattern];",
    "class Pattern extends RegExp{}const regex=new Pattern('a');const copy=RegExp(regex);return [copy!==regex,Object.getPrototypeOf(copy)===RegExp.prototype,copy.source];",
    "class Pattern extends RegExp{}class Child extends Pattern{}const regex=new Child('a');return [regex instanceof Child,regex instanceof Pattern,regex instanceof RegExp,regex.test('a')];"
  ])("matches native: %s", async source => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
