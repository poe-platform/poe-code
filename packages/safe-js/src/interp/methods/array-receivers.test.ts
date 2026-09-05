import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";
import { callArrayMethod } from "./array.js";
import { createSandboxClosure } from "../values.js";

const methods = [
  ["map", "x=>x*2"],
  ["filter", "x=>x>1"],
  ["find", "x=>x>1"],
  ["findIndex", "x=>x>1"],
  ["findLast", "x=>x>1"],
  ["findLastIndex", "x=>x>1"],
  ["some", "x=>x===1"],
  ["every", "x=>x>1"],
  ["reduce", "(sum,x)=>sum+x,0"],
  ["reduceRight", "(sum,x)=>sum-x,0"],
  ["forEach", "(x,i,receiver)=>seen.push([x,i,receiver===b])"],
  ["flatMap", "x=>[x,x]"],
  ["flat", ""],
  ["includes", "1"],
  ["indexOf", "1"],
  ["lastIndexOf", "1"],
  ["join", "'-'"],
  ["slice", "1"],
  ["concat", "[5]"],
  ["splice", "1,1,7"],
  ["fill", "7,1"],
  ["copyWithin", "0,1"],
  ["at", "1"],
  ["sort", "(a,b)=>a-b"],
  ["reverse", ""],
  ["toSorted", "(a,b)=>a-b"],
  ["toReversed", ""],
  ["toSpliced", "1,1,7"],
  ["with", "1,9"],
  ["push", "7"],
  ["pop", ""],
  ["shift", ""],
  ["unshift", "7"]
] as const;

