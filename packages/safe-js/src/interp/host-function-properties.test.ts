import { expect, it } from "vitest";
import { run } from "../run.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { isSandboxClosure } from "./values.js";

it.each(["binding", "default export"])("does not execute native metadata getters for a %s", async route => {
  let reads = 0;
  const fn = () => 7;
  for (const key of ["name", "length"]) Object.defineProperty(fn, key, {
    configurable: true,
    get() { reads++; throw new Error("native metadata getter must not run"); }
  });
  const result = route === "binding"
    ? await run("return fn()", {bindings: {fn}})
    : await run("const {default:fn}=await import('fixture');return fn()", {modules: {fixture: {default: fn}}});
  expect(result).toMatchObject({ok: true, returnValue: 7});
  expect(reads).toBe(0);
});

const cases = [
  "fn.extra=1;return fn.extra",
  "({value:fn.extra}={value:7});return fn.extra",
  "Object.defineProperty(fn,'extra',{value:7,writable:true,configurable:true});fn.extra++;return fn.extra",
  "fn.extra=7;return [delete fn.extra,fn.extra,Object.keys(fn)]",
  "return [fn.name,fn.length,Object.isExtensible(fn),Reflect.ownKeys(fn)]",
  "return Object.getOwnPropertyDescriptor(fn,'name')",
  "return [delete fn.name,fn.name,Object.hasOwn(fn,'name')]",
  "const key=Symbol('key');fn[key]=7;return [fn[key],Reflect.ownKeys(fn).includes(key),delete fn[key]]",
  "fn.self=fn;return fn.self===fn",
  "fn.extra=7;const keys=[];for(const key in fn)keys.push(key);return keys",
  "Object.setPrototypeOf(fn,{valueOf(){return 7}});return +fn",
  "fn.extra=7;return Object.assign({},fn)",
  "Object.defineProperty(fn,'extra',{get(){return this===fn?7:0},enumerable:true});return [fn.extra,{...fn}.extra]",
  "fn.call=3;fn.construct=4;fn.properties=5;return [fn(2,3),fn.call,fn.construct,fn.properties]",
  "return Object.getPrototypeOf(fn)===Object.getPrototypeOf(function(){})",
  "Object.setPrototypeOf(fn,{set extra(value){this.saved=value},get extra(){return this.saved}});fn.extra=7;return [fn.extra,fn.saved]",
  "Object.freeze(fn);try{fn.extra=7}catch(error){return [Object.isFrozen(fn),error.name]}",
  "return [fn.call(null,2,3),fn.apply(null,[2,3]),fn.bind(null,2)(3)]"
];

it.each(cases)("matches native function-object behavior: %s", async source => {
  const fn = (a: number, b: number) => a + b;
  const expected = Function("fn", `"use strict";${source}`)(fn);
  const guestFn = (a: number, b: number) => a + b;
  // Use the same public binding name for the native and sandbox functions.
  Object.defineProperty(guestFn, "name", {value: "fn", configurable: true});
  const before = Object.getOwnPropertyDescriptors(guestFn);
  expect(await run(source, {bindings: {fn: guestFn}})).toMatchObject({ok: true, returnValue: expected});
  expect(Object.getOwnPropertyDescriptors(guestFn)).toEqual(before);
  expect(Object.getPrototypeOf(guestFn)).toBe(Function.prototype);
});

it("restores module function properties, deleted metadata, aliases and prototypes", async () => {
  const source = `const {fn}=await import('fixture');delete fn.name;
    fn.extra={count:1};fn.self=fn;Object.setPrototypeOf(fn,{marker:9});
    return ()=>[fn(),fn.extra.count++,Object.hasOwn(fn,'name'),fn.self===fn,Object.getPrototypeOf(fn).marker]`;
  const original = await run(source, {modules:{fixture:{fn:()=>7}}});
  if (!original.ok) throw original.error;
  let reader = original.returnValue as RuntimeSnapshotValue;
  for (let count=1;count<=2;count++) {
    const saved = serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{reader}}],
      callStack:[],pendingPromises:[],moduleBindings:{}});
    expect(() => restore(saved,{source})).toThrow();
    const restored = restore(JSON.parse(JSON.stringify(saved)),{source,modules:{fixture:{fn:()=>11}}});
    const binding = restored.currentScope.lookup("reader");
    if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("missing reader");
    expect(await binding.value.call([])).toEqual([11,count,false,true,9]);
    reader = binding.value;
  }
});
