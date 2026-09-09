import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { isSandboxClosure } from "../values.js";

it.each(["eval", "(0,eval)", "eval?."])(
  "evaluates foreign eval in its owning realm: %s", async invocation => {
    const source = `globalThis.marker="caller";return eval=>{const local=11;return ${invocation}(${JSON.stringify("typeof local+':'+globalThis.marker")})}`;
    const ownerSource = 'globalThis.marker="owner";return eval';
    const nativeCaller = runInNewContext(`(()=>{${source}})()`);
    const nativeEval = runInNewContext(`(()=>{${ownerSource}})()`);
    const expected = nativeCaller(nativeEval);
    expect(expected).toBe("undefined:owner");
    const caller = (await run(source)).returnValue;
    const evaluate = (await run(ownerSource)).returnValue;
    if (!isSandboxClosure(caller) || !isSandboxClosure(evaluate)) throw new Error("Expected eval exports");
    expect(await caller.call([evaluate],{stack:[],thisValue:undefined})).toBe(expected);
  }
);

it("keeps foreign eval writes and declarations in its owner across replay", async () => {
  const code = 'marker="changed";var created=13;[marker,created,typeof local,typeof ownerLocal]';
  const source = `globalThis.marker="caller";await 0;return eval=>{const local=11;return [eval(${JSON.stringify(code)}),globalThis.marker]}`;
  const ownerSource = 'const ownerLocal=19;globalThis.marker="owner";await 0;return [eval,()=>[globalThis.marker,globalThis.created]]';
  const nativeCaller = await runInNewContext(`(async()=>{${source}})()`);
  const nativeOwner = await runInNewContext(`(async()=>{${ownerSource}})()`);
  expect(nativeCaller(nativeOwner[0])).toEqual([["changed",13,"undefined","undefined"],"caller"]);
  expect(nativeOwner[1]()).toEqual(["changed",13]);
  const originalCaller = await run(source);
  const originalOwner = await run(ownerSource);
  expect(originalCaller.ok).toBe(true);
  expect(originalOwner.ok).toBe(true);
  const replayedCaller = await run(source,{snapshot:JSON.parse(await dump(originalCaller))});
  const replayedOwner = await run(ownerSource,{snapshot:JSON.parse(await dump(originalOwner))});
  expect(replayedCaller.ok).toBe(true);
  expect(replayedOwner.ok).toBe(true);
  const context = {stack:[],thisValue:undefined};
  for (const callerResult of [originalCaller,replayedCaller]) {
    const caller = callerResult.returnValue;
    if (!isSandboxClosure(caller)) throw new Error("Expected caller");
    for (const ownerResult of [originalOwner,replayedOwner]) {
      const owner = ownerResult.returnValue;
      if (!Array.isArray(owner) || !isSandboxClosure(owner[1])) throw new Error("Expected owner exports");
      expect(await caller.call([owner[0]],context)).toEqual([["changed",13,"undefined","undefined"],"caller"]);
      expect(await owner[1].call([],context)).toEqual(["changed",13]);
    }
  }
});

it("creates foreign eval errors in the owning realm", async () => {
  const source = `return eval=>{try{eval(${JSON.stringify('throw new TypeError("owner error")')})}catch(error){return error}}`;
  const ownerSource = 'return [eval,TypeError.prototype]';
  const nativeCaller = runInNewContext(`(()=>{${source}})()`);
  const nativeOwner = runInNewContext(`(()=>{${ownerSource}})()`);
  expect(Object.getPrototypeOf(nativeCaller(nativeOwner[0]))).toBe(nativeOwner[1]);
  const caller = (await run(source)).returnValue;
  const owner = (await run(ownerSource)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!isSandboxClosure(caller) || !Array.isArray(owner) || !isSandboxClosure(getter)) throw new Error("Expected exports");
  const context = {stack:[],thisValue:undefined};
  const error = await caller.call([owner[0]],context);
  expect(await getter.call([error],context)).toBe(owner[1]);
});
