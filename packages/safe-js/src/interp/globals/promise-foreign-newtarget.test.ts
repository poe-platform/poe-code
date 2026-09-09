import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { isSandboxClosure, isSandboxPromise } from "../values.js";

it.each(["7","null","({custom:true})"])("uses foreign Promise newTarget defaults: %s", async prototype => {
  const source = 'return [Reflect.construct,Promise,resolve=>resolve(7),Object.getPrototypeOf]';
  const targetSource = `function Target(){}Target.prototype=${prototype};return [Target,Promise.prototype,Target.prototype]`;
  const nativeA = runInNewContext(`(()=>{${source}})()`);
  const nativeB = runInNewContext(`(()=>{${targetSource}})()`);
  const nativePromise = nativeA[0](nativeA[1],[nativeA[2]],nativeB[0]);
  const expectedIndex = prototype === "({custom:true})" ? 2 : 1;
  expect(Object.getPrototypeOf(nativePromise)).toBe(nativeB[expectedIndex]);
  const a = (await run(source)).returnValue;
  const b = (await run(targetSource)).returnValue;
  if (!Array.isArray(a) || !Array.isArray(b) || !isSandboxClosure(a[0]) || !isSandboxClosure(a[3])) throw new Error("Expected constructors");
  const context = {stack:[],thisValue:undefined};
  const promise = await a[0].call([a[1],[a[2]],b[0]],context);
  if (!isSandboxPromise(promise)) throw new Error("Expected Promise");
  expect(await promise.promise).toBe(7);
  expect(await a[3].call([promise],context)).toBe(b[expectedIndex]);
});

it.each(["function Target(){}", "const Target=(class {}).bind(null);", "const Target=new Proxy(function(){},{});"])(
  "keeps foreign Promise defaults through replay: %s", async target => {
    const source = `${target}Target.prototype=7;const prototype=Promise.prototype;globalThis.Promise=undefined;await 0;return [Target,prototype]`;
    const original = await run(source);
    expect(original.ok).toBe(true);
    const replayed = await run(source,{snapshot:JSON.parse(await dump(original))});
    expect(replayed.ok).toBe(true);
    const a = (await run('return [Reflect.construct,Promise,resolve=>resolve(7),Object.getPrototypeOf]')).returnValue;
    if (!Array.isArray(a) || !isSandboxClosure(a[0]) || !isSandboxClosure(a[3])) throw new Error("Expected constructors");
    const context = {stack:[],thisValue:undefined};
    for (const result of [original,replayed]) {
      const values = result.returnValue;
      if (!Array.isArray(values)) throw new Error("Expected target exports");
      const promise = await a[0].call([a[1],[a[2]],values[0]],context);
      if (!isSandboxPromise(promise)) throw new Error("Expected Promise");
      expect(await promise.promise).toBe(7);
      expect(await a[3].call([promise],context)).toBe(values[1]);
    }
  }
);

it("rejects revocation during prototype lookup before running the executor", async () => {
  const source = 'const calls=[];return [Reflect.construct,Promise,resolve=>{calls.push(1);resolve(7)},calls]';
  const targetSource = 'const r=Proxy.revocable(function(){},{get(t,k){if(k==="prototype"){r.revoke();return 7}return Reflect.get(t,k)}});return r.proxy';
  const nativeA = runInNewContext(`(()=>{${source}})()`);
  const nativeTarget = runInNewContext(`(()=>{${targetSource}})()`);
  expect(()=>nativeA[0](nativeA[1],[nativeA[2]],nativeTarget)).toThrow("revoked");
  expect(nativeA[3]).toEqual([]);
  const a = (await run(source)).returnValue;
  const target = (await run(targetSource)).returnValue;
  if (!Array.isArray(a) || !isSandboxClosure(a[0])) throw new Error("Expected constructors");
  await expect(a[0].call([a[1],[a[2]],target],{stack:[],thisValue:undefined})).rejects.toThrow("revoked proxy");
  expect(a[3]).toEqual([]);
});

it.each(["null","()=>{}","async function(){}"])("rejects an invalid newTarget before the executor: %s", async target => {
  const source = `let calls=0;try{Reflect.construct(Promise,[()=>{calls++}],${target})}catch(error){return [error instanceof TypeError,calls]}`;
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual([true,0]);
  expect(await run(source)).toMatchObject({ok:true,returnValue:[true,0]});
});

it("validates the executor before reading newTarget.prototype", async () => {
  const source = 'let calls=0;const target=new Proxy(function(){},{get(){calls++;throw Error("prototype read")}});try{Reflect.construct(Promise,[7],target)}catch(error){return [error instanceof TypeError,calls]}';
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual([true,0]);
  expect(await run(source)).toMatchObject({ok:true,returnValue:[true,0]});
});
