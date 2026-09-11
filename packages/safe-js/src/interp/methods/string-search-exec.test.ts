import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";

describe("String.search custom RegExp exec", () => {
  it.each([
    "const regex=/a/;regex.exec=()=>({index:7});return 'a'.search(regex);",
    "const regex=/a/g;regex.lastIndex=3;regex.exec=function(){this.lastIndex=9;return null};return ['a'.search(regex),regex.lastIndex];",
    "const regex=/a/g;const log=[];regex.lastIndex=3;Object.defineProperty(regex,'exec',{get(){log.push(regex.lastIndex);return function(input){log.push(this===regex,input);this.lastIndex=9;return {get index(){log.push(regex.lastIndex);return 7}}}}});return ['a'.search(regex),log];",
    "const regex=/a/g;regex.lastIndex=3;regex.exec=function(){this.lastIndex=9;throw 'exec'};try{return 'a'.search(regex)}catch(error){return [error,regex.lastIndex]}",
    "const regex=/a/g;regex.lastIndex=3;regex.exec=function(){this.lastIndex=9;return 1};try{return 'a'.search(regex)}catch(error){return [error.name,regex.lastIndex]}",
    "const regex=/a/g;const cursor={valueOf(){throw 'coercion'}};regex.lastIndex=cursor;regex.exec=()=>null;return ['a'.search(regex),regex.lastIndex===cursor];",
    "const regex=/a/g;regex.lastIndex=-0;regex.exec=()=>null;return ['a'.search(regex),Object.is(regex.lastIndex,-0)];",
    "const regex=/a/;const index={custom:true};regex.exec=()=>({index});return 'a'.search(regex)===index;",
    "const regex=/a/;regex.exec=()=>({});return 'a'.search(regex);",
    "const regex=/a/;regex.exec=()=>null;Object.freeze(regex);return 'a'.search(regex);",
    "const regex=/a/;const log=[];regex.lastIndex=3;regex.exec=function(){this.lastIndex=9;Object.freeze(this);return {get index(){log.push('index');return 7}}};try{return 'a'.search(regex)}catch(error){return [error.name,regex.lastIndex,log]}",
    "const regex=/a/;regex.exec=42;return 'a'.search(regex);",
    "const regex=/a/;regex.lastIndex=3;regex.exec=function(){return {get index(){throw 'index'}}};try{return 'a'.search(regex)}catch(error){return [error,regex.lastIndex]}"
  ])("matches native: %s", async source => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("retains the previous cursor while exec runs", async () => {
    const source = "const regex=/a/;regex.lastIndex={payload:'x'.repeat(4000)};regex.exec=()=>{const temporary='y'.repeat(4000);return null};return 'a'.search(regex);";
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: -1 });
  });
});
