import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dateMethods } from "../date.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each([
  "try{return Date.prototype.getTime()}catch(error){return error.name}",
  "try{return new Date(Date.prototype).getTime()}catch(error){return error.name}",
  "try{return Date.prototype.toJSON()}catch(error){return error.name}",
  "const copy=structuredClone(Date.prototype);return [copy instanceof Date,Object.getOwnPropertyNames(copy)];",
  "return [Object.prototype.toString.call(Date.prototype),Date.prototype instanceof Date,Object.getPrototypeOf(Date.prototype)===Object.prototype];",
  "let calls=0;try{Date.prototype.setTime({valueOf(){calls++;return 7}})}catch(error){return [error.name,calls]}",
  "return [Date.prototype.getTime.call(new Date(7)),new Date(7) instanceof Date];"
])("matches the native ordinary Date prototype: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it.each([...dateMethods.keys()].filter(name => name !== "toJSON"))("requires a real Date receiver for %s", async method => {
  const source = `if(typeof Date.prototype.${method}!=='function')return 'missing';try{Date.prototype.${method}()}catch(error){return error.name}`;
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it.each(["pending", "completed"])("preserves Date prototype behavior across %s replay", async mode => {
  const source = "class Child extends Date{};const date=new Child(7);await 0;try{Date.prototype.getTime()}catch(error){return error instanceof TypeError && date instanceof Child && date.getTime()===7}";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: true });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: true });
  } finally { await completed; }
});
