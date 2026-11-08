import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { isSandboxClosure } from "../values.js";

it.each(["ArrayBuffer","DataView","Uint8Array","Int8Array","Uint8ClampedArray","Int16Array","Uint16Array","Int32Array","Uint32Array","Float32Array","Float64Array","BigInt64Array","BigUint64Array"]
  .flatMap(name => ["7","null","({custom:true})"].map(prototype=>({name,prototype}))))(
  "uses foreign newTarget defaults for $name: $prototype", async ({name,prototype}) => {
    const args = name === "DataView" ? "[new ArrayBuffer(8)]" : "[4]";
    const source = `return [Reflect.construct,${name},${args},Object.getPrototypeOf]`;
    const targetSource = `function Target(){}Target.prototype=${prototype};return [Target,${name}.prototype,Target.prototype]`;
    const nativeA = runInNewContext(`(()=>{${source}})()`);
    const nativeB = runInNewContext(`(()=>{${targetSource}})()`);
    const expectedIndex = prototype === "({custom:true})" ? 2 : 1;
    expect(Object.getPrototypeOf(nativeA[0](nativeA[1],nativeA[2],nativeB[0]))).toBe(nativeB[expectedIndex]);
    const a = (await run(source)).returnValue;
    const b = (await run(targetSource)).returnValue;
    if (!Array.isArray(a) || !Array.isArray(b) || !isSandboxClosure(a[0]) || !isSandboxClosure(a[3])) throw new Error("Expected constructors");
    const context = {stack:[],thisValue:undefined};
    const value = await a[0].call([a[1],a[2],b[0]],context);
    expect(await a[3].call([value],context)).toBe(b[expectedIndex]);
  }
);

it.each(["ArrayBuffer","DataView","Uint8Array","Float32Array","BigInt64Array","Float16Array"])(
  "preserves foreign %s defaults through target replay and cleanup", async name => {
    const args = name === "DataView" ? "[new ArrayBuffer(8)]" : "[4]";
    const a = (await run(`return [Reflect.construct,${name},${args},Object.getPrototypeOf]`)).returnValue;
    const source = `const Target=(class {}).bind(null);Target.prototype=7;
      const prototype=${name}.prototype;globalThis.${name}=undefined;await 0;return [Target,prototype]`;
    const original = await run(source);
    expect(original.ok).toBe(true);
    const restored = await run(source,{snapshot:JSON.parse(await dump(original))});
    expect(restored.ok).toBe(true);
    if (!Array.isArray(a) || !isSandboxClosure(a[0]) || !isSandboxClosure(a[3])) throw new Error("Expected constructors");
    const context = {stack:[],thisValue:undefined};
    for (const result of [original,restored]) {
      const values = result.returnValue;
      if (!Array.isArray(values)) throw new Error("Expected target");
      const value = await a[0].call([a[1],a[2],values[0]],context);
      expect(await a[3].call([value],context)).toBe(values[1]);
    }
  }
);
