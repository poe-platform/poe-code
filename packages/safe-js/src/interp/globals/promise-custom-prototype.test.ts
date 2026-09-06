import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { createSandboxPromise, deepCopyFromSandbox, reconcileCompiledValues } from "../values.js";
import { Budget } from "../budget.js";
import { setSandboxPrototype } from "../object-model.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";

it("supports custom Promise instance prototypes without losing settlement", async () => {
  expect((await run(`
    const value=Promise.resolve(1), prototype={label:42}, then=Promise.prototype.then;
    Object.setPrototypeOf(value,prototype);
    return Object.getPrototypeOf(value)===prototype && value.label===42 &&
      !(value instanceof Promise) && (await then.call(value,x=>x+1))===2;
  `)).returnValue).toBe(true);
});

it("does not resurrect intrinsic methods after setting a null prototype", async () => {
  expect((await run(`
    const value=Promise.resolve(1);Object.setPrototypeOf(value,null);
    return value.then===undefined && value.catch===undefined && value.constructor===undefined &&
      !(value instanceof Promise) && Object.getPrototypeOf(value)===null;
  `)).returnValue).toBe(true);
});

it("resolves a promise with no then as an ordinary value", async () => {
  expect((await run(`
    const value=Promise.resolve(1);Object.setPrototypeOf(value,null);
    const wrapped=Promise.resolve(value);
    return wrapped!==value && (await wrapped.then(result=>result===value));
  `)).returnValue).toBe(true);
});

it.each(["freeze", "seal", "preventExtensions"])("allows only unchanged prototypes after Object.%s", async method => {
  expect((await run(`
    const value=Promise.resolve(1), prototype={};Object.setPrototypeOf(value,prototype);
    Object.${method}(value);
    if(Object.setPrototypeOf(value,prototype)!==value)return false;
    try{Object.setPrototypeOf(value,null);return false}catch(error){return error instanceof TypeError}
  `)).returnValue).toBe(true);
});

it("rejects cycles through custom prototype objects", async () => {
  expect((await run(`
    const value=Promise.resolve(1), prototype={};Object.setPrototypeOf(value,prototype);
    try{Object.setPrototypeOf(prototype,value);return false}catch(error){return error instanceof TypeError}
  `)).returnValue).toBe(true);
});

it("runs inherited getters and enumerates custom prototype properties", async () => {
  expect((await run(`
    const value=Promise.resolve(1), prototype={get label(){return this===value?42:0}};
    Object.setPrototypeOf(value,prototype);const keys=[];for(const key in value)keys.push(key);
    return value.label===42 && keys.join(",")==="label";
  `)).returnValue).toBe(true);
});

it("allows a promise to be a prototype without granting its internal brand", async () => {
  expect((await run(`
    const prototype=Promise.resolve(1);prototype.label=42;const value=Object.create(prototype);
    if(value.label!==42 || Object.getPrototypeOf(value)!==prototype)return false;
    try{value.then();return false}catch(error){return error instanceof TypeError}
  `)).returnValue).toBe(true);
});

it.each(["pending", "completed"])("preserves custom prototypes across %s replay checkpoints", async mode => {
  const source = `const value=Promise.resolve(1), prototype={label:42}, then=Promise.prototype.then;
    Object.setPrototypeOf(value,prototype);await 0;
    return Object.getPrototypeOf(value)===prototype && value.label===42 &&
      (await then.call(value,x=>x+1))===2`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: true });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: true });
  } finally { await completed; }
});

it("preserves explicit null prototypes when exporting a promise", async () => {
  const result = await run(`const value=Promise.resolve(1);Object.setPrototypeOf(value,null);return {value}`);
  const exported = deepCopyFromSandbox(result.returnValue) as { value: Promise<number> };
  expect(Object.getPrototypeOf(exported.value)).toBeNull();
  expect(await Promise.prototype.then.call(exported.value, (value: number) => value)).toBe(1);
});

it("keeps managed non-null prototype graphs out of the data-only export boundary", async () => {
  const result = await run(`const value=Promise.resolve(1);Object.setPrototypeOf(value,{label:42});return {value}`);
  expect(() => deepCopyFromSandbox(result.returnValue)).toThrow("Guest prototype links");
});

it("does not omit managed promises from forged snapshot roots", async () => {
  const result = await run(`const value=Promise.resolve(1);Object.setPrototypeOf(value,{label:42});return 1`);
  expect(() => serializeSafeJSSnapshot({ ...result.snapshot })).toThrow("prototype links");
});

it("accounts for data retained through a promise prototype", () => {
  const value = createSandboxPromise(Promise.resolve(1));
  setSandboxPrototype(value, { label: "x".repeat(1000) });
  expect(() => reconcileCompiledValues(new Budget({ dataSize: 50 }), [value])).toThrow("budget");
});

it("replays custom prototypes without reissuing completed host effects", async () => {
  const source = `const value=Promise.resolve(1), prototype={label:42};
    Object.setPrototypeOf(value,prototype);await read();
    return Object.getPrototypeOf(value)===prototype && value.label===42`;
  let calls = 0;
  const pending = run(source, { bindings: { read: async () => { calls++; return 1; } } });
  expect(await pending).toMatchObject({ ok: true, returnValue: true });
  const snapshot = restore(JSON.parse(await dump(pending)), { source });
  expect(await run(source, { snapshot, bindings: { read: async () => { calls++; return 1; } } }))
    .toMatchObject({ ok: true, returnValue: true });
  expect(calls).toBe(1);
});
