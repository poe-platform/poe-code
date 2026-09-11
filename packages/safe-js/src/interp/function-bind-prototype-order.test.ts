import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { measureSandboxData } from "./values.js";
import { declareHostOperation } from "./host-bridge.js";

it.each([
  "function f(){}const before=Object.getPrototypeOf(f);Object.defineProperty(f,'length',{get(){Object.setPrototypeOf(f,{changed:true});return 0}});const bound=f.bind(null);return Object.getPrototypeOf(bound)===before",
  "function f(){}const before=Object.getPrototypeOf(f);Object.defineProperty(f,'name',{get(){Object.setPrototypeOf(f,{changed:true});return 'renamed'}});const bound=f.bind(null);return [Object.getPrototypeOf(bound)===before,bound.name]",
  "function f(){}const bind=f.bind;Object.setPrototypeOf(f,null);Object.defineProperty(f,'length',{get(){Object.setPrototypeOf(f,{});return 0}});const bound=bind.call(f,null);return Object.getPrototypeOf(bound)===null",
  "function* f(){yield 1}const before=Object.getPrototypeOf(f);Object.defineProperty(f,'length',{get(){Object.setPrototypeOf(f,{changed:true});return 0}});const bound=f.bind(null);return [Object.getPrototypeOf(bound)===before,Object.getPrototypeOf(bound())===f.prototype]",
  "async function* f(){yield 1}const before=Object.getPrototypeOf(f);Object.defineProperty(f,'length',{get(){Object.setPrototypeOf(f,{changed:true});return 0}});const bound=f.bind(null);return [Object.getPrototypeOf(bound)===before,Object.getPrototypeOf(bound())===f.prototype]",
  "function F(v){this.value=v}const before=Object.getPrototypeOf(F);Object.defineProperty(F,'length',{get(){Object.setPrototypeOf(F,{});return 1}});const B=F.bind(null,7);const instance=new B();return [instance.value,instance instanceof F,Object.getPrototypeOf(B)===before]",
  "function f(v){return this.base+v}const bind=f.bind;Object.setPrototypeOf(f,{tag:'old'});const trace=[];Object.defineProperties(f,{length:{get(){trace.push('length');Object.setPrototypeOf(f,null);return 2}},name:{get(){trace.push('name');Object.setPrototypeOf(f,{});return 'renamed'}}});const bound=bind.call(f,{base:2},3);return [bound.tag,bound.name,bound.length,bound(),trace]"
])("selects the bound function prototype before metadata getters: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it.each(["length", "name"])("retains the selected prototype through the %s getter", async key => {
  const budget = new Budget({dataSize:100000});
  let retained = 0;
  const inspect = declareHostOperation(() => { retained = measureSandboxData(budget.retainedValues()); }, "re-issue");
  const source = `function f(){}const bind=f.bind;Object.setPrototypeOf(f,{extra:'x'.repeat(10000)});
    Object.defineProperty(f,'${key}',{get(){Object.setPrototypeOf(f,null);inspect();return ${key === "length" ? "0" : "'f'"}}});bind.call(f,null);return 1`;
  expect(await run(source,{budget,bindings:{inspect}})).toMatchObject({ok:true,returnValue:1});
  expect(retained).toBeGreaterThan(10000);
});

it.each(["length", "name"])("releases prototype retention after a throwing %s getter", async key => {
  const budget = new Budget({dataSize:100000});
  const retained: number[] = [];
  const inspect = declareHostOperation(() => { retained.push(measureSandboxData(budget.retainedValues())); }, "re-issue");
  const source = `function f(){}const bind=f.bind;Object.setPrototypeOf(f,{extra:'x'.repeat(10000)});
    Object.defineProperty(f,'${key}',{get(){Object.setPrototypeOf(f,null);inspect();throw 7}});let caught=false;try{bind.call(f,null)}catch(e){caught=e===7}inspect();return caught`;
  expect(await run(source,{budget,bindings:{inspect}})).toMatchObject({ok:true,returnValue:true});
  expect(retained[0]).toBeGreaterThan(10000);
  expect(retained[1]).toBeLessThan(1000);
});
