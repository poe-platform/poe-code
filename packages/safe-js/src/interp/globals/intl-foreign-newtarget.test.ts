import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { isSandboxClosure } from "../values.js";

it.each(["NumberFormat","DateTimeFormat","Collator","PluralRules","RelativeTimeFormat","ListFormat","Segmenter","Locale","DisplayNames"]
  .flatMap(name => ["7","null","({custom:true})"].map(prototype=>({name,prototype}))))(
  "uses foreign Intl.$name newTarget defaults: $prototype", async ({name,prototype}) => {
    const args = name === "DisplayNames" ? '["en",{type:"language"}]' : '["en"]';
    const source = `return [Reflect.construct,Intl.${name},${args},Object.getPrototypeOf]`;
    const targetSource = `function Target(){}Target.prototype=${prototype};return [Target,Intl.${name}.prototype,Target.prototype]`;
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

it.each(["NumberFormat","Locale","DurationFormat"])("keeps Intl.%s defaults after target replay", async name => {
  const a = (await run(`return [Reflect.construct,Intl.${name},Object.getPrototypeOf]`)).returnValue;
  const source = `const Target=(class {}).bind(null);Target.prototype=7;
    const prototype=Intl.${name}.prototype;globalThis.Intl=undefined;await 0;return [Target,prototype]`;
  const original = await run(source);
  expect(original.ok).toBe(true);
  const restored = await run(source,{snapshot:JSON.parse(await dump(original))});
  expect(restored.ok).toBe(true);
  if (!Array.isArray(a) || !isSandboxClosure(a[0]) || !isSandboxClosure(a[2])) throw new Error("Expected constructors");
  const context = {stack:[],thisValue:undefined};
  for (const result of [original,restored]) {
    const values = result.returnValue;
    if (!Array.isArray(values)) throw new Error("Expected target exports");
    const value = await a[0].call([a[1],["en"],values[0]],context);
    expect(await a[2].call([value],context)).toBe(values[1]);
  }
});

it.each(["NumberFormat","PluralRules"])("rejects revocation during Intl.%s prototype lookup before options", async name => {
  const source = `return [Reflect.construct,Intl.${name},["en",{get localeMatcher(){throw Error("options were read")}}]]`;
  const targetSource = `const r=Proxy.revocable(function(){},{get(t,k){if(k==="prototype"){r.revoke();return 7}return Reflect.get(t,k)}});return r.proxy`;
  const nativeA = runInNewContext(`(()=>{${source}})()`);
  const nativeTarget = runInNewContext(`(()=>{${targetSource}})()`);
  expect(()=>nativeA[0](nativeA[1],nativeA[2],nativeTarget)).toThrow("revoked");
  const a = (await run(source)).returnValue;
  const target = (await run(targetSource)).returnValue;
  if (!Array.isArray(a) || !isSandboxClosure(a[0])) throw new Error("Expected constructors");
  await expect(a[0].call([a[1],a[2],target],{stack:[],thisValue:undefined})).rejects.toThrow("revoked proxy");
});
