import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { Budget, run } from "../../core.js";

it.each(["hasOwnProperty", "propertyIsEnumerable"])("converts keys before validating the %s receiver", async method => {
  for (const receiver of ["null", "undefined", "{}", "'abc'"]) {
    for (const body of ["return '0'", "throw 'key error'", "return {}", "return Symbol.iterator"]) {
      const source = `const seen=[];const key={[Symbol.toPrimitive](hint){seen.push(hint);${body}}};try{return [Object.prototype.${method}.call(${receiver},key),seen]}catch(e){return [typeof e==='string'?e:e.name,seen]}`;
      expect(await run(source)).toMatchObject({ok: true, returnValue: runInNewContext(`(function(){${source}})()`)});
    }
  }
});

it.each(["hasOwnProperty", "propertyIsEnumerable"])("observes mutations made while converting a %s key", async method => {
  const source = `const o={};const key={toString(){Object.defineProperty(o,'x',{value:7,enumerable:true});return 'x'}};return Object.prototype.${method}.call(o,key)`;
  expect(await run(source)).toMatchObject({ok: true, returnValue: true});
});

it.each(["hasOwnProperty", "propertyIsEnumerable"])("keeps %s key-conversion exhaustion fatal even with a null receiver", async method => {
  const source = `try{Object.prototype.${method}.call(null,{toString(){while(true){}return 'x'}})}catch(e){return 'caught'}`;
  await expect(run(source, {budget: new Budget({maxSteps: 100})}))
    .rejects.toMatchObject({code: "budgetExceeded", budget: "steps"});
});
