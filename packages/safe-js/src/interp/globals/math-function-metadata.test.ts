import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";
import { createBuiltinBindings } from "../globals.js";
import { getIntrinsicIdentity } from "../intrinsics.js";
import { releaseObjectPrototype } from "../object-model.js";
import { validateGuestHeapNode } from "../../snapshot/guest-heap-validation.js";

const methods = ["abs", "acos", "acosh", "asin", "asinh", "atan", "atan2", "atanh",
  "ceil", "cbrt", "clz32", "cos", "cosh", "exp", "expm1", "floor", "f16round",
  "fround", "hypot", "imul", "log", "log1p", "log10", "log2", "max", "min",
  "pow", "random", "round", "sign", "sin", "sinh", "sqrt", "sumPrecise", "tan", "tanh", "trunc"];

it.each(methods)("exposes standard Math.%s name and arity descriptors", async name => {
  const native = Math[name as keyof Math] as ((...args: number[]) => number) | undefined;
  const length = name === "f16round" || name === "sumPrecise" ? 1 : native!.length;
  const result = await run(`const fn=Math.${name};return [fn.name,fn.length,
    Object.getOwnPropertyDescriptor(fn,"name"),Object.getOwnPropertyDescriptor(fn,"length")]`);
  expect(result.returnValue).toEqual([name, length,
    {value:name,writable:false,enumerable:false,configurable:true},
    {value:length,writable:false,enumerable:false,configurable:true}]);
});

it.each(methods)("allows standard property mutation on Math.%s", async name => {
  const source = `const fn=Math.${name};Object.defineProperty(fn,"name",{value:"changed"});
    Object.defineProperty(fn,"length",{value:7});fn.extra=9;
    return [fn.name,fn.length,fn.extra,Object.keys(fn),Object.hasOwn(fn,"prototype")]`;
  expect((await run(source)).returnValue).toEqual(["changed",7,9,["extra"],false]);
});

it.each(methods)("preserves the qualified Math.%s intrinsic identity", name => {
  const budget = new Budget();
  try {
    const globals = createBuiltinBindings({budget});
    const id = JSON.stringify(["Math",name]);
    expect(getIntrinsicIdentity(globals.Math[name] as object)).toBe(id);
    expect(validateGuestHeapNode({kind:"intrinsic",id},{})).toBe(true);
  } finally { releaseObjectPrototype(budget); }
});

it.each(methods.flatMap(name => ["pending","completed"].map(mode => ({name,mode}))))(
  "preserves Math.$name metadata in $mode checkpoints", async ({name,mode}) => {
    const source = `const fn=Math.${name};Object.defineProperty(fn,"name",{value:"changed"});
      Object.defineProperty(fn,"length",{value:7});fn.extra=9;await 0;
      return [fn===Math.${name},fn.name,fn.length,fn.extra]`;
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      if (mode === "completed") await completed;
      const snapshot = restore(JSON.parse(await dump(pending)),{source});
      const result = await completed;
      expect(result).toMatchObject({ok:true,returnValue:[true,"changed",7,9]});
      expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:result.returnValue});
      expect(await run(source,{snapshot:result.snapshot})).toMatchObject({ok:true,returnValue:result.returnValue});
    } finally { await completed; }
  }
);

it("rejects forged raw snapshot wrappers with modified Math methods", async () => {
  const source = 'Math.abs.extra=7;await 0;return Math.abs.extra';
  const result = await run(source);
  expect(() => restore({...result.snapshot},{source})).toThrow(expect.objectContaining({code:"invalidState"}));
  expect(restore(result.snapshot,{source})).toHaveProperty("heap");
});
