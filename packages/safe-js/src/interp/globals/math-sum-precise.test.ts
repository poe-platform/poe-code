import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";
import { sumPrecise } from "./math-sum-precise.js";

// ECMAScript 2026, 21.3.2.34: exact sum, rounded once to binary64.
it.each([
  {input:"[]",expected:-0},
  {input:"[-0,-0]",expected:-0},
  {input:"[0,-0]",expected:0},
  {input:"[1e20,0.1,-1e20]",expected:0.1},
  {input:"[Number.MAX_VALUE,Number.MAX_VALUE,-Number.MAX_VALUE]",expected:Number.MAX_VALUE},
  {input:"[1,2**-53]",expected:1},
  {input:"[1,2**-53,Number.MIN_VALUE]",expected:1+Number.EPSILON},
  {input:"[Number.MIN_VALUE,Number.MIN_VALUE]",expected:2*Number.MIN_VALUE},
  {input:"[Infinity,-Infinity]",expected:NaN},
  {input:"[NaN,1]",expected:NaN},
  {input:"new Set([1,2,3])",expected:6}
])("sums $input precisely", async ({input,expected}) => {
  expect((await run(`return Math.sumPrecise(${input})`)).returnValue).toBe(expected);
});

it("closes the iterator when a non-number is encountered", async () => {
  const source = `const calls=[];const values={ [Symbol.iterator](){return {
    next(){calls.push("next");return {done:false,value:"1"}},
    return(){calls.push("return");return {done:true}}
  }}};try{Math.sumPrecise(values)}catch(error){return [error.name,calls]}`;
  expect((await run(source)).returnValue).toEqual(["TypeError",["next","return"]]);
});

it("consumes generators without rounding each intermediate addition", async () => {
  expect((await run('function* values(){yield 1e20;yield 0.1;yield -1e20}return Math.sumPrecise(values())')).returnValue)
    .toBe(0.1);
});

it.each([
  {input:"[-1,-(2**-53),-Number.MIN_VALUE]",expected:-(1+Number.EPSILON)},
  {input:"[1,3*2**-53]",expected:1+2*Number.EPSILON},
  {input:"[Number.MAX_VALUE,Number.MAX_VALUE]",expected:Infinity},
  {input:"[-Number.MAX_VALUE,-Number.MAX_VALUE]",expected:-Infinity},
  {input:"[Infinity,1]",expected:Infinity},
  {input:"[-Infinity,1]",expected:-Infinity},
  {input:"[Infinity,NaN]",expected:NaN},
  {input:"[NaN,-Infinity]",expected:NaN},
  {input:"[-1,1]",expected:0},
  {input:"[2**-1022,-Number.MIN_VALUE]",expected:2**-1022-Number.MIN_VALUE}
])("handles exact rounding and special values for $input", async ({input,expected}) => {
  expect((await run(`return Math.sumPrecise(${input})`)).returnValue).toBe(expected);
});

it.each(["[1e300,0.1,-1e300]","[0.1,1e300,-1e300]","[1e300,-1e300,0.1]",
  "[-1e300,0.1,1e300]","[0.1,-1e300,1e300]","[-1e300,1e300,0.1]"])(
  "is order-independent for %s", async input => {
    expect((await run(`return Math.sumPrecise(${input})`)).returnValue).toBe(0.1);
  }
);

it.each(["undefined","null","1","{}","['1']","[1n]","[Symbol()]","[new Number(1)]",
  "[Promise.resolve(1)]","[true]","[undefined]","[,]"])("rejects non-numeric iterable input %s", async input => {
  expect((await run(`try{Math.sumPrecise(${input})}catch(error){return error.name}`)).returnValue).toBe("TypeError");
});

it("does not call numeric coercion hooks and still closes the iterator", async () => {
  const source = `const calls=[];function* values(){try{yield {valueOf(){calls.push("coerce");return 1}}}finally{calls.push("close")}}
    try{Math.sumPrecise(values())}catch(error){return [error.name,calls]}`;
  expect((await run(source)).returnValue).toEqual(["TypeError",["close"]]);
});

it.each(["throw new Error('close')","return 1"])("preserves the original rejection when return does %s", async closing => {
  const source = `const calls=[];const values={[Symbol.iterator](){return {
    next(){return {done:false,value:null}},return(){calls.push("close");${closing}}
  }}};try{Math.sumPrecise(values)}catch(error){return [error.name,calls]}`;
  expect((await run(source)).returnValue).toEqual(["TypeError",["close"]]);
});

