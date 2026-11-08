import { expect, it } from "vitest";
import { run } from "../../run.js";
import { cloneSandboxValue, deepCopyFromSandbox } from "../values.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each([
  "const date=new Date(7);date.label=42;const copy=structuredClone(date);return [copy.getTime(),Object.keys(copy)];",
  "const date=new Date(7);date.callback=()=>1;return structuredClone(date).getTime();",
  "const date=new Date(7);let reads=0;Object.defineProperty(date,'label',{enumerable:true,get(){reads++;throw 1}});const copy=structuredClone(date);return [copy.getTime(),reads];",
  "class Child extends Date{};const date=new Child(7);const copy=structuredClone(date);return [copy.getTime(),copy instanceof Date,copy instanceof Child,Object.getPrototypeOf(copy)===Date.prototype];",
  "const date=new Date(NaN);date.self=date;date[Symbol('key')]=42;Object.freeze(date);const copy=structuredClone(date);return [Number.isNaN(copy.getTime()),Object.isExtensible(copy),Object.getOwnPropertyNames(copy),Object.getOwnPropertySymbols(copy).length];",
  "const date=new Date(7);Object.setPrototypeOf(date,null);const copy=structuredClone(date);return [copy.getTime(),Object.getPrototypeOf(copy)===Date.prototype];",
  "const date=new Date(7);Object.setPrototypeOf(date,{get label(){throw 1}});return structuredClone(date).getTime();",
  "const date=new Date(7);date.callback=()=>1;const copy=structuredClone([date,date,new Map([[date,date]]),new Set([date])]);return [copy[0]!==date,copy[0]===copy[1],copy[2].get(copy[0])===copy[0],copy[3].has(copy[0])];",
  "const date=new Date(7);date.toJSON=()=>{throw 1};date.valueOf=()=>{throw 1};return structuredClone(date).getTime();"
])("matches native Date structured cloning: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it("does not change ordinary Date copy semantics", async () => {
  const { returnValue: value } = await run("const date=new Date(7);date.label=42;Object.freeze(date);return date;");
  const copy = deepCopyFromSandbox(cloneSandboxValue(value)) as Date & { label: number };
  expect(copy.label).toBe(42);
  expect(Object.isFrozen(copy)).toBe(true);
  expect(copy.getTime()).toBe(7);
});

it("still rejects Date accessors and managed prototypes in ordinary copies", async () => {
  const accessor = (await run("const date=new Date(7);Object.defineProperty(date,'label',{get(){throw 1}});return date;")).returnValue;
  const subclass = (await run("class Child extends Date{};return new Child(7);")).returnValue;
  expect(() => cloneSandboxValue(accessor)).toThrow("accessor properties");
  expect(() => deepCopyFromSandbox(accessor)).toThrow("accessor properties");
  expect(() => cloneSandboxValue(subclass)).toThrow("prototype links");
  expect(() => deepCopyFromSandbox(subclass)).toThrow("prototype links");
});

it.each(["pending", "completed"])("preserves Date structured clones across %s replay", async mode => {
  const source = "class Child extends Date{};const date=new Child(7);date.callback=()=>1;const copies=structuredClone([date,date]);await 0;return copies[0]===copies[1] && copies[0].getTime()===7 && !(copies[0] instanceof Child);";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: true });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: true });
  } finally { await completed; }
});
