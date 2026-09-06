import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";

it.each([
  "return new Date({valueOf(){return 7}}).getTime();",
  "return new Date({[Symbol.toPrimitive](hint){return hint==='default'?'1970-01-01T00:00:00.007Z':0}}).getTime();",
  "return Date.UTC({valueOf(){return 2024}},0,1);",
  "return Date.parse({toString(){return '1970-01-01T00:00:00.007Z'}});",
  "const events=[];const value={get valueOf(){events.push('get');return function(){events.push(this===value);return 7}},toString(){throw 1}};return [new Date(value).getTime(),events];",
  "const events=[];const value={[Symbol.toPrimitive](hint){events.push(hint);return 7}};new Date(value);Date.UTC(value,0);Date.parse(value);return events;",
  "const events=[];function part(id,value){return {valueOf(){events.push(id);return value}}}const time=Date.UTC(part('year',2024),part('month',0),part('day',1),0,0,0,0,part('ignored',1));return [time,events];",
  "const events=[];function part(id,value){return {valueOf(){events.push(id);return value}}}const date=new Date(part('year',2024),part('month',0),part('day',1));return [date.getFullYear(),date.getMonth(),date.getDate(),events];",
  "const error={};const events=[];try{Date.UTC({valueOf(){events.push('year');throw error}},{valueOf(){events.push('month');return 0}})}catch(caught){return [caught===error,events]}",
  "const value=new Date(7);Object.defineProperty(value,Symbol.toPrimitive,{value(){throw 1}});return new Date(value).getTime();",
  "const value=new Date(7);value.valueOf=()=>2024;return Date.UTC(value,0,1);",
  "const value={valueOf(){return {}},toString(){return '1970-01-01T00:00:00.007Z'}};return new Date(value).getTime();",
  "try{new Date({valueOf(){return {}},toString(){return {}}})}catch(error){return error.name}",
  "try{Date.parse(Symbol('date'))}catch(error){return error.name}",
  "try{new Date({[Symbol.toPrimitive](){return BigInt(7)}})}catch(error){return error.name}",
  "try{Date.UTC({valueOf(){return Symbol('year')}})}catch(error){return error.name}",
  "return [Number.isNaN(Date.UTC()),Number.isNaN(new Date(undefined).getTime()),Date.UTC(2024),Number.isNaN(Date.UTC(2024,undefined))];",
  "class Child extends Date {};const value=new Child({valueOf(){return 7}});return [value instanceof Child,value.getTime()];"
])("matches native Date argument coercion: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it.each(["pending", "completed"])("preserves Date argument coercion across %s replay", async mode => {
  const source = "const events=[];const value={valueOf(){events.push('value');return 7}};const date=new Date(value);await 0;return [date.getTime(),events.length];";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: [7, 1] });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: [7, 1] });
  } finally { await completed; }
});

it("keeps budget failures in coercion fatal", async () => {
  await expect(run("try{new Date({valueOf(){while(true){}}})}catch(error){return 'caught'}", { budget: new Budget({ maxSteps: 100 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded" });
});

it("keeps the bounded parsing limit after guest string coercion", async () => {
  expect((await run("try{Date.parse({toString(){return 'x'.repeat(4097)}})}catch(error){return error.name}")).returnValue).toBe("RangeError");
});
