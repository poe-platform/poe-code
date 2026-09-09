import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { Budget } from "../budget.js";
import { isSandboxClosure } from "../values.js";
import { createAtomicsGlobal } from "./atomics.js";

it.each(["add", "sub", "and", "or", "xor", "exchange", "compareExchange", "load", "store"] as const)(
  "implements standalone Atomics.%s integer updates", async name => {
    const namespace = createAtomicsGlobal(new Budget());
    const method = namespace[name];
    if (!isSandboxClosure(method)) throw new Error("Missing atomic intrinsic");
    const view = new Int32Array([5]);
    const native = new Int32Array([5]);
    const args = name === "compareExchange" ? [5, 7] : [7];
    const expected = Reflect.apply(Atomics[name], Atomics, [native, 0, ...args]);
    expect(await method.call([view, 0, ...args])).toBe(expected);
    expect(view[0]).toBe(native[0]);
  }
);

it.each([
  ['return [new Int32Array([5]),{valueOf(){return 0}},{valueOf(){return 7}}]', 5, 12],
  ['return [new BigInt64Array([5n]),0,{valueOf(){return 7n}}]', 5n, 12n]
] as const)("handles standalone guest coercions: %s", async (source, previous, next) => {
  const result = await run(source);
  expect(result.ok).toBe(true);
  if (!Array.isArray(result.returnValue)) throw new Error("Expected arguments");
  const add = createAtomicsGlobal(new Budget()).add;
  if (!isSandboxClosure(add)) throw new Error("Missing atomic intrinsic");
  expect(await add.call(result.returnValue)).toBe(previous);
  const view = result.returnValue[0] as Int32Array | BigInt64Array;
  expect(view[0]).toBe(next);
});

it("preserves standalone Atomics namespace descriptors", () => {
  const namespace = createAtomicsGlobal(new Budget());
  expect(Object.keys(namespace)).toEqual([]);
  expect(Object.getOwnPropertyDescriptor(namespace, Symbol.toStringTag)).toEqual({
    value: "Atomics", writable: false, enumerable: false, configurable: true
  });
  for (const name of Object.getOwnPropertyNames(Atomics)) {
    const descriptor = Object.getOwnPropertyDescriptor(namespace, name);
    expect(descriptor).toMatchObject({writable:true,enumerable:false,configurable:true});
    if (!isSandboxClosure(descriptor?.value)) throw new Error("Missing atomic intrinsic");
    expect(descriptor.value.name).toBe(name);
    expect(descriptor.value.length).toBe(Reflect.get(Atomics,name).length);
    expect(descriptor.value.construct).toBeUndefined();
  }
});

