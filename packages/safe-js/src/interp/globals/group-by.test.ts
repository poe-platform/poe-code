import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { serialize, type RuntimeSnapshotValue } from "../../snapshot/serialize.js";
import { restore as restoreHeap } from "../../snapshot/restore.js";
import { isSandboxClosure } from "../values.js";

it.each([
  "return Object.groupBy([1,2,3,4],x=>x%2)",
  "return [...Map.groupBy([1,2,3,4],x=>x%2)]",
  "const r=Object.groupBy([1],()=> '__proto__');return [Object.getPrototypeOf(r)===null,r.__proto__,Object.getOwnPropertyDescriptor(r,'__proto__')]",
  "const s=Symbol();const r=Object.groupBy([1,2],()=>s);return [Reflect.ownKeys(r)[0]===s,r[s]]",
  "const a={},b={};const r=Map.groupBy([a,b,a],x=>x);return [r.size,r.get(a).length,r.get(b)[0]===b]",
  "return [...Map.groupBy([-0,0,NaN,NaN],x=>x)].map(([key,values])=>[Object.is(key,-0),Number.isNaN(key),values.length])",
  "const trace=[];const r=Object.groupBy('a😀b',function(v,i){trace.push([v,i,this===undefined,arguments.length]);return i%2});return [r,trace]",
  "const a=[1,2];return Object.groupBy(a,(v,i)=>{if(i===0)a.push(3);return 'all'})",
  "const trace=[];function* values(){try{yield 1;yield 2}finally{trace.push('close')}}try{Object.groupBy(values(),()=>{throw 7})}catch(e){return [e,trace]}",
  "const trace=[];function* values(){try{yield 1}finally{trace.push('close');throw 8}}try{Object.groupBy(values(),()=>({toString(){throw 7}}))}catch(e){return [e,trace]}",
  "const trace=[];const values={[Symbol.iterator](){return {next(){throw 7},return(){trace.push('close');return {}}}}};try{Map.groupBy(values,()=>0)}catch(e){return [e,trace]}",
  "const trace=[];const values={[Symbol.iterator](){return {next(){return {get done(){throw 7}}},return(){trace.push('close');return {}}}}};try{Object.groupBy(values,()=>0)}catch(e){return [e,trace]}",
  "const trace=[];const values={[Symbol.iterator](){return {next(){return {done:false,get value(){throw 7}}},return(){trace.push('close');return {}}}}};try{Object.groupBy(values,()=>0)}catch(e){return [e,trace]}",
  "const trace=[];const values={get [Symbol.iterator](){trace.push('iterator');return function(){return {next(){return {done:true}}}}}};try{Object.groupBy(values,null)}catch(e){return [e.name,trace]}",
  "return [Object.groupBy.length,Map.groupBy.length,Object.groupBy.name,Map.groupBy.name]",
  "return [Object.groupBy([],()=>0),[...Map.groupBy([],()=>0)]]",
  "return [...Map.groupBy.call(function(){throw 7},[1,2],()=>true)]",
  "const trace=[];const key={toString(){trace.push('key');return 'a'}};return [Object.groupBy([1,2],()=>key),trace]",
  "const key={toString(){throw 7}};const r=Map.groupBy([1,2],()=>key);return r.get(key)",
  "return Object.groupBy([,1,,],v=>String(v))"
])("matches native grouping: %s", async source => {
  const expected = runInNewContext(`(function(){"use strict";${source}})()`);
  const result = await run(`if(typeof Object.groupBy!=="function"||typeof Map.groupBy!=="function")throw new Error("Missing groupBy");${source}`);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  expect(result.returnValue).toEqual(expected);
});

it.each(["Object", "Map"])("bounds %s grouping array length", async kind => {
  await expect(run(`function* values(){yield 1;yield 2;yield 3}return ${kind}.groupBy(values(),()=>0)`, { budget: new Budget({ arrayLength: 2 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
});

it.each(["Object", "Map"])("bounds retained %s groups while obtaining the next value", async kind => {
  const source = `function* values(){yield 'x'.repeat(2000);const temporary='y'.repeat(2000);yield 'z'.repeat(2000)}return ${kind}.groupBy(values(),()=>0)`;
  await expect(run(source, { budget: new Budget({ dataSize: 5000 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
  expect(await run(source, { budget: new Budget({ dataSize: 10000 }) })).toMatchObject({ ok: true });
});

it.each(["Object", "Map"])("preserves %s grouping across completed replay", async kind => {
  const source = `const value={n:7};const grouped=${kind}.groupBy([value,value],()=>0);await 0;const list=${kind === "Map" ? "grouped.get(0)" : "grouped[0]"};return [list.length,list[0]===list[1],list[0].n]`;
  const pending = run(source);
  const result = await pending;
  expect(result).toMatchObject({ ok: true, returnValue: [2,true,7] });
  const snapshot = restore(JSON.parse(await dump(pending)), { source });
  expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: [2,true,7] });
});

it("does not hide fatal iterator cleanup behind a callback error", async () => {
  await expect(run("function* values(){try{yield 1}finally{while(true){}}}try{Object.groupBy(values(),()=>{throw 7})}catch(e){return 'caught'}", { budget: new Budget({ maxSteps: 1000 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
});

it.each(["Object", "Map"])("restores retained %s groups with aliases and key identity", async kind => {
  const source = `const key=Symbol('key');const value={n:7};const groups=${kind}.groupBy([value,value],()=>key);return ()=>{const a=${kind === "Map" ? "groups.get(key)" : "groups[key]"};return [a[0]===a[1],a[0].n++,${kind === "Map" ? "groups.has(key)" : "Object.getPrototypeOf(groups)===null"}]}`;
  const result = await run(source);
  if (!result.ok) throw result.error;
  let reader = result.returnValue as RuntimeSnapshotValue;
  for (let round = 0; round < 2; round++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restoreHeap(JSON.parse(JSON.stringify(saved)), { source });
    const binding = restored.currentScope.lookup("reader");
    if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing reader");
    expect(await binding.value.call([])).toEqual([true,7 + round,true]);
    reader = binding.value;
  }
});
