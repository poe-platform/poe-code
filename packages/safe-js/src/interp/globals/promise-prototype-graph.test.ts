import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it("links Promise instances to Promise.prototype", async () => {
  expect((await run(`return Object.getPrototypeOf(Promise.resolve(1))===Promise.prototype`)).returnValue).toBe(true);
});

it("includes inherited enumerable properties without exposing them as own", async () => {
  expect((await run(`
    Promise.prototype.label=42;const value=Promise.resolve(1), keys=[];
    for(const key in value)keys.push(key);
    return value.label===42 && "label" in value && !Object.hasOwn(value,"label") && keys.join(",")==="label";
  `)).returnValue).toBe(true);
});

it("invokes inherited accessors with the promise receiver", async () => {
  expect((await run(`
    const value=Promise.resolve(1);let receiver;
    Object.defineProperty(Promise.prototype,"label",{
      get(){return this===value?42:0},set(input){receiver=this;this.saved=input},enumerable:true
    });
    value.label=7;
    return value.label===42 && receiver===value && value.saved===7;
  `)).returnValue).toBe(true);
});

it("uses prototype ancestry for instanceof without granting the promise brand", async () => {
  expect((await run(`
    const value=Object.create(Promise.prototype);
    if(!(value instanceof Promise))return false;
    try{value.then();return false}catch(error){return error instanceof TypeError}
  `)).returnValue).toBe(true);
});

it("inherits Object.prototype through the Promise prototype", async () => {
  expect((await run(`
    const value=Promise.resolve(1);
    return Object.getPrototypeOf(Promise.prototype)===Object.prototype &&
      Object.prototype.isPrototypeOf(value) && Promise.prototype.isPrototypeOf(value);
  `)).returnValue).toBe(true);
});

it("exposes the Promise string tag", async () => {
  expect((await run(`return Object.prototype.toString.call(Promise.resolve(1))`)).returnValue).toBe("[object Promise]");
});

it.each(["pending", "completed"])("preserves prototype inheritance across %s replay checkpoints", async mode => {
  const source = `Promise.prototype.label=42;const value=Promise.resolve(1);await 0;
    const keys=[];for(const key in value)keys.push(key);
    return Object.getPrototypeOf(value)===Promise.prototype && value.label===42 && keys.join(",")==="label" && (await value)===1`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: true });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: true });
  } finally { await completed; }
});

it("uses the original own then even when the prototype method is replaced", async () => {
  expect((await run(`
    const value=Promise.resolve(42), original=Promise.prototype.then;
    value.then=original;Promise.prototype.then=()=>{throw new Error("wrong method")};
    const wrapped=new Promise(resolve=>resolve(value));
    Promise.prototype.then=original;
    return await wrapped;
  `)).returnValue).toBe(42);
});