it.each(["next","done","value"])("does not close after an abrupt %s operation", async operation => {
  const source = `const calls=[];const values={[Symbol.iterator](){return {
    next(){calls.push("next");${operation === "next" ? 'throw new Error("next")' : `return {
      get done(){calls.push("done");${operation === "done" ? 'throw new Error("done")' : 'return false'}},
      get value(){calls.push("value");throw new Error("value")}
    }`}},return(){calls.push("close");return {done:true}}
  }}};try{Math.sumPrecise(values)}catch(error){return [error.message,calls]}`;
  const calls = operation === "next" ? ["next"] : operation === "done" ? ["next","done"] : ["next","done","value"];
  expect((await run(source)).returnValue).toEqual([operation,calls]);
});

it("reads iterator operations and result properties in the specified order", async () => {
  const source = `const calls=[];let index=0;const values={get [Symbol.iterator](){calls.push("iterator");return function(){calls.push(this===values);return {
    get next(){calls.push("next getter");return function(){calls.push("next");return {
      get done(){calls.push("done");return index++===1},get value(){calls.push("value");return 7}
    }}},return(){calls.push("close");return {done:true}}
  }}}};const value=Math.sumPrecise(values);return [value,calls]`;
  expect((await run(source)).returnValue).toEqual([7,["iterator",true,"next getter","next","done","value","next","done"]]);
});

it("continues iterating after NaN and Infinity", async () => {
  const source = 'const calls=[];function* values(){try{yield NaN;yield Infinity;calls.push("last");yield "bad"}finally{calls.push("close")}}try{Math.sumPrecise(values())}catch(error){return [error.name,calls]}';
  expect((await run(source)).returnValue).toEqual(["TypeError",["last","close"]]);
});

it.each(["pending","completed"])("preserves sumPrecise in %s checkpoints", async mode => {
  const source = 'const fn=Math.sumPrecise;const value=fn([1e20,0.1,-1e20]);fn.extra=7;await 0;return [value,fn===Math.sumPrecise,fn.name,fn.length,fn.extra,fn([1,2,3])]';
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)),{source});
    const result = await completed;
    expect(result).toMatchObject({ok:true,returnValue:[0.1,true,"sumPrecise",1,7,6]});
    expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:result.returnValue});
    expect(await run(source,{snapshot:result.snapshot})).toMatchObject({ok:true,returnValue:result.returnValue});
  } finally { await completed; }
});

it("bounds an unending iterator with the execution budget", async () => {
  await expect(run('Math.sumPrecise({[Symbol.iterator](){return {next(){return {value:1,done:false}}}}})',
    {budget:new Budget({maxSteps:100})})).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
});

it("accounts for the retained exact accumulator", async () => {
  await expect(sumPrecise([Number.MAX_VALUE],new Budget({dataSize:100})))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"dataSize"});
});

it("supports direct host iterables", async () => {
  await expect(sumPrecise(new Set([1,2,3]) as never,new Budget())).resolves.toBe(6);
});

it.each([-1074,-1022,-1000,-500,-53,-1,0,1,500,900,969])(
  "preserves exact cancellation residuals at binary exponent %s", async exponent => {
    const small = 2 ** exponent;
    const large = 2 ** Math.min(1023, exponent + 100);
    await expect(sumPrecise([large,small,-large],new Budget())).resolves.toBe(small);
    await expect(sumPrecise([-large,-small,large],new Budget())).resolves.toBe(-small);
  }
);

it("does not assimilate promises returned by synchronous host iterators", async () => {
  let closed = 0;
  const values = { [Symbol.iterator]() { return {
    next: () => Promise.resolve({done:false,value:1}),
    return() { closed++; return {done:true}; }
  }; } };
  await expect(sumPrecise(values as never,new Budget({maxSteps:10}))).rejects.toBeInstanceOf(TypeError);
  expect(closed).toBe(1);
});

it("releases retained accumulator state after failure", async () => {
  const budget = new Budget({dataSize:300});
  await expect(sumPrecise([Number.MAX_VALUE],budget)).rejects.toMatchObject({code:"budgetExceeded"});
  await expect(sumPrecise([1,2,3],budget)).resolves.toBe(6);
});
