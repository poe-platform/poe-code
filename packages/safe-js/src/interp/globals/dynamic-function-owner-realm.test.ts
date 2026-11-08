import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { isSandboxClosure, isSandboxPromise } from "../values.js";

it("constructs a borrowed dynamic function using its owner's globals", async () => {
  const source = 'globalThis.marker="caller";return Constructor=>new (Constructor("this.marker=marker"))().marker';
  const ownerSource = 'globalThis.marker="owner";return Function';
  const nativeCaller = runInNewContext(`(()=>{${source}})()`);
  const nativeOwner = runInNewContext(`(()=>{${ownerSource}})()`);
  expect(nativeCaller(nativeOwner)).toBe("owner");
  const caller = (await run(source)).returnValue;
  const owner = (await run(ownerSource)).returnValue;
  if (!isSandboxClosure(caller) || !isSandboxClosure(owner)) throw new Error("Expected constructors");
  expect(await caller.call([owner],{stack:[],thisValue:undefined})).toBe("owner");
});

it.each([
  {constructor:"Function",body:"return marker",invoke:"await fn()"},
  {constructor:"(async function(){}).constructor",body:"return marker",invoke:"await fn()"},
  {constructor:"(function*(){}).constructor",body:"yield marker",invoke:"(await fn().next()).value"},
  {constructor:"(async function*(){}).constructor",body:"yield marker",invoke:"(await fn().next()).value"}
])("compiles borrowed $constructor bodies in the constructor owner realm", async ({constructor,body,invoke}) => {
  const source = `globalThis.marker="caller";return async Constructor=>{const fn=Constructor(${JSON.stringify(body)});return ${invoke}}`;
  const ownerSource = `globalThis.marker="owner";return ${constructor}`;
  const nativeCaller = runInNewContext(`(()=>{${source}})()`);
  const nativeConstructor = runInNewContext(`(()=>{${ownerSource}})()`);
  expect(await nativeCaller(nativeConstructor)).toBe("owner");
  const caller = (await run(source)).returnValue;
  const owner = (await run(ownerSource)).returnValue;
  if (!isSandboxClosure(caller) || !isSandboxClosure(owner)) throw new Error("Expected exported functions");
  const result = await caller.call([owner],{stack:[],thisValue:undefined});
  if (!isSandboxPromise(result)) throw new Error("Expected async caller result");
  expect(await result.promise).toBe("owner");
});

it.each(["Constructor", "Constructor.bind(null)", "new Proxy(Constructor,{})"])("retains borrowed %s owner globals through replay", async target => {
  const source = `globalThis.marker="caller";await 0;return async Constructor=>{const local=7;const fn=Reflect.construct(${target},["marker='changed';return [typeof local,typeof ownerLocal,marker]"]);return [fn(),marker]}`;
  const ownerSource = 'const ownerLocal=11;globalThis.marker="owner";const constructor=Function;globalThis.Function=undefined;await 0;return [constructor,()=>marker]';
  const nativeCaller = await runInNewContext(`(async()=>{${source}})()`);
  const nativeOwner = await runInNewContext(`(async()=>{${ownerSource}})()`);
  expect(await nativeCaller(nativeOwner[0])).toEqual([["undefined","undefined","changed"],"caller"]);
  expect(nativeOwner[1]()).toBe("changed");
  const originalCaller = await run(source);
  const originalOwner = await run(ownerSource);
  expect(originalCaller.ok).toBe(true);
  expect(originalOwner.ok).toBe(true);
  const replayedCaller = await run(source,{snapshot:JSON.parse(await dump(originalCaller))});
  const replayedOwner = await run(ownerSource,{snapshot:JSON.parse(await dump(originalOwner))});
  expect(replayedCaller.ok).toBe(true);
  expect(replayedOwner.ok).toBe(true);
  for (const callerResult of [originalCaller,replayedCaller]) {
    for (const ownerResult of [originalOwner,replayedOwner]) {
      const caller = callerResult.returnValue;
      const owner = ownerResult.returnValue;
      if (!isSandboxClosure(caller) || !Array.isArray(owner) || !isSandboxClosure(owner[1])) throw new Error("Expected exports");
      const context = {stack:[],thisValue:undefined};
      const result = await caller.call([owner[0]],context);
      if (!isSandboxPromise(result)) throw new Error("Expected async result");
      expect(await result.promise).toEqual([["undefined","undefined","changed"],"caller"]);
      expect(await owner[1].call([],context)).toBe("changed");
    }
  }
});
