import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each(["fromCharCode", "fromCodePoint"].flatMap(method => [
  "({valueOf(){return 65}})",
  "({toString(){return '65'}})",
  "({[Symbol.toPrimitive](hint){if(hint!=='number')throw 9;return 65}})",
  "({valueOf(){return {}},toString(){return '65'}})"
].map(input => ({method,input}))))("coerces String.$method($input)", async ({method,input}) => {
  const source = `try{return String.${method}(${input})}catch(error){return error.name}`;
  const expected = runInNewContext(`(()=>{${source}})()`);
  expect((await run(source)).returnValue).toEqual(expected);
});

it.each(["fromCharCode", "fromCodePoint"].flatMap(method => [
  "", "undefined", "null", "true", "'65'", "-0", "-1", "65.9", "NaN", "Infinity",
  "0x10ffff", "0x110000", "0xd800", "65,0x1f34b,66", "65n", "Symbol()",
  "({valueOf(){return 65n}})", "({valueOf(){return Symbol()}})",
  "({valueOf(){throw 7}})", "({async valueOf(){return 65},toString(){return '66'}})"
].map(input => ({method,input}))))("matches native String.$method($input)", async ({method,input}) => {
  const source = `try{return String.${method}(${input})}catch(error){return [error.name,typeof error==="number"?error:undefined]}`;
  const expected = runInNewContext(`(()=>{${source}})()`);
  const result = await run(source);
  expect(result.ok).toBe(true);
  expect(result.returnValue).toEqual(expected);
});

it.each(["fromCharCode", "fromCodePoint"])("preserves %s conversion order and job timing", async method => {
  const source = `const log=[];Promise.resolve().then(()=>log.push("job"));const value=String.${method}({valueOf(){log.push("first");return 65}},{valueOf(){log.push("second");return 66}});log.push(value);await 0;return log`;
  expect((await run(source)).returnValue).toEqual(await runInNewContext(`(async()=>{${source}})()`));
});

it("stops fromCodePoint before later coercions after an invalid value", async () => {
  const source = 'const log=[];try{String.fromCodePoint({valueOf(){log.push("first");return -1}},{valueOf(){log.push("second");return 65}})}catch(error){log.push(error.name)}return log';
  expect((await run(source)).returnValue).toEqual(["first","RangeError"]);
});

it.each(["fromCharCode", "fromCodePoint"])("preserves %s completed effects through checkpoints", async method => {
  const source = `return String.${method}({valueOf(){return code()}})`;
  let calls = 0;
  const bindings = { code() { calls++; return 65; } };
  const result = await run(source,{bindings});
  const snapshot = restore(JSON.parse(await dump(result)),{source});
  expect((await run(source,{bindings,snapshot})).returnValue).toBe("A");
  expect(calls).toBe(1);
});

it.each(["fromCharCode", "fromCodePoint"])("bounds %s output and releases retained inputs", async method => {
  const budget = new Budget({stringLength:2});
  await expect(run(`return String.${method}(65,66,67)`,{budget})).rejects.toMatchObject({code:"budgetExceeded"});
  expect([...budget.retainedValues()]).toEqual([]);
});
