import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";

describe("regex replacement custom exec", () => {
  it.each([
    "const seen=[];Object.defineProperty(String.prototype,'named',{get(){seen.push(this);return typeof this}});const regex=/a/;regex.exec=()=>({0:'a',index:0,length:1,groups:'abc'});const text='a'.replace(regex,'$<named>/$<named>');return [text,seen[0]===seen[1]];",
    "const regex=/a/g;Object.defineProperty(regex,'global',{value:false});return 'aa'.replace(regex,'!');",
    "const regex=/a/g;Object.defineProperty(regex,'global',{get(){regex.exec=()=>null;return true}});return 'aa'.replace(regex,'!');",
    "const regex=/a/;const log=[];regex.exec=()=>({0:'X',index:0,length:1,groups:{get name(){log.push('name');return {toString(){log.push('string');return 'n'}}}}});return ['a'.replace(regex,'$<name>/$<name>'),log];",
    "const regex=/a/;regex.exec=()=>({0:'X',index:0,length:1,groups:{name:Symbol('group')}});try{return 'a'.replace(regex,'$<name>')}catch(error){return error.name}",
    "const regex=/a/;regex.exec=()=>null;return 'a'.replace(regex,'b');",
    "const regex=/a/;regex.exec=()=>({0:'X',index:1,length:1});return 'abc'.replace(regex,'!');",
    "const regex=/a/g;let count=0;const log=[];regex.exec=()=>{log.push('exec');return ++count<3?{0:'a',index:count-1,length:1}:null};return ['aa'.replace(regex,()=>{log.push('replace');return 'b'}),log];",
    "const regex=/a/;regex.exec=()=>({0:'X',1:7,2:undefined,index:1,length:3});return 'abc'.replace(regex,'[$&:$1:$2]');",
    "const regex=/a/;const groups={name:'named'};regex.exec=()=>({0:'X',1:7,index:1,length:2,groups});let args;const text='abc'.replace(regex,(...values)=>{args=values;return '!'});return [text,args,args[4]===groups];",
    "const regex=/a/;regex.exec=()=>({0:'X',index:1,length:1,groups:{name:'named'}});return 'abc'.replace(regex,'$<name>:$<missing>');",
    "const regex=/a/g;let calls=0;regex.exec=function(){if(++calls===1){this.lastIndex=1;return {0:'',index:1,length:1}}return null};return ['ab'.replaceAll(regex,'!'),regex.lastIndex,calls];",
    "const regex=/a/;regex.exec=()=>1;try{return 'a'.replace(regex,'!')}catch(error){return error.name}",
    "const regex=/a/;Object.defineProperty(regex,'exec',{get(){throw 'exec'}});try{return 'a'.replace(regex,'!')}catch(error){return error}",
    "const regex=/a/g;let calls=0;regex.exec=()=>++calls<3?{0:'a',index:0,length:1}:null;let replaced=0;return ['aa'.replace(regex,()=>{replaced++;return 'b'}),replaced];",
    "const regex=/a/;regex.exec=()=>({0:'X',index:-7,length:1});return 'abc'.replace(regex,'!');",
    "const regex=/a/;regex.exec=()=>({0:'X',index:Infinity,length:1});return 'abc'.replace(regex,'!');",
    "const regex=/a/;regex.exec=()=>({0:'X',index:0,length:1,groups:null});try{return 'a'.replace(regex,'!')}catch(error){return error.name}",
    "const regex=/a/;regex.exec=()=>({0:'X',index:0,length:1,groups:null});return 'a'.replace(regex,(...args)=>String(args[args.length-1]));"
  ])("matches native: %s", async source => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });

  it("reads result fields in specification order without rereading match zero", async () => {
    // Node 22 redundantly reads and coerces 0 again after index for function replacers.
    // https://tc39.es/ecma262/#sec-regexp-prototype-%symbol.replace%
    const source = "const regex=/a/;const log=[];regex.exec=()=>({get length(){log.push('length');return 2},get 0(){log.push('match');return {toString(){log.push('match string');return 'X'}}},get index(){log.push('index');return {valueOf(){log.push('index number');return 1}}},get 1(){log.push('capture');return {toString(){log.push('capture string');return 'C'}}},get groups(){log.push('groups');return undefined}});const text='abc'.replace(regex,()=>{log.push('replace');return '!'});return [text,log];";
    expect(await run(source)).toMatchObject({ ok: true, returnValue: ['a!c', ['length','match','match string','index','index number','capture','capture string','groups','replace']] });
  });

  it("gets numeric named-capture keys from boxed primitive groups", async () => {
    // GetSubstitution uses ordinary Get after ToObject; Node 22 misses indexed keys here.
    // https://tc39.es/ecma262/#sec-getsubstitution
    const source = "const regex=/a/;regex.exec=()=>({0:'X',index:0,length:1,groups:'abc'});return 'a'.replace(regex,'$<length>:$<1>');";
    expect(await run(source)).toMatchObject({ ok: true, returnValue: '3:b' });
  });

  it("bounds nonterminating exec before invoking a replacer", async () => {
    let calls = 0;
    await expect(run("const regex=/a/g;regex.exec=()=>({0:'a',index:0,length:1});return 'a'.replace(regex,()=>{tick();return 'b'});", {
      budget: new Budget({ maxSteps: 1000 }), bindings: { tick: () => { calls++; } }
    })).rejects.toMatchObject({ code: 'budgetExceeded', budget: 'steps' });
    expect(calls).toBe(0);
  });

  it("bounds capture counts before reading captures", async () => {
    let calls = 0;
    await expect(run("const regex=/a/;regex.exec=()=>({0:'a',length:1000000,index:0,get 1(){tick();return 'capture'}});return 'a'.replace(regex,'$1');", {
      budget: new Budget({ arrayLength: 10 }), bindings: { tick: () => { calls++; } }
    })).rejects.toMatchObject({ code: 'budgetExceeded', budget: 'arrayLength' });
    expect(calls).toBe(0);
  });

  it("retains collected results during later exec calls", async () => {
    const source = "const regex=/a/g;let calls=0;regex.exec=()=>{if(++calls===1)return {0:'a',length:1,index:0,payload:'x'.repeat(4000)};const temporary='y'.repeat(4000);return null};return 'a'.replace(regex,'b');";
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: 'budgetExceeded', budget: 'dataSize' });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: 'b' });
  });

  it("bounds named expansion before another getter runs", async () => {
    let calls = 0;
    await expect(run("const regex=/a/;regex.exec=()=>({0:'a',index:0,length:1,groups:{get name(){tick();return 'x'.repeat(600)}}});return 'a'.replace(regex,'$<name>$<name>$<name>');", {
      budget: new Budget({ stringLength: 1000 }), bindings: { tick: () => { calls++; } }
    })).rejects.toMatchObject({ code: 'budgetExceeded', budget: 'stringLength' });
    expect(calls).toBe(2);
  });
});
