import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";
import { createMathGlobals } from "./math.js";
import type { SandboxClosure } from "../values.js";

it.each(["abs", "acos", "acosh", "asin", "asinh", "atan", "atanh", "ceil",
  "cbrt", "clz32", "cos", "cosh", "exp", "expm1", "floor", "fround", "log",
  "log1p", "log10", "log2", "round", "sign", "sin", "sinh", "sqrt", "tan", "tanh", "trunc"])(
  "invokes guest numeric conversion for Math.%s", async name => {
    const method = Math[name as keyof Math] as (value: number) => number;
    const source = `const calls=[]; const value=Math.${name}({valueOf(){calls.push("valueOf");return 0.5}});return [value,calls]`;
    expect((await run(source)).returnValue).toEqual([method(0.5), ["valueOf"]]);
  }
);

it.each(["atan2", "hypot", "imul", "max", "min", "pow"])(
  "converts Math.%s arguments from left to right", async name => {
    const method = Math[name as keyof Math] as (...args: number[]) => number;
    const source = `const calls=[];const first={valueOf(){calls.push(1);return 2}};
      const second={valueOf(){calls.push(2);return 3}};
      const value=Math.${name}(first,second);return [value,calls]`;
    expect((await run(source)).returnValue).toEqual([method(2, 3), [1, 2]]);
  }
);

it("converts guest input to Math.f16round", async () => {
  expect((await run('return Math.f16round({[Symbol.toPrimitive](hint){if(hint!=="number")throw new Error(hint);return 1.5}})')).returnValue)
    .toBe(1.5);
});

it.each([
  'const calls=[];const value=Math.abs({get valueOf(){calls.push("get");return function(){calls.push(this.tag);return -7}},tag:"receiver"});return [value,calls]',
  'const calls=[];const value=Math.abs({valueOf(){calls.push(1);return {}},toString(){calls.push(2);return "-7"}});return [value,calls]',
  'return Math.abs(Object.create({valueOf(){return -7}}))',
  'const calls=[];const bad={valueOf(){calls.push("bad");throw new Error("stop")}};const next={valueOf(){calls.push("next");return 7}};try{Math.pow(bad,next)}catch(error){return [error.message,calls]}',
  'const calls=[];const next={valueOf(){calls.push("next");return 7}};const value=Math.max(NaN,next);return [Number.isNaN(value),calls]',
  'const calls=[];const next={valueOf(){calls.push("next");return 7}};const value=Math.hypot(Infinity,next);return [value,calls]',
  'const bad={valueOf(){throw new Error("unused")}};return [Math.abs(-7,bad),Math.pow(2,3,bad),typeof Math.random(bad)]',
  'const results=[];for(const value of [1n,Symbol("n"),{valueOf(){return 1n}},{[Symbol.toPrimitive](){return Symbol("n")}}]){try{Math.abs(value)}catch(error){results.push(error.name)}}return results',
  'return [Math.abs(),Math.pow(2),Math.max(),Math.min(),Math.hypot(),Math.imul(),Object.is(Math.sign(-0),-0)]',
  'const calls=[];try{Math.abs({async valueOf(){calls.push("start");await 0;calls.push("end");return -7}})}catch(error){calls.push(error.name)}await 0;return calls'
])("matches native conversion behavior: %s", async source => {
  const expected = await new Function(`return (async()=>{${source}})()`)();
  expect((await run(source)).returnValue).toEqual(expected);
});

it.each(["pending", "completed"])("preserves guest conversions across %s checkpoints", async mode => {
  const source = 'const calls=[];const value={valueOf(){calls.push("convert");return -7}};const before=Math.abs(value);await 0;return [before,Math.abs(value),calls]';
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), {source});
    const result = await completed;
    expect(result).toMatchObject({ok:true,returnValue:[7,7,["convert","convert"]]});
    expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:result.returnValue});
    expect(await run(source,{snapshot:result.snapshot})).toMatchObject({ok:true,returnValue:result.returnValue});
  } finally { await completed; }
});

it("charges each variadic numeric conversion to the execution budget", () => {
  const globals = createMathGlobals({budget: new Budget({maxSteps: 2})});
  const maximum = globals.Math.max as SandboxClosure;
  expect(() => maximum.call([1,2,3])).toThrow(expect.objectContaining({code:"budgetExceeded",budget:"steps"}));
});
