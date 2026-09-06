import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

const setters = [
  "setTime", "setMilliseconds", "setUTCMilliseconds", "setSeconds", "setUTCSeconds",
  "setMinutes", "setUTCMinutes", "setHours", "setUTCHours", "setDate", "setUTCDate",
  "setMonth", "setUTCMonth", "setFullYear", "setUTCFullYear"
] as const;

it.each(setters)("coerces object arguments for Date.%s", async method => {
  const source = `const date=new Date(0);const events=[];const value=date.${method}({[Symbol.toPrimitive](hint){events.push(hint);return 7}});return [value,date.getTime(),events];`;
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it.each(setters)("uses the pre-coercion time for %s per ECMAScript 2026", async method => {
  const expected = new Date(0)[method](7);
  const source = `const date=new Date(0);const value=date.${method}({valueOf(){date.setTime(86400000);return 7}});return [value,date.getTime()];`;
  expect((await run(source)).returnValue).toEqual([expected, expected]);
});

it("preserves coercion side effects when an initially invalid Date returns NaN", async () => {
  const source = "const date=new Date(NaN);const value=date.setUTCDate({valueOf(){date.setTime(7);return 1}});return [Number.isNaN(value),date.getTime()];";
  expect((await run(source)).returnValue).toEqual([true, 7]);
});

it.each([
  "const date=new Date(0);const events=[];function part(n){return {valueOf(){events.push(n);return n}}}const value=date.setUTCHours(part(1),part(2),part(3),part(4),part(5));return [value,events];",
  "const date=new Date(0),error={};try{date.setUTCSeconds({valueOf(){date.setTime(7);throw error}})}catch(caught){return [caught===error,date.getTime()]}",
  "let calls=0;try{Date.prototype.setTime.call({}, {valueOf(){calls++;return 7}})}catch(error){return [error.name,calls]}",
  "const date=new Date(0);Object.freeze(date);date.setTime({valueOf(){return 7}});return date.getTime();",
  "const date=new Date(0);try{date.setTime({valueOf(){return BigInt(7)}})}catch(error){return [error.name,date.getTime()]}",
  "const date=new Date(0);try{date.setTime({valueOf(){return Symbol('time')}})}catch(error){return [error.name,date.getTime()]}",
  "const date=new Date(0);const value=new Date(7);value.valueOf=()=>42;return date.setTime(value);",
  "class Child extends Date{};const date=new Child(0);date.setUTCFullYear({valueOf(){return 2001}});return [date instanceof Child,date.getUTCFullYear()];",
  "const date=new Date(0);Object.setPrototypeOf(date,null);return Date.prototype.setTime.call(date,{valueOf(){return 7}});"
])("matches native ordinary setter behavior: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it.each(["setTime", "setFullYear", "setUTCFullYear"] as const)("recovers an initially invalid Date through %s", async method => {
  const expected = new Date(NaN)[method](7);
  const source = `const date=new Date(NaN);const value=date.${method}({valueOf(){date.setTime(86400000);return 7}});return [value,date.getTime()];`;
  expect((await run(source)).returnValue).toEqual([expected, expected]);
});

it("converts all provided components before an invalid-time return per ECMAScript 2026", async () => {
  const source = "const date=new Date(NaN);const events=[];function part(n){return {valueOf(){events.push(n);return n}}}const value=date.setUTCHours(part(1),part(2),part(3),part(4));return [Number.isNaN(value),events];";
  expect((await run(source)).returnValue).toEqual([true, [1, 2, 3, 4]]);
});

it.each(["pending", "completed"])("preserves setter coercion through %s replay", async mode => {
  const source = "const date=new Date(0);date.setUTCFullYear({valueOf(){date.setTime(86400000);return 2001}});await 0;return date.getTime();";
  const expected = Date.UTC(2001, 0, 1);
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: expected });
  } finally { await completed; }
});

it("keeps setter coercion budget exhaustion fatal", async () => {
  await expect(run("try{new Date(0).setTime({valueOf(){while(true){}}})}catch(error){return 'caught'}", { budget: new Budget({ maxSteps: 100 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded" });
});
