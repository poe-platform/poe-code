import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createObjectArrayGlobals } from "./object-array.js";
import { createSandboxClosure } from "../values.js";
import { getSandboxPrototype } from "../object-model.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each([undefined, null, 1, "prototype"])("falls back for primitive construction prototype %s", async parent => {
  const budget = new Budget();
  const array = createObjectArrayGlobals({ budget }).Array;
  const newTarget = createSandboxClosure({ call: () => undefined, construct: () => ({}) });
  let reads = 0;
  const value = await array.construct!([2], { stack: [], newTarget, getProperty: () => { reads++; return parent; } });
  expect(reads).toBe(1);
  expect(getSandboxPrototype(value as object, budget)).toBe(getSandboxPrototype(await array.construct!([]) as object, budget));
  expect(value).toHaveLength(2);
});

it.each(["Array(3)", "new Array(3)", "Array.of(1,2,3)"])("enforces allocation limits for %s", async expression => {
  await expect(run(`return ${expression}`, { budget: new Budget({ arrayLength: 2 }) }))
    .rejects.toMatchObject({ budget: "arrayLength" });
});

it("preserves factory subclass identity on completed replay", async () => {
  const source = "class Items extends Array{};const value={};const items=Items.of(value,value);await 0;return [items instanceof Items,items[0]===value,items[1]===value];";
  const initial = await run(source);
  expect(initial.returnValue).toEqual([true, true, true]);
  const snapshot = restore(JSON.parse(await dump(initial)), { source });
  expect((await run(source, { snapshot })).returnValue).toEqual([true, true, true]);
});

it("reads newTarget.prototype before validating an Array length", async () => {
  const budget = new Budget();
  const array = createObjectArrayGlobals({ budget }).Array;
  const newTarget = createSandboxClosure({ call: () => undefined, construct: () => ({}) });
  const marker = {};
  await expect(Promise.resolve().then(() => array.construct!([-1], {
    stack: [], newTarget, getProperty: () => { throw marker; }
  }))).rejects.toBe(marker);
});

it("uses an object-valued construction prototype without copying it", async () => {
  const budget = new Budget();
  const array = createObjectArrayGlobals({ budget }).Array;
  const newTarget = createSandboxClosure({ call: () => undefined, construct: () => ({}) });
  const prototype = { label: "derived" };
  const value = await array.construct!([1, 2], {stack: [], newTarget, getProperty: () => prototype});
  expect(Array.isArray(value)).toBe(true);
  expect(getSandboxPrototype(value as object, budget)).toBe(prototype);
});

it.each([
  "const log=[];function Items(){return {set length(value){log.push(value)}}}const value=Array.from.call(Items,[1,2]);return [value[0],value[1],log];",
  "const marker={};function Items(){return {set length(value){throw marker}}}try{Array.from.call(Items,[1])}catch(error){return error===marker}",
  "const marker={};function Items(){return {set length(value){throw marker}}}try{Array.of.call(Items,1)}catch(error){return error===marker}",
  "return [Array.of.length,Array.of.name,Array.of.call(null,1,2),Array.of.call(()=>{},3)];",
  "const value={};value.self=value;const items=Array.of(value,value);return [items[0]===value,items[0]===items[1],items[0].self===value];",
  "let reads=0;const value={get item(){reads++;return 1}};const items=new Array(value);return [items[0]===value,reads];",
  "function Items(){return Object.defineProperty({},'0',{set(value){throw 1},configurable:true})}const value=Array.of.call(Items,2);return [value[0],value.length];",
  "function Items(){return Object.defineProperty({},'length',{value:0,writable:false})}try{Array.of.call(Items)}catch(error){return error.name}",
  "class Items extends Array{};const value=new Items(1,2);return [Array.isArray(value),value instanceof Items,Object.getPrototypeOf(value)===Items.prototype,value.length];",
  "class Items extends Array{};const value=Items.of(1,2);return [Array.isArray(value),value instanceof Items,value.length];",
  "class Items extends Array{};const value=Items.from([1,2]);return [Array.isArray(value),value instanceof Items,value.length];",
  "class Items extends Array{label(){return 'items'}};return new Items().label();",
  "function Items(length){this.initial=length}const value=Array.of.call(Items,'a','b');return [value instanceof Items,value.initial,value[0],value[1],value.length];",
  "function Items(){return {tag:'custom'}}return Array.of.call(Items,1);",
  "const log=[];function Items(){return {set length(value){log.push(value)}}}const value=Array.of.call(Items,1,2);return [value[0],value[1],log];",
  "const marker={};function Items(){throw marker}try{Array.of.call(Items,1)}catch(error){return error===marker};",
  "function Items(){return Object.freeze({})}try{Array.of.call(Items,1)}catch(error){return error.name};",
  "const value={a:1};return [Array(value)[0]===value,new Array(value,value)[1]===value,Array.of(value)[0]===value];",
  "const value=Object.create({tag:1});return new Array(value)[0]===value;"
])("preserves Array subclass construction: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});
