import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { Budget, createRealm, run } from "../../core.js";
import { dump } from "../../dump.js";

describe("Array.from construction", () => {
  it.each([
    "const values=[1,2];return Array.from(values,(v,i)=>{if(i===0)values[1]=9;return v})",
    "const values=[1,2];return Array.from(values,(v,i)=>{if(i===0)values.push(3);return v})",
    "const values=[1,2];return Array.from(values,(v,i)=>{if(i===0)values.length=1;return v})",
    "const values=new Set([1,2]);return Array.from(values,(v,i)=>{if(i===0)values.add(3);return v})",
    "const values=new Map([[1,'a'],[2,'b']]);return Array.from(values,(v,i)=>{if(i===0)values.set(3,'c');return v})",
    "const events=[];function* values(){try{events.push('next1');yield 1;events.push('next2');yield 2}finally{events.push('close')}}const result=Array.from(values(),v=>{events.push('map'+v);return v});return [result,events]",
    "const events=[];function* values(){try{events.push('next1');yield 1;events.push('next2');yield 2}finally{events.push('close')}}try{Array.from(values(),v=>{events.push('map'+v);throw 7})}catch(e){events.push(e)}return events",
    "const events=[];function* values(){events.push('next');yield 1}try{Array.from(values(),7)}catch(e){events.push(e.name)}return events",
    "const events=[];const reason={};function* values(){try{yield 1;events.push('extra')}finally{events.push('close');throw 8}}try{Array.from(values(),()=>{throw reason})}catch(e){return [e===reason,events]}",
    "const events=[];function* values(){try{yield 1;yield 2}finally{events.push('close');yield 9;events.push('tail')}}const iterator=values();try{Array.from(iterator,()=>{throw 7})}catch(e){events.push(e)}return [events,iterator.next()]",
    "function* values(){try{yield 1}finally{/y/.test('y')}}try{Array.from(values(),()=>{throw /x/})}catch(e){return e.test('x')}",
    "const item={};return Array.from([item])[0]===item",
    "const item={};return Array.from([1],()=>item)[0]===item",
    "const item={};function* values(){yield item}return Array.from(values())[0]===item",
    "const item={};const result=Array.from([1,2],()=>item);return [result[0]===item,result[0]===result[1]]",
    "const proto={0:7,length:1};return Array.from(Object.create(proto))",
    "const values={0:1,1:2,length:2};return Array.from(values,(v,i)=>{if(i===0)values[1]=9;return v})",
    "const values={0:1,1:2,length:2};return Array.from(values,(v,i)=>{if(i===0){values.length=1;delete values[1]}return v})",
    "const events=[];const length=Object.create({valueOf(){events.push('length');return 1}});return [Array.from({0:7,length}),events]",
    "const events=[];const length={valueOf(){events.push('valueOf');return {}},toString(){events.push('toString');return '1.9'}};return [Array.from({0:7,length}),events]",
    "const events=[];const length={async valueOf(){events.push('valueOf');await 0;events.push('after');return 2},toString(){events.push('toString');return '1'}};const result=Array.from({0:7,length});events.push('caller');await 0;return [result,events]",
    "function values(a,b){}values[0]=7;return Array.from(values)",
    "const length=Object.create(null);try{Array.from({length})}catch(e){return e.name}",
    "const length=new Date(2);return Array.from({0:7,1:8,length})",
    "function Output(length){this.argument=length;this.count=arguments.length}const value=Array.from.call(Output,{0:7,length:1});return [value instanceof Output,value.argument,value.count,value.length,value[0]]",
    "function Output(length){this.argument=length;this.count=arguments.length}const value=Array.from.call(Output,[7]);return [value instanceof Output,value.argument,value.count,value.length,value[0]]",
    "function Output(length){this.argument=length;this.count=arguments.length}const value=Array.from.call(Output,'a😀');return [value instanceof Output,value.argument,value.count,value.length,value[0],value[1]]",
    "const result={};function Output(){return result}return Array.from.call(Output,[7])===result",
    "function Output(prefix,length){this.prefix=prefix;this.inputLength=length}const Bound=Output.bind(null,'bound');const value=Array.from.call(Bound,{0:7,length:1});return [value instanceof Output,value.prefix,value.inputLength,value[0],value.length]",
    "function Output(){return []}const value=Array.from.call(Output,[7]);return [Array.isArray(value),value.length,value[0]]",
    "function Output(length){throw length}try{Array.from.call(Output,{length:Infinity})}catch(e){return e===Number.MAX_SAFE_INTEGER}",
    "const events=[];function Output(length){events.push(['construct',length]);return {}}const values={0:7,length:{valueOf(){events.push('length');return 1}}};Array.from.call(Output,values,v=>{events.push(['map',v]);return v});return events",
    "const events=[];function Output(){events.push('construct')}function* values(){events.push('next');yield 7}Array.from.call(Output,values(),v=>{events.push('map');return v});return events",
    "const events=[];function Output(){return Object.freeze({})}function* values(){try{yield 1;events.push('extra')}finally{events.push('close')}}try{Array.from.call(Output,values())}catch(e){events.push(e.name)}return events",
    "function Output(){}Object.defineProperty(Output.prototype,'0',{value:'inherited',writable:false});const result=Array.from.call(Output,[7]);const descriptor=Object.getOwnPropertyDescriptor(result,'0');return [result[0],descriptor.writable,descriptor.enumerable,descriptor.configurable]",
    "function Output(){Object.defineProperty(this,'length',{value:0,writable:false})}try{Array.from.call(Output,[])}catch(e){return e.name}",
    "const values=[1,2];const result=Array.from(values,async(v,i)=>{if(i===0)values[1]=9;await 0;return v});return await Promise.all(result)",
    "const result=Array.from([1,2],()=>/x/);return [result[0].test('x'),result[1].test('x')]",
    "const result=Array.from([1],function(v,i){return [this.label,v,i,arguments.length]},{label:'receiver'});return result",
    "const promise=Promise.resolve(7);const result=Array.from([1],()=>promise);return [result[0]===promise,await result[0]]",
    "const from=Array.from;return [from('a😀'),from({length:'2.9',1:7}),from({length:-2}),from(7)]",
    "const arrow=()=>{throw 'unused'};return Array.from.call(arrow,[7])"
  ])("matches native construction: %s", async (source) => {
    const wrapped = `try{${source}}catch(error){return ['uncaught',error.name]}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${wrapped}})()`, {}, { timeout: 1000 });
    expect(await run(wrapped)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("retains constructor and input identity across realm evaluations", async () => {
    const realm = createRealm();
    try {
      await realm.evaluate("const item={};function Output(){}const result=Array.from.call(Output,[item]);");
      expect(await realm.evaluate("return [result instanceof Output,result[0]===item,result.length]"))
        .toMatchObject({ ok: true, returnValue: [true, true, 1] });
    } finally {
      await realm.close();
    }
  });

  it("preserves completed replay without losing mapper identity", async () => {
    const source = "const item={};return Array.from([1],()=>item)[0]===item";
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: true });
    expect(await run(source, { snapshot: JSON.parse(await dump(first)) }))
      .toMatchObject({ ok: true, returnValue: true });
  });

  it("keeps array length budgets fatal during incremental construction", async () => {
    await expect(run("function* values(){for(let i=0;i<10;i++)yield i}try{return Array.from(values())}catch(error){return 'caught'}", {
      budget: new Budget({ arrayLength: 3 })
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
  });

  it("counts previously mapped values while the next callback allocates", async () => {
    const callback = "i=>{const temporary='y'.repeat(2000);return {value:'x'.repeat(2000)}}";
    expect(await run(`return Array.from([1],${callback}).length`, { budget: new Budget({ dataSize: 5000 }) }))
      .toMatchObject({ ok: true, returnValue: 1 });
    await expect(run(`return Array.from([1,2],${callback}).length`, { budget: new Budget({ dataSize: 5000 }) }))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(`return Array.from([1,2],${callback}).length`, { budget: new Budget({ dataSize: 7000 }) }))
      .toMatchObject({ ok: true, returnValue: 2 });
  });

  it("does not hide a fatal cleanup budget behind a mapper throw", async () => {
    await expect(run("function* values(){try{yield 1}finally{while(true){}}}try{Array.from(values(),()=>{throw 7})}catch(error){return 'caught'}", {
      budget: new Budget({ maxSteps: 1000 })
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });

  it.each([
    ["return Array.from({length:2000}).length", 100, 1000],
    ["function Output(){}return Array.from.call(Output,{length:2000}).length", 100, 1000],
    ["return Array.from('x'.repeat(400)).length", 700, 400]
  ] as const)("enforces data size before filling a callback-free result: %s", async (source, dataSize, maxSteps) => {
    await expect(run(source, { budget: new Budget({ dataSize, maxSteps }) }))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
  });

  it("does not rescan the complete result for every primitive element", async () => {
    const budget = new Budget({ dataSize: 20000 });
    const reconcile = vi.spyOn(budget, "reconcileCompileData");
    expect(await run("return Array.from({length:5000}).length", { budget }))
      .toMatchObject({ ok: true, returnValue: 5000 });
    expect(reconcile.mock.calls.length).toBeLessThan(100);
  });

  it.each(["unique", "shared", "array-like"])("does not rescan all roots for every %s object value", async (kind) => {
    const budget = new Budget({ dataSize: 1000000 });
    const reconcile = vi.spyOn(budget, "reconcileCompileData");
    const shared = { value: 7 };
    const values = Array.from({ length: 200 }, (_, index) => kind === "shared" ? shared : { value: index });
    const items = kind === "array-like" ? Object.assign({ length: values.length }, values) : values;
    expect(await run("return Array.from(items).length", { budget, bindings: { items } }))
      .toMatchObject({ ok: true, returnValue: 200 });
    expect(reconcile.mock.calls.length).toBeLessThan(100);
  });

  it("does not double-charge a retained string input", async () => {
    expect(await run("return Array.from('x'.repeat(400)).length", {
      budget: new Budget({ dataSize: 1500 })
    })).toMatchObject({ ok: true, returnValue: 400 });
  });

  it.each(["undefined", "null", "false", "0", "''"])("preserves a falsey mapper throw through failing cleanup: %s", async (reason) => {
    expect(await run(`const reason=${reason};function* values(){try{yield 1}finally{throw 8}}try{Array.from(values(),()=>{throw reason})}catch(error){return error===reason}`))
      .toMatchObject({ ok: true, returnValue: true });
  });

  it("keeps compiled mapped values live across data reconciliation", async () => {
    expect(await run("return Array.from([1,2],()=>/x/).map(value=>value.test('x'))", { budget: new Budget({ dataSize: 10000 }) }))
      .toMatchObject({ ok: true, returnValue: [true, true] });
    expect(await run("function* values(){try{yield 1}finally{/y/.test('y')}}try{Array.from(values(),()=>{throw /x/})}catch(error){return error.test('x')}", { budget: new Budget({ dataSize: 10000 }) }))
      .toMatchObject({ ok: true, returnValue: true });
  });
});
