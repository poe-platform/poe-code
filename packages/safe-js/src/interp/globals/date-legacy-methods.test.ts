import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each([
  "return new Date(0).getYear();",
  "const date=new Date(0);return [date.setYear(99),date.getFullYear()];",
  "return [Date.prototype.toGMTString===Date.prototype.toUTCString,new Date(0).toGMTString()];"
])("supports legacy Date methods: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it.each([
  "return [new Date(NaN).getYear(),new Date(2001,0,1).getYear()];",
  "const date=new Date(NaN);return [date.setYear(99),date.getFullYear()];",
  "const date=new Date(0);return [date.setYear(),date.getTime()];",
  "const date=new Date(0);return [date.setYear(Infinity),date.getTime()];",
  "const date=new Date(0);return [date.setYear(-1),date.getFullYear()];",
  "const date=new Date(0);return [date.setYear(99.5),date.getFullYear()];",
  "const date=new Date(0);const log=[];date.setYear({[Symbol.toPrimitive](hint){log.push(hint);return 99}}, {valueOf(){throw 42}});return [date.getFullYear(),log];",
  "let caught;try{Date.prototype.setYear.call({}, {valueOf(){throw 42}})}catch(error){caught=error instanceof TypeError}return caught;",
  "let caught;try{new Date(0).setYear(Symbol())}catch(error){caught=error instanceof TypeError}return caught;",
  "let caught;try{new Date(0).setYear(BigInt(1))}catch(error){caught=error instanceof TypeError}return caught;",
  "return [Date.prototype.getYear.name,Date.prototype.getYear.length,Date.prototype.setYear.name,Date.prototype.setYear.length,Date.prototype.toGMTString.name,Date.prototype.toGMTString.length];",
  "return Object.getOwnPropertyDescriptor(Date.prototype,'toGMTString').enumerable;",
  "return new Date(NaN).toGMTString();",
  "class Child extends Date{}return [new Child(0).getYear(),new Child(0).toGMTString()];"
])("matches native legacy Date behavior: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it("captures the time before setYear coercion, as required by ECMAScript 2026", async () => {
  const expected = new Date(0);
  expected.setFullYear(2001);
  const source = "const date=new Date(0);date.setYear({valueOf(){date.setTime(86400000);return 2001}});return date.getTime();";
  expect((await run(source)).returnValue).toBe(expected.getTime());
});

it.each(["pending", "completed"])("replays legacy Date operations from a %s checkpoint", async mode => {
  const source = "const date=new Date(0);date.setYear(99);await 0;return [date.getYear(),date.toGMTString(),Date.prototype.toGMTString===Date.prototype.toUTCString];";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    const result = await completed;
    expect(result).toMatchObject({ ok: true });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: result.returnValue });
  } finally { await completed; }
});