describe.each([
  ["array", "[3,1,2]"],
  ["array-like object", "{0:3,2:2,length:3}"]
])("borrowed Array methods on %s receivers", (_kind, receiver) => {
  it.each(methods)("%s uses the call receiver", async (method, args) => {
    const source = `const a=[9,8];const b=${receiver};const seen=[];
      const result=a.${method}.call(b${args ? `,${args}` : ""});
      return [result,result===b,a,b,seen];`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});

describe.each(["undefined", "null"])("Array methods with %s receivers", receiver => {
  it.each(methods)("%s rejects the receiver", async (method, args) => {
    const source = `const a=[9,8];const b=${receiver};const seen=[];
      try { a.${method}.call(b${args ? `,${args}` : ""});return ['accepted',a]; }
      catch(error){return [error.name,a];}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});

describe("Array method direct-call controls", () => {
  it.each(methods)("%s preserves direct calls", async (method, args) => {
    const source = `const b=[3,1,2];const seen=[];const result=b.${method}(${args});
      return [result,result===b,b,seen];`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});

describe("Array receiver property and invocation semantics", () => {
  it.each([
    "const a=[9];const b=[1,2];return [a.slice.apply(b,[1]),a.map.bind(b)(x=>x*2),a,b]",
    "const a=[9];const method=a.push;try{method(1)}catch(error){return [error.name,a]}",
    "const a=[9];const b=[1,2];const context={sum:0};const values=a.map.call(b,function(x,i,receiver){this.sum+=x;return [receiver===b,i,x]},context);return [values,context.sum,a,b]",
    "const a=[9];const b=[1,2];b.push='shadow';const n=a.push.call(b,3);return [n,b[0],b[1],b[2],b.length,b.push,a]",
    "const a=[9];const b=[1,2];b.pop='shadow';const n=a.pop.call(b);return [n,b[0],b.length,b.pop,a]",
    "const b=Object.create({0:7,length:2});b[1]=3;return [].slice.call(b)",
    "const b={0:7,1:3,length:'2.9'};return [Array.from([].map.call(b,x=>x*2)),b.length]",
    "const b={0:7,1:3,length:'2.9'};const result=[].pop.call(b);return [result,b]",
    "const b={0:7,length:-2};return [].map.call(b,x=>x*2)",
    "const seen=[];const b={0:7,length:{valueOf(){seen.push('length');return 1}}};const result=[].map.call(b,x=>{seen.push('callback');return x*2});return [result,seen]",
    "const b={0:7,length:1};Object.defineProperty(b,'length',{writable:false});try{[].push.call(b,3)}catch(error){return [error.name,b[0],b[1],b.length]}",
    "const b={0:7,1:3,length:2};Object.defineProperty(b,'1',{configurable:false});try{[].pop.call(b)}catch(error){return [error.name,b[0],b[1],b.length]}",
    "const b=[7,3,1];const start={valueOf(){b.length=1;return 0}};const result=b.slice(start);return [result,result.length,Object.keys(result),b]",
    "const b=[7,3,1];const start={valueOf(){b.length=1;return 1}};return [b.toSpliced(start,1,9),b]",
    "const b={0:7,1:3,length:2};return [[].toSpliced.call(b),[].toSpliced.call(b,1),[].toSpliced.call(b,1,undefined,9)]",
    "function b(x,y){}b[0]=7;b[1]=3;return [].map.call(b,x=>x*2)",
    "function b(x,y){}b[0]=7;b[1]=3;return [].reduce.call(b,(sum,x,i,receiver)=>sum+x+(receiver===b?1:0),0)",
    "function b(x,y){}b[0]=7;b[1]=3;try{[].pop.call(b)}catch(error){return [error.name,Object.hasOwn(b,1),b.length]}",
    "return [].map.call(new Float32Array([1,2]),x=>x*2)",
    "const b={0:7,1:3,length:2};return [].reduce.call(b,(sum,x,i,receiver)=>sum+x+(receiver===b?1:0),0)"
  ])("matches native behavior: %s", async source => {
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});

describe("array-like result admission", () => {
  it.each([
    ["array", "['x'.repeat(2000),'y'.repeat(2000)]"],
    ["record", "{0:'x'.repeat(2000),1:'y'.repeat(2000),length:2}"]
  ])("retains the %s receiver after its guest binding is cleared", async (_kind, initial) => {
    const source = `let value=${initial};return [].map.call(value,x=>{value=null;const temporary='z'.repeat(2000);return 1})`;
    await expect(run(source, { budget: new Budget({ dataSize: 7000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 10000 }) })).toMatchObject({ ok: true, returnValue: [1, 1] });
  });

  it.each([false, true])("releases its retained receiver after callback failure=%s", async fail => {
    const budget = new Budget();
    const receiver = { 0: 7, length: 1 };
    const observed: boolean[] = [];
    const execution = callArrayMethod(receiver, "map", [createSandboxClosure({ call: () => 1 })], {
      budget,
      callClosure: async () => {
        observed.push([...budget.retainedValues()].includes(receiver));
        if (fail) throw new Error("callback failed");
        return 1;
      }
    });
    if (fail) await expect(execution).rejects.toThrow("callback failed");
    else expect(await execution).toEqual([1]);
    expect(observed).toEqual([true]);
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it.each(["indexOf", "lastIndexOf", "reverse"] as const)("%s charges missing-property probes", async method => {
    const options = { budget: new Budget({ maxSteps: 2 }), hasProperty: () => false, callClosure: async () => undefined };
    await expect(callArrayMethod({ length: 20 }, method, [7], options)).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });

  it.each(["slice", "toSorted", "toReversed", "toSpliced", "with"] as const)("%s checks capacity before reading elements", async method => {
    const reads: number[] = [];
    const receiver = { length: 2, get 0() { reads.push(0); return 7; }, get 1() { reads.push(1); return 3; } };
    const options = { budget: new Budget({ arrayLength: 1 }), callClosure: async () => undefined };
    await expect(callArrayMethod(receiver, method, method === "with" ? [0, 9] : [], options)).rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
    expect(reads).toEqual([]);
  });

  it("toSpliced does not read removed elements or allocate the original length", async () => {
    const reads: number[] = [];
    const receiver = { length: 3, get 0() { reads.push(0); return 7; }, get 1() { reads.push(1); return 3; }, get 2() { reads.push(2); return 1; } };
    const options = { budget: new Budget({ arrayLength: 1 }), callClosure: async () => undefined };
    expect(await callArrayMethod(receiver, "toSpliced", [1, 2], options)).toEqual([7]);
    expect(reads).toEqual([0]);
  });

  it("toReversed reads elements in reverse order", async () => {
    const reads: number[] = [];
    const receiver = { length: 2, get 0() { reads.push(0); return 7; }, get 1() { reads.push(1); return 3; } };
    const options = { budget: new Budget(), callClosure: async () => undefined };
    expect(await callArrayMethod(receiver, "toReversed", [], options)).toEqual([3, 7]);
    expect(reads).toEqual([1, 0]);
  });
});
