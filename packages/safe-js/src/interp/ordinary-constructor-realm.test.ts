import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { isSandboxClosure } from "./values.js";

it.each(["function Constructor(){this.marker=7}", "const Constructor=class {marker=7};",
  "class Base {marker=7}class Constructor extends Base {}",
  "class Base {}class Constructor extends Base {marker=7;constructor(){super()}}"]
  .flatMap(constructor => ["function Target(){}", "const Target=(function(){}).bind(null);", "const Target=new Proxy(function(){},{});"]
    .flatMap(target => ["7","null","({custom:true})"].map(prototype=>({constructor,prototype,target})))))(
  "uses the newTarget realm for ordinary construction: $constructor $prototype $target", async ({constructor,prototype,target}) => {
    const source = `${constructor}return [Reflect.construct,Constructor,Object.getPrototypeOf]`;
    const targetSource = `${target}Target.prototype=${prototype};return [Target,Object.prototype,Target.prototype]`;
    const a = runInNewContext(`(()=>{${source}})()`);
    const b = runInNewContext(`(()=>{${targetSource}})()`);
    const expectedIndex = prototype === "({custom:true})" ? 2 : 1;
    expect(Object.getPrototypeOf(a[0](a[1],[],b[0]))).toBe(b[expectedIndex]);
    const exports = (await run(source)).returnValue;
    const targets = (await run(targetSource)).returnValue;
    if (!Array.isArray(exports) || !Array.isArray(targets) || !isSandboxClosure(exports[0]) || !isSandboxClosure(exports[2]))
      throw new Error("Expected constructor exports");
    const context = {stack:[],thisValue:undefined};
    const value = await exports[0].call([exports[1],[],targets[0]],context);
    expect(await exports[2].call([value],context)).toBe(targets[expectedIndex]);
    expect((value as {marker:unknown}).marker).toBe(7);
  }
);

it.each(["function Constructor(){}", "class Constructor {}"])(
  "preserves constructor default realms after replay: %s", async constructor => {
    const source = `${constructor}await 0;return [Reflect.construct,Constructor,Object.getPrototypeOf]`;
    const original = await run(source);
    expect(original.ok).toBe(true);
    const restored = await run(source,{snapshot:JSON.parse(await dump(original))});
    expect(restored.ok).toBe(true);
    const targetSource = "function Target(){}Target.prototype=7;const prototype=Object.prototype;globalThis.Object=undefined;await 0;return [Target,prototype]";
    const originalTarget = await run(targetSource);
    expect(originalTarget.ok).toBe(true);
    const restoredTarget = await run(targetSource,{snapshot:JSON.parse(await dump(originalTarget))});
    expect(restoredTarget.ok).toBe(true);
    const context = {stack:[],thisValue:undefined};
    for (const result of [original,restored]) {
      const exports = result.returnValue;
      if (!Array.isArray(exports) || !isSandboxClosure(exports[0]) || !isSandboxClosure(exports[2])) throw new Error("Expected constructors");
      for (const target of [originalTarget,restoredTarget]) {
        const values = target.returnValue;
        if (!Array.isArray(values)) throw new Error("Expected targets");
        const value = await exports[0].call([exports[1],[],values[0]],context);
        expect(await exports[2].call([value],context)).toBe(values[1]);
      }
    }
  }
);