it.each([
  ["add","7"],["sub","7"],["and","3"],["or","2"],["xor","3"],
  ["exchange","7"],["compareExchange","5,7"],["load",""],["store","7"]
])("supports Atomics.%s on ordinary integer storage", async (method,args) => {
  const source = `const view=new Int32Array([5]);const result=Atomics.${method}(view,0${args ? ','+args : ''});return [result,view[0]]`;
  const expected = runInNewContext(`(()=>{${source}})()`);
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

it.each(["Int8Array","Uint8Array","Int16Array","Uint16Array","Int32Array","Uint32Array","BigInt64Array","BigUint64Array"])(
  "supports atomic integer updates through %s", async name => {
    const big = name.startsWith("Big");
    const source = `const view=new ${name}([${big ? '5n' : '5'}]);const previous=Atomics.add(view,0,${big ? '7n' : '7'});return [String(previous),String(view[0])]`;
    expect(runInNewContext(`(()=>{${source}})()`)).toEqual(["5","12"]);
    expect(await run(source)).toMatchObject({ok:true,returnValue:["5","12"]});
  }
);

it.each(["Float32Array","Float64Array","Uint8ClampedArray"])("rejects non-atomic %s before index coercion", async name => {
  const source = `let calls=0;try{Atomics.load(new ${name}(1),{valueOf(){calls++;return 0}})}catch(error){return [error.name,calls]}`;
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(["TypeError",0]);
  expect(await run(source)).toMatchObject({ok:true,returnValue:["TypeError",0]});
});

it("coerces atomic indices before update values", async () => {
  const source = 'const calls=[];const view=new Int32Array([5]);const previous=Atomics.add(view,{valueOf(){calls.push("index");return 0}},{valueOf(){calls.push("value");return 7}});return [calls,previous,view[0]]';
  const expected = runInNewContext(`(()=>{${source}})()`);
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

it.each(["wait","waitAsync"])("rejects Atomics.%s on non-shared storage", async method => {
  const source = `try{Atomics.${method}(new Int32Array(1),0,0,0)}catch(error){return error.name}`;
  expect(runInNewContext(`(()=>{${source}})()`)).toBe("TypeError");
  expect(await run(source)).toMatchObject({ok:true,returnValue:"TypeError"});
});

it("notifies no waiters on non-shared storage", async () => {
  const source = 'return Atomics.notify(new Int32Array(1),0)';
  expect(runInNewContext(`(()=>{${source}})()`)).toBe(0);
  expect(await run(source)).toMatchObject({ok:true,returnValue:0});
});

it("reports lock-free sizes consistently with its native host", async () => {
  const source = 'return [0,1,2,3,4,8,16].map(size=>Atomics.isLockFree(size))';
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(()=>{${source}})()`)});
});

it("restores atomic method identity and aliased integer storage", async () => {
  const source = `const add=Atomics.add;const namespace=Atomics;
    const view=new Int32Array([5]);const alias=new Int32Array(view.buffer);
    globalThis.Atomics=undefined;await 0;
    return [add===namespace.add,add(view,0,7),alias[0]]`;
  const original = await run(source);
  expect(original).toMatchObject({ok:true,returnValue:[true,5,12]});
  expect(await run(source,{snapshot:JSON.parse(await dump(original))}))
    .toMatchObject({ok:true,returnValue:[true,5,12]});
});

it("creates foreign atomic validation errors in the intrinsic owner realm", async () => {
  const callerSource = 'return load=>{try{load(new Float64Array(1),0)}catch(error){return Object.getPrototypeOf(error)}}';
  const ownerSource = 'return [Atomics.load,TypeError.prototype]';
  const nativeCaller = runInNewContext(`(()=>{${callerSource}})()`);
  const nativeOwner = runInNewContext(`(()=>{${ownerSource}})()`);
  expect(nativeCaller(nativeOwner[0])).toBe(nativeOwner[1]);
  const caller = (await run(callerSource)).returnValue;
  const owner = (await run(ownerSource)).returnValue;
  if (!isSandboxClosure(caller) || !Array.isArray(owner)) throw new Error("Expected exports");
  expect(await caller.call([owner[0]],{stack:[],thisValue:undefined}) === owner[1]).toBe(true);
});

it.each([
  ["invalid index suppresses value coercion", `
    const calls=[];const view=new Int32Array(1);
    try { Atomics.add(view,2,{valueOf(){calls.push("value");return 1}}) }
    catch(error){return [error.name,calls]}
  `],
  ["compareExchange coerces expected before replacement", `
    const calls=[];const view=new Int32Array([5]);
    const previous=Atomics.compareExchange(view,0,
      {valueOf(){calls.push("expected");return 4}},
      {valueOf(){calls.push("replacement");return 9}});
    return [calls,previous,view[0]];
  `],
  ["value coercion can detach the backing buffer", `
    const buffer=new ArrayBuffer(4);const view=new Int32Array(buffer);
    try { Atomics.store(view,0,{valueOf(){buffer.transfer();return 7}}) }
    catch(error){return [error.name,buffer.byteLength]}
  `],
  ["BigInt views reject Number update values", `
    const view=new BigInt64Array([5n]);
    try { Atomics.add(view,0,7) }
    catch(error){return [error.name,String(view[0])]}
  `],
  ["Number views reject BigInt update values", `
    const view=new Int32Array([5]);
    try { Atomics.add(view,0,7n) }
    catch(error){return [error.name,view[0]]}
  `]
])("matches native Atomics when %s", async (_name, source) => {
  const expected = runInNewContext(`(()=>{${source}})()`);
  expect(expected).not.toBeUndefined();
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

it("revalidates an atomic byte index after shrinking length-tracking storage", async () => {
  // ECMA-262 RevalidateAtomicAccess step 5 requires RangeError here: the
  // length-tracking view at offset zero remains in bounds, but byte index 4
  // exceeds the resized buffer. Node 22 instead reports TypeError.
  const source = `const buffer=new ArrayBuffer(8,{maxByteLength:16});
    const view=new Int32Array(buffer);const calls=[];
    try { Atomics.add(view,{valueOf(){buffer.resize(0);return 1}},
      {valueOf(){calls.push("value");return 1}}) }
    catch(error){return [error.name,calls,buffer.byteLength]}`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:["RangeError",["value"],0]});
});
