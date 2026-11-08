import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { deepCopyFromSandbox, isSandboxClosure, isSandboxPromise } from "./values.js";

const sequences = [["next", "next", "next"], ["return", "return"], ["next", "return", "next"]];

it("retains queued async generator result prototypes through public replay", async () => {
  const source = `const gate=Promise.withResolvers();const it=(async function*(){await gate.promise;yield 1;return 2})();const pending=[it.next(),it.next(),it.next()];await 0;gate.resolve();const results=await Promise.all(pending);return results.map(result=>[Object.getPrototypeOf(result)===Object.prototype,result.value,result.done])`;
  const expected = await runInNewContext(`(async()=>{${source}})()`);
  const original = await run(source);
  expect(original.ok).toBe(true);
  expect(deepCopyFromSandbox(original.returnValue)).toEqual(expected);
  const replayed = await run(source, { snapshot: JSON.parse(await dump(original)) });
  expect(replayed.ok).toBe(true);
  expect(deepCopyFromSandbox(replayed.returnValue)).toEqual(expected);
});

it("rejects lossy async result copying after its originating prototype changes", async () => {
  const exported = (await run("return [(async function*(){yield 1})(),()=>{Object.prototype.extra=7}]")).returnValue;
  const method = (await run("return (async function*(){})().next")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[1]) || !isSandboxClosure(method)) throw new Error("Expected SDK exports");
  const pending = await method.call([], {stack:[],thisValue:exported[0]});
  if (!isSandboxPromise(pending)) throw new Error("Expected generator promise");
  const result = await pending.promise;
  expect(deepCopyFromSandbox(result)).toEqual({value:1,done:false});
  await exported[1].call([], {stack:[],thisValue:undefined});
  expect(() => deepCopyFromSandbox(result)).toThrow("cannot be copied as data");
});

it("preserves each queued async generator request's result realm", async () => {
  const methodSource = "return [(async function*(){})().next,Object.prototype]";
  const receiverSource = "let release;const gate=new Promise(resolve=>{release=resolve});return [(async function*(){await gate;yield 1;return 2})(),Object.prototype,release]";
  const nativeA = runInNewContext(`(()=>{${methodSource}})()`);
  const nativeB = runInNewContext(`(()=>{${receiverSource}})()`);
  const nativeC = runInNewContext(`(()=>{${methodSource}})()`);
  const nativePending = [nativeA, nativeC, nativeA, nativeC].map(realm => realm[0].call(nativeB[0]));
  nativeB[2]();
  const expected = await Promise.all(nativePending);
  const a = (await run(methodSource)).returnValue;
  const b = (await run(receiverSource)).returnValue;
  const c = (await run(methodSource)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(a) || !Array.isArray(b) || !Array.isArray(c) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const pending = [];
  for (const realm of [a, c, a, c]) {
    if (!isSandboxClosure(realm[0])) throw new Error("Expected generator method");
    const promise = await realm[0].call([], { stack: [], thisValue: b[0] });
    if (!isSandboxPromise(promise)) throw new Error("Expected async generator promise");
    pending.push(promise.promise);
  }
  if (!isSandboxClosure(b[2])) throw new Error("Expected gate resolver");
  await b[2].call([], { stack: [], thisValue: undefined });
  const results = await Promise.all(pending);
  for (const [index, result] of results.entries()) {
    const nativePrototype = Object.getPrototypeOf(expected[index]);
    const realmIndex = [nativeA[1], nativeB[1], nativeC[1]].indexOf(nativePrototype);
    expect(realmIndex).toBeGreaterThanOrEqual(0);
    const prototype = [a[1], b[1], c[1]][realmIndex];
    expect.soft(await getter.call([result], { stack: [], thisValue: undefined }) === prototype, `request ${index} result realm`).toBe(true);
    expect.soft(deepCopyFromSandbox(result)).toEqual(expected[index]);
  }
});

it.each([false, true].flatMap(async => sequences.map(operations => ({ async, operations }))))(
  "preserves generator result realms: async=$async $operations", async ({ async, operations }) => {
    const expression = `(${async ? "async " : ""}function*(){yield 1;return 2})()`;
    const methodSource = `const it=${expression};return [it.next,it.return,Object.prototype]`;
    const receiverSource = `return [${expression},Object.prototype]`;
    const nativeMethods = runInNewContext(`(()=>{${methodSource}})()`);
    const nativeReceiver = runInNewContext(`(()=>{${receiverSource}})()`);
    const methods = (await run(methodSource)).returnValue;
    const receiver = (await run(receiverSource)).returnValue;
    const getter = (await run("return Object.getPrototypeOf")).returnValue;
    if (!Array.isArray(methods) || !isSandboxClosure(methods[0]) || !isSandboxClosure(methods[1]) || !Array.isArray(receiver) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
    const context = { stack: [], thisValue: undefined };
    for (const operation of operations) {
      const index = operation === "next" ? 0 : 1;
      const expected = await nativeMethods[index].call(nativeReceiver[0], 7);
      const nativePrototype = Object.getPrototypeOf(expected);
      expect(nativePrototype === nativeMethods[2] || nativePrototype === nativeReceiver[1]).toBe(true);
      let result = await methods[index].call([7], { ...context, thisValue: receiver[0] });
      if (isSandboxPromise(result)) result = await result.promise;
      const expectedPrototype = nativePrototype === nativeMethods[2] ? methods[2] : receiver[1];
      expect(await getter.call([result], context) === expectedPrototype).toBe(true);
      expect(deepCopyFromSandbox(result)).toEqual(expected);
    }
  }
);
