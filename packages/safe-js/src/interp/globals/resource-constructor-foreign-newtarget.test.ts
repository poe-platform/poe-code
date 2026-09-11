import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { isSandboxClosure, isSandboxPromise } from "../values.js";

// DisposableStack and AsyncDisposableStack are not available in this host VM.
// Their expected defaults follow OrdinaryCreateFromConstructor in ECMA-262:
// https://tc39.es/ecma262/multipage/control-abstraction-objects.html
it.each(["Iterator","DisposableStack","AsyncDisposableStack"]
  .flatMap(name=>["7","null","({custom:true})"].map(prototype=>({name,prototype}))))(
  "uses foreign $name newTarget defaults: $prototype", async ({name,prototype}) => {
    const source = `return [Reflect.construct,${name},Object.getPrototypeOf]`;
    const targetSource = `function Target(){}Target.prototype=${prototype};return [Target,${name}.prototype,Target.prototype]`;
    const expectedIndex = prototype === "({custom:true})" ? 2 : 1;
    if (name === "Iterator") {
      const nativeA = runInNewContext(`(()=>{${source}})()`);
      const nativeB = runInNewContext(`(()=>{${targetSource}})()`);
      expect(Object.getPrototypeOf(nativeA[0](nativeA[1],[],nativeB[0]))).toBe(nativeB[expectedIndex]);
    }
    const a = (await run(source)).returnValue;
    const b = (await run(targetSource)).returnValue;
    if (!Array.isArray(a) || !Array.isArray(b) || !isSandboxClosure(a[0]) || !isSandboxClosure(a[2])) throw new Error("Expected constructors");
    const context = {stack:[],thisValue:undefined};
    const instance = await a[0].call([a[1],[],b[0]],context);
    expect(await a[2].call([instance],context) === b[expectedIndex]).toBe(true);
  }
);

it.each(["Iterator","DisposableStack","AsyncDisposableStack"]
  .flatMap(name=>["const Target=(class {}).bind(null);","const Target=new Proxy(function(){},{});"].map(target=>({name,target}))))(
  "retains $name defaults for wrapped targets through replay: $target", async ({name,target}) => {
    const source = `${target}Target.prototype=null;const prototype=${name}.prototype;globalThis.${name}=undefined;await 0;return [Target,prototype]`;
    const original = await run(source);
    expect(original.ok).toBe(true);
    const replayed = await run(source,{snapshot:JSON.parse(await dump(original))});
    expect(replayed.ok).toBe(true);
    const a = (await run(`return [Reflect.construct,${name},Object.getPrototypeOf]`)).returnValue;
    if (!Array.isArray(a) || !isSandboxClosure(a[0]) || !isSandboxClosure(a[2])) throw new Error("Expected constructors");
    const context = {stack:[],thisValue:undefined};
    for (const result of [original,replayed]) {
      const b = result.returnValue;
      if (!Array.isArray(b)) throw new Error("Expected target exports");
      const instance = await a[0].call([a[1],[],b[0]],context);
      expect(await a[2].call([instance],context) === b[1]).toBe(true);
    }
  }
);

it.each(["Iterator","DisposableStack","AsyncDisposableStack"])("rejects revoked $name target during default lookup", async name => {
  const source = `const target=Proxy.revocable(function(){},{get(t,k){if(k==="prototype"){target.revoke();return null}return Reflect.get(t,k)}});try{Reflect.construct(${name},[],target.proxy)}catch(error){return error instanceof TypeError}`;
  if (name === "Iterator") expect(runInNewContext(`(()=>{${source}})()`)).toBe(true);
  expect(await run(source)).toMatchObject({ok:true,returnValue:true});
});

it.each(["DisposableStack","AsyncDisposableStack"])("initializes foreign %s instances for disposal", async name => {
  const a = (await run(`return [Reflect.construct,${name}]`)).returnValue;
  const b = (await run(`function Target(){}Target.prototype=null;return [Target,async stack=>{const calls=[];stack.defer(()=>{calls.push(1)});stack.defer(()=>{calls.push(2)});await stack.${name === "DisposableStack" ? "dispose" : "disposeAsync"}();return [stack.disposed,...calls]}]`)).returnValue;
  if (!Array.isArray(a) || !Array.isArray(b) || !isSandboxClosure(a[0]) || !isSandboxClosure(b[1])) throw new Error("Expected constructors");
  const context = {stack:[],thisValue:undefined};
  const instance = await a[0].call([a[1],[],b[0]],context);
  const result = await b[1].call([instance],context);
  if (!isSandboxPromise(result)) throw new Error("Expected async disposal result");
  expect(await result.promise).toEqual([true,2,1]);
});
