import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";

describe("String.match custom RegExp exec", () => {
  it.each([
    "const regex=/a/g;Object.defineProperty(regex,'global',{value:false});const result={0:'single'};let calls=0;regex.exec=()=>++calls===1?result:null;return 'a'.match(regex)===result;",
    "const regex=/a/g;Object.defineProperty(regex,'unicode',{value:true});const cursors=[];regex.exec=function(){cursors.push(this.lastIndex);return cursors.length===1?{0:''}:null};return ['😀'.match(regex),cursors];",
    "const regex=/a/;regex.exec=()=>null;return 'a'.match(regex);",
    "const regex=/a/;const result={custom:true};regex.exec=function(input){return this===regex&&input==='a'?result:null};return 'a'.match(regex)===result;",
    "const regex=/a/;Object.defineProperty(regex,'exec',{get(){throw 'exec'}});try{return 'a'.match(regex)}catch(error){return error}",
    "const regex=/a/;regex.exec=()=>1;try{return 'a'.match(regex)}catch(error){return error.name}",
    "const regex=/a/g;let calls=0;regex.exec=()=>++calls<3?{0:'custom'}:null;return ['a'.match(regex),calls,regex.lastIndex];",
    "const regex=/a/g;const log=[];regex.lastIndex=9;regex.exec=function(input){log.push([this.lastIndex,input]);return log.length===1?{0:''}:null};return ['a'.match(regex),log,regex.lastIndex];",
    "const regex=/a/g;const log=[];let calls=0;regex.exec=()=>++calls===1?{get 0(){log.push('get');return {toString(){log.push('string');return 'custom'}}}}:null;return ['a'.match(regex),log];",
    "const regex=/a/g;let calls=0;Object.defineProperty(regex,'exec',{get(){calls++;return calls===1?()=>({0:'custom'}):()=>null}});return ['a'.match(regex),calls];",
    "const regex=/a/g;regex.exec=function(){delete this.exec;this.lastIndex=1;return {0:'custom'}};return 'aa'.match(regex);",
    "const regex=/a/;regex.exec=42;return 'a'.match(regex)[0];",
    "const regex=/a/g;let calls=0;regex.exec=function(){calls++;return null};Object.freeze(regex);try{return 'a'.match(regex)}catch(error){return [error.name,calls]}",
    "const regex=/a/g;regex.exec=()=>({0:Symbol('match')});try{return 'a'.match(regex)}catch(error){return error.name}",
    "const regex=/a/;const result=Promise.resolve(1);regex.exec=()=>result;return 'a'.match(regex)===result;"
  ])("matches native: %s", async source => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("bounds a nonterminating custom exec", async () => {
    await expect(run("const regex=/a/g;regex.exec=()=>({0:'a'});return 'a'.match(regex);", {
      budget: new Budget({ maxSteps: 1000 })
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });

  it("checks result array limits before another exec call", async () => {
    let calls = 0;
    await expect(run("const regex=/a/g;regex.exec=()=>{tick();return {0:'a'}};return 'a'.match(regex);", {
      budget: new Budget({ arrayLength: 1 }), bindings: { tick: () => { calls++; } }
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
    expect(calls).toBe(2);
  });
});
