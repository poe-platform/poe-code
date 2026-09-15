import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each(["Uint8Array", "Float16Array", "BigInt64Array"])("refuses integrity changes on resizable %s views without mutation", async name => {
  const source = `const results=[]; const b=new ArrayBuffer(16,{maxByteLength:32});
    for(const length of [0,1,undefined]) {
      const a=new ${name}(b,0,length);
      results.push(Reflect.preventExtensions(a));
      for(const operation of [Object.preventExtensions,Object.seal,Object.freeze]) {
        let error;try{operation(a)}catch(e){error=e.name}
        results.push(error,Object.isExtensible(a));
      }
    } return results;`;
  expect((await run(source)).returnValue).toEqual(Array.from({ length: 3 }, () => [
    false, "TypeError", true, "TypeError", true, "TypeError", true
  ]).flat());
});

it("refuses Proxy false success before ownKeys and descriptor traps", async () => {
  expect((await run(`const events=[];const a=new Uint8Array(new ArrayBuffer(0,{maxByteLength:8}));
    const p=new Proxy(a,{preventExtensions(t){events.push('prevent');return true},
      ownKeys(){events.push('keys');return []},getOwnPropertyDescriptor(){events.push('descriptor')}});
    let error;try{Object.freeze(p)}catch(e){error=e.name}
    return [error,events,Object.isExtensible(a)];`)).returnValue)
    .toEqual(["TypeError", ["prevent"], true]);
});

it("forwards refusal through an empty Proxy handler", async () => {
  expect((await run(`const a=new Uint8Array(new ArrayBuffer(0,{maxByteLength:8}));
    const p=new Proxy(a,{});return [Reflect.preventExtensions(p),Object.isExtensible(a)];`)).returnValue)
    .toEqual([false, true]);
});

it("preserves fixed-buffer and ordinary-object integrity controls", async () => {
  expect((await run(`const empty=new Uint8Array(0);Object.freeze(empty);
    const full=new Uint8Array(1);let error;try{Object.freeze(full)}catch(e){error=e.name}
    const o={};Object.preventExtensions(o);
    return [Object.isFrozen(empty),error,Object.isExtensible(full),Reflect.preventExtensions(o)];`)).returnValue)
    .toEqual([true, "TypeError", false, true]);
});

it("keeps a rejected view extensible through shrinking and regrowing its buffer", async () => {
  expect((await run(`const b=new ArrayBuffer(8,{maxByteLength:16});const a=new Uint8Array(b,0,4);
    b.resize(0);let error;try{Object.seal(a)}catch(e){error=e.name}
    b.resize(8);a[0]=9;a.extra=7;return [error,a.length,a[0],a.extra,Object.isExtensible(a)];`)).returnValue)
    .toEqual(["TypeError", 4, 9, 7, true]);
});

it("preserves rejected integrity changes across pending and completed replay", async () => {
  const source = `const b=new ArrayBuffer(8,{maxByteLength:16});const a=new Uint8Array(b);
    let error;try{Object.freeze(a)}catch(e){error=e.name}await 0;b.resize(16);
    return [error,a.length,Object.isExtensible(a)];`;
  const execution = run(source);
  const settled = execution.catch(error => error);
  try {
    const pending = restore(JSON.parse(await dump(execution)), { source });
    expect(await settled).toMatchObject({ ok: true, returnValue: ["TypeError", 16, true] });
    expect(await run(source, { snapshot: pending })).toMatchObject({ ok: true, returnValue: ["TypeError", 16, true] });
    const completed = restore(JSON.parse(await dump(execution)), { source });
    expect(await run(source, { snapshot: completed })).toMatchObject({ ok: true, returnValue: ["TypeError", 16, true] });
  } finally { await settled; }
});

it("distinguishes fixed and length-tracking views of growable shared buffers", async () => {
  expect((await run(`const b=new SharedArrayBuffer(8,{maxByteLength:16});
    const fixed=new Uint8Array(b,0,0),tracking=new Uint8Array(b);
    return [Reflect.preventExtensions(fixed),Reflect.preventExtensions(tracking),
      Object.isExtensible(fixed),Object.isExtensible(tracking)];`)).returnValue)
    .toEqual([true, false, false, true]);
});

it("uses internal buffer state without consulting guest getters or prototypes", async () => {
  expect((await run(`class A extends Uint8Array {}const a=new A(new ArrayBuffer(0,{maxByteLength:8}));
    let reads=0;Object.defineProperty(a,'buffer',{get(){reads++;throw 1}});
    const result=Reflect.preventExtensions(a);return [result,reads,a instanceof A,Object.isExtensible(a)];`)).returnValue)
    .toEqual([false, 0, true, true]);
});

it("queries fixed typed-array integrity from indexed descriptors", async () => {
  expect((await run(`const a=new Uint8Array(1);Object.preventExtensions(a);
    let error;try{Object.seal(a)}catch(e){error=e.name}
    return [error,Object.isSealed(a),Object.isFrozen(a),Object.getOwnPropertyDescriptor(a,'0').configurable];`)).returnValue)
    .toEqual(["TypeError", false, false, true]);
});

it("keeps empty fixed typed-array integrity queries true after freezing", async () => {
  expect((await run(`const a=new Uint8Array(0);Object.freeze(a);
    return [Object.isSealed(a),Object.isFrozen(a)];`)).returnValue).toEqual([true, true]);
});
