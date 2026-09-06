import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { cloneSandboxValue, deepCopyFromSandbox, reconcileCompiledValues } from "../values.js";
import { getSandboxPrototype, setSandboxPrototype } from "../object-model.js";
import { decodeReplayData, encodeReplayData } from "../../snapshot/replay-data.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";
import { createSandboxDate } from "../date.js";
import { Budget } from "../budget.js";

it("preserves Date subclass prototype identity and internal date state", async () => {
  const result = await run(`class Child extends Date {};const value=new Child(0);
    return value instanceof Child && Object.getPrototypeOf(value)===Child.prototype && value.getTime()===0;`);
  expect(result.returnValue).toBe(true);
});

it.each([
  "return Object.getPrototypeOf(Date.prototype)===Object.prototype;",
  "return Object.hasOwn(Date.prototype,'getTime');",
  "const value=Object.create(Date.prototype);return [value instanceof Date,typeof value.getTime];",
  "const prototype=new Date(7);const value=Object.create(prototype);value.label=9;return [Object.getPrototypeOf(value)===prototype,value instanceof Date,value.label];",
  "const value=Object.create(Date.prototype);try{value.getTime()}catch(error){return error.name}",
  "const value=new Date(7);Object.setPrototypeOf(value,null);return [Object.getPrototypeOf(value)===null,value instanceof Date,typeof value.getTime,Date.prototype.getTime.call(value)];",
  "Date.prototype.getTime=function(){return 42};return new Date(0).getTime();",
  "delete Date.prototype.getTime;return typeof new Date(0).getTime;",
  "class Child extends Date { label=42; get answer(){return super.getTime()+this.label} };class Grandchild extends Child {};const value=new Grandchild(7);return [value.answer,value instanceof Grandchild,value instanceof Child,value instanceof Date];",
  "const value=new Date(7);Object.freeze(value);Object.setPrototypeOf(value,Date.prototype);try{Object.setPrototypeOf(value,{})}catch(error){return error.name}",
  "const value=new Date(7);try{Object.setPrototypeOf(Date.prototype,value)}catch(error){return error.name}",
  "Object.defineProperty(Date.prototype,'answer',{get(){return this.getTime()+1}});Date.prototype.empty=undefined;const value=new Date(7);return [value.answer,'empty' in value,Object.keys(Date.prototype)];",
  "Date.prototype.valueOf=function(){return 42};return +new Date(7);",
  "return [Object.getOwnPropertyDescriptor(Date,'prototype').writable,Object.getOwnPropertyDescriptor(Date.prototype,'getTime').enumerable,Object.getOwnPropertyDescriptor(Date.prototype,Symbol.toPrimitive).writable];"
])("matches the native Date prototype graph: %s", async source => {
  const expected = runInNewContext("(function(){'use strict';" + source + "})()");
  expect((await run(source)).returnValue).toEqual(expected);
});

it.each(["pending", "completed"])("preserves Date subclasses across %s replay", async mode => {
  const source = "class Child extends Date { label=42; };const value=new Child(7);await 0;return value instanceof Child && value.getTime()===7 && value.label===42;";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: true });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: true });
  } finally { await completed; }
});

it("preserves null Date prototypes across data boundaries", async () => {
  const { returnValue: value } = await run("const value=new Date(7);Object.setPrototypeOf(value,null);Object.freeze(value);return value;");
  const copied = deepCopyFromSandbox(value);
  expect(Object.getPrototypeOf(copied)).toBeNull();
  for (const result of [cloneSandboxValue(value), decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(value))))]) {
    expect(getSandboxPrototype(result as object)).toBeNull();
    expect(Object.getPrototypeOf(deepCopyFromSandbox(result))).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Date.prototype.getTime.call(result)).toBe(7);
  }
});

it("rejects non-null custom Date prototypes at data-only copy boundaries", async () => {
  const { returnValue: value } = await run("class Child extends Date {};return new Child(7);");
  expect(() => deepCopyFromSandbox(value)).toThrow("prototype links");
  expect(() => cloneSandboxValue(value)).toThrow("prototype links");
});

it("rejects managed Date state in copied snapshot roots", async () => {
  const result = await run("class Child extends Date {};const value=new Child(7);return 1;");
  expect(() => serializeSafeJSSnapshot({ ...result.snapshot })).toThrow("prototype links");
});

it("accounts for data retained through Date prototype links", () => {
  const value = createSandboxDate(7);
  setSandboxPrototype(value, { label: "x".repeat(1000) });
  expect(() => reconcileCompiledValues(new Budget({ dataSize: 50 }), [value])).toThrow("budget");
});

it("does not repeat completed host effects when replaying Date subclasses", async () => {
  const source = "class Child extends Date {};const value=new Child(7);await read();return value instanceof Child && value.getTime()===7;";
  let calls = 0;
  const bindings = { read: async () => { calls++; return 1; } };
  const pending = run(source, { bindings });
  expect(await pending).toMatchObject({ ok: true, returnValue: true });
  const snapshot = restore(JSON.parse(await dump(pending)), { source });
  expect(await run(source, { bindings, snapshot })).toMatchObject({ ok: true, returnValue: true });
  expect(calls).toBe(1);
});
