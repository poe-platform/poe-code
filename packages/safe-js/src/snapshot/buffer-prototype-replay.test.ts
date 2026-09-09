import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";

describe.each(["ArrayBuffer", "SharedArrayBuffer", "DataView"])("%s managed state in public replay", name => {
  const argument = name === "DataView" ? "new ArrayBuffer(4)" : "4";
  it.each([
    `class Derived extends ${name}{}const value=new Derived(${argument});await 0;return [value instanceof Derived,value.byteLength]`,
    `const value=new ${name}(${argument});const parent={marker:7};Object.setPrototypeOf(value,parent);await 0;return [value.marker,Object.getPrototypeOf(value)===parent]`,
    `const value=new ${name}(${argument});Object.defineProperty(value,'marker',{get(){return 7},configurable:true});await 0;return [value.marker,value.byteLength]`
  ])("retains supported state: %s", async source => {
    const expected = await runInNewContext(`(async()=>{${source}})()`, {}, { timeout: 1000 });
    const original = await run(source);
    expect(original).toMatchObject({ ok: true, returnValue: expected });
    const snapshot = JSON.parse(await dump(original));
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: expected });
  });
});
