import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";
import { deepCopyFromSandbox } from "../values.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

describe("boxed primitive objects", () => {
  it.each([
    "const value=Object(3);return [typeof value,value.valueOf(),String(value)]",
    "const value=Object(false);return [typeof value,value.valueOf(),Boolean(value)]",
    "const value=Object.assign(3,{extra:4});return [typeof value,value.valueOf(),value.extra]",
    "return [Object.getPrototypeOf(3)===Number.prototype,Object.getPrototypeOf('ab')===String.prototype,Object.getPrototypeOf(false)===Boolean.prototype]",
    "const value=new Number(3);let calls=0;value.valueOf=()=>{calls++;return 3};return [value==null,value==undefined,value==value,calls]",
    "const value=new Number(3);let calls=0;value.valueOf=()=>{calls++;return 4};return [value+1,1+value,value==4,value<5,calls]",
    "Number.prototype.valueOf=()=>9;return [new Number(3).valueOf(),(3).valueOf(),Number(new Number(3))]",
    "const value=new Number(3);value.valueOf=()=>7;return JSON.stringify(value)",
    "const value=new Boolean(false);value.valueOf=()=>true;return JSON.stringify(value)",
    "const value=new String('ab');value.toString=()=> 'z';return JSON.stringify(value)",
    "const value=new Number(3);value.extra=()=>1;return structuredClone(value).valueOf()",
    "const value=Object('ab');return [typeof value,value.valueOf(),value.length,value[0]]",
    "const value=new Number();return [typeof value,value.valueOf()]",
    "const value=new Number(undefined);return [typeof value,Number.isNaN(value.valueOf())]",
    "const value=new Number(-0);return [value.valueOf(),1/value.valueOf()]",
    "const value=new Number('12');return [value.valueOf(),value.toFixed(2),value.toString(16)]",
    "const value=new Number({valueOf(){return 7}});return [value.valueOf(),+value,value+1]",
    "const value=new Number(NaN);return [Number.isNaN(value),isNaN(value),Object.prototype.toString.call(value)]",
    "const value=new Boolean();return [typeof value,value.valueOf(),Boolean(value),String(value)]",
    "const value=new Boolean(false);return [value.valueOf(),Boolean(value),!value]",
    "let calls=0;const value=new Boolean({valueOf(){calls++;return false}});return [value.valueOf(),calls]",
    "const value=new String();return [typeof value,value.valueOf(),value.length]",
    "const value=new String(undefined);return [value.valueOf(),value.length]",
    "const value=new String({toString(){return 'ab'}});return [value.valueOf(),value[0],value[1],value.length]",
    "const value=new String('😀');return [value.length,value[0],value[1],Object.keys(value)]",
    "const value=new String('ab');return [value.toUpperCase(),value.slice(1),value.concat('c')]",
    "return [...new String('a😀')]",
    "const value=new String('ab');value.toString=()=> 'xy😀';return [...value]",
    "const value=new String('ab');value.toString=()=> 'xy😀';return Array.from(value)",
    "const value=new String('ab');let calls=0;value.toString=()=>{calls++;return 'xy'};const result=[];for(const item of value)result.push(item);return [result,calls]",
    "const value=new String('ab');value.toString=()=> 'xy😀';return [...new Set(value)]",
    "const events=[];const value=new String('ab');value.toString=()=>{events.push('convert');return 'xy'};function Output(){events.push('construct')}const result=Array.from.call(Output,value);return [events,result[0],result[1]]",
    "const marker={};const value=new String('ab');value.toString=()=>{throw marker};try{return [...value]}catch(error){return error===marker}",
    "return Array.from(new String('a😀'))",
    "const result=[];for(const value of new String('a😀'))result.push(value);return result",
    "try{Number.MAX_VALUE=3}catch(error){return error.name}",
    "return Object.getOwnPropertyDescriptor(Number,'NaN')",
    "const value=new String('ab');return Object.getOwnPropertyDescriptor(value,'0')",
    "const value=new String('ab');return Object.getOwnPropertyDescriptor(value,'length')",
    "const value=new String('ab');try{value[0]='z'}catch(error){return [error.name,value[0]]}",
    "const value=new String('ab');try{delete value[0]}catch(error){return [error.name,value[0]]}",
    "const value=new String('ab');try{Object.defineProperty(value,'0',{value:'z'})}catch(error){return [error.name,value[0]]}",
    "const value=new String('ab');Object.defineProperty(value,'0',{value:'a'});return value[0]",
    "const value=new Number(3);value.extra=4;return [value.extra,Object.keys(value),Object(value)===value,new Object(value)===value]",
    "const value=new Boolean(false);value.extra=value;return [value.extra===value,value.valueOf()]",
    "const value=new Number(3);value.valueOf=()=> 9;return [Number(value),Number.prototype.valueOf.call(value)]",
    "const value=new String('ab');value.toString=()=> 'custom';return [String(value),String.prototype.toString.call(value)]",
    "const value=new Boolean(false);value.valueOf=()=> true;return [value.valueOf(),Boolean.prototype.valueOf.call(value)]",
    "return [Number.prototype.valueOf(),String.prototype.valueOf(),Boolean.prototype.valueOf()]",
    "return [Number.prototype.toString.call(12),String.prototype.toString.call('ab'),Boolean.prototype.toString.call(false)]",
    "const value=Object.prototype.valueOf.call(7);return [typeof value,value.valueOf(),value instanceof Number]",
    "return [JSON.stringify(new Number(3)),JSON.stringify(new String('ab')),JSON.stringify(new Boolean(false))]",
    "const value=new Number(3);value.extra=7;const copy=structuredClone(value);return [copy!==value,copy.valueOf(),copy.extra]",
    "const value=new String('ab');value.extra=7;const copy=structuredClone(value);return [copy!==value,copy.valueOf(),copy.extra,copy.length]",
    "const value=new Boolean(false);value.extra=7;const copy=structuredClone(value);return [copy!==value,copy.valueOf(),copy.extra]",
    "return [].map.call('ab',(value,index)=>value+index)",
    "return [].slice.call(3)",
    "const value=[].fill.call(3,'x');return [typeof value,value.valueOf()]",
    "try{return [].fill.call('ab','x')}catch(error){return error.name}",
    "const value={};return [Object(value)===value,typeof Number(3),typeof String('ab'),typeof Boolean(false)]"
  ])("matches native wrapper semantics: %s", async (source) => {
    const expected = runInNewContext(`(()=>{'use strict';${source}})()`, { structuredClone });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["Number", "String", "Boolean"])("retains %s prototype identity", async (constructor) => {
    const source = `const value=new ${constructor}();return [value instanceof ${constructor},value instanceof Object,Object.getPrototypeOf(value)===${constructor}.prototype,Object.getPrototypeOf(${constructor}.prototype)===Object.prototype,value.constructor===${constructor},Object.keys(${constructor}.prototype)]`;
    const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["Number", "String", "Boolean"])("rejects spoofed %s receivers", async (constructor) => {
    const source = `const method=${constructor}.prototype.valueOf;const value={value:3,valueOf(){return 3}};try{return method.call(value)}catch(error){return error.name}`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: "TypeError" });
  });

  it.each(["Number", "String", "Boolean"])(
    "preserves %s aliases across checkpoint restore",
    async (constructor) => {
      const source = `const value=new ${constructor}('7');value.self=value;const pair=[value,value];await 0;return [pair[0]===pair[1],value.self===value,value.valueOf(),value instanceof ${constructor}]`;
      const pending = run(source);
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      const expected = await runInNewContext(`(async()=>{${source}})()`);
      expect(await pending).toMatchObject({ ok: true, returnValue: expected });
      expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: expected });
    }
  );

  it.each([Number, String, Boolean])(
    "copies boxed host values without losing payload or aliases: %s",
    async (constructor) => {
      const value = Object.assign(new constructor("7"), { self: undefined as unknown, extra: 4 });
      value.self = value;
      const result = await run("return [value.valueOf(),value.self===value,value.extra]", {
        bindings: { value }
      });
      expect(result).toMatchObject({ ok: true, returnValue: [value.valueOf(), true, 4] });
    }
  );

  it.each(["Number", "String", "Boolean"])(
    "exports real %s wrapper values",
    async (constructor) => {
      const result = await run(`const value=new ${constructor}('7');value.self=value;return value`);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      const exported = deepCopyFromSandbox(result.returnValue) as {
        self: unknown;
        valueOf(): unknown;
      };
      expect(Object.prototype.toString.call(exported)).toBe(`[object ${constructor}]`);
      expect(exported.self).toBe(exported);
      expect(exported.valueOf()).toBe(
        constructor === "Number" ? 7 : constructor === "Boolean" ? true : "7"
      );
    }
  );

  it("keeps constructor conversion budgets fatal", async () => {
    await expect(
      run("try{return new Number({valueOf(){while(true){}}})}catch(error){return 0}", {
        budget: new Budget({ maxSteps: 1000 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });
});
