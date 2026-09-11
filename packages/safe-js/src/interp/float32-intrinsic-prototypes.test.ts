import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../run.js";
import { getSandboxDataProperty } from "./object-model.js";

it("stops data-only numeric lookup at an inherited typed array", async () => {
  const result=await run("const value=new Float32Array([1]);Object.setPrototypeOf(value,{'-0':7});return Object.create(value)");
  expect(getSandboxDataProperty(result.returnValue,"-0")).toBeUndefined();
  expect(getSandboxDataProperty(result.returnValue,"0")).toBe(1);
});

it.each([
  "return typeof Float32Array.prototype",
  "class Custom extends Float32Array{field=7;length=0}const value=new Custom([1,2]);return [value.field,value.length,value.join('-')]",
  "const value=new Float32Array([1]);Object.defineProperty(value,'extra',{get(){return this[0]+7}});return value.extra",
  "const value=new Float32Array([1]);Object.defineProperty(value,'0',{value:1.25});return value[0]",
  "const parent=Object.getPrototypeOf(Float32Array.prototype);return [Object.prototype.toString.call(new Float32Array(1)),typeof Object.getOwnPropertyDescriptor(parent,Symbol.toStringTag)?.get]",
  "const value=new Float32Array([1,2]);return [String(value),value.join('-')]",
  "class Custom extends Float32Array{get length(){throw 7}}return new Custom([1,2]).join('-')",
  "const value=new Float32Array([1,2]);return value.join({toString(){value[1]=7;return '-'}})",
  "try{new Float32Array(1).BYTES_PER_ELEMENT=8}catch(e){return e.name}",
  "const value=new Float32Array(1);Object.setPrototypeOf(value,null);value.length=7;return value.length",
  "const value=new Float32Array([1]);const prototype={tag:7};Object.setPrototypeOf(value,prototype);return [value.tag,Object.getPrototypeOf(value)===prototype,value[0]]",
  "const prototype={'-0':7,NaN:8};const value=new Float32Array([1]);Object.setPrototypeOf(value,prototype);return [value['-0'],value.NaN,value[0]]",
  "const value=new Float32Array([1]);Object.setPrototypeOf(value,{'-0':7,NaN:8});const child=Object.create(value);return [child['-0'],child.NaN,child[0]]",
  "return Object.getPrototypeOf(new Float32Array(2))===Float32Array.prototype",
  "return [Float32Array.prototype.constructor===Float32Array,Float32Array.prototype.BYTES_PER_ELEMENT,Float32Array.BYTES_PER_ELEMENT]",
  "const value=new Float32Array([1,2]);Object.setPrototypeOf(value,null);return [value instanceof Float32Array,value[0],value[1]]",
  "return Object.create(Float32Array.prototype) instanceof Float32Array",
  "class Custom extends Float32Array{}const value=new Custom([1,2]);return [value instanceof Custom,value instanceof Float32Array,Object.getPrototypeOf(value)===Custom.prototype,value[1]]",
  "const parent=Object.getPrototypeOf(Float32Array);return [parent.name,parent.length,Object.getPrototypeOf(parent)===Object.getPrototypeOf(()=>{}),parent.prototype===Object.getPrototypeOf(Float32Array.prototype)]",
  "return [Float32Array,Object.getPrototypeOf(Float32Array)].map(C=>{const d=Object.getOwnPropertyDescriptor(C,'prototype');return [d.writable,d.enumerable,d.configurable]})",
  "const d=Object.getOwnPropertyDescriptor(Float32Array.prototype,'BYTES_PER_ELEMENT');return [d.value,d.writable,d.enumerable,d.configurable]",
  "const a=new Float32Array(1),b=new Float32Array(1);return [a.set===b.set,a.set===Float32Array.prototype.set,Object.hasOwn(a,'set'),a.set.name,a.set.length]",
  "const p=Object.getPrototypeOf(Float32Array.prototype);return ['length','byteLength','byteOffset'].map(key=>{const d=Object.getOwnPropertyDescriptor(p,key);return [typeof d.get,d.set,d.enumerable,d.configurable]})",
  "try{return Object.create(Float32Array.prototype).length}catch(e){return e.name}",
  "const value=new Float32Array([1,2]);Object.setPrototypeOf(value,null);return [value.length,value.byteLength,value.byteOffset,value.set,value.BYTES_PER_ELEMENT]",
  "delete Object.getPrototypeOf(Float32Array.prototype).set;return typeof new Float32Array(1).set",
  "Float32Array.prototype.set=function(){return this[0]+7};return new Float32Array([2]).set()",
  "class Custom extends Float32Array{get doubled(){return this[0]*2}}return new Custom([3]).doubled",
  "const p=Object.getPrototypeOf(Float32Array.prototype);const a=new Float32Array([1,2]);return [a[Symbol.iterator]===p.values,Array.from(a.values()),Array.from(a.keys()),Array.from(a.entries())]",
  "const value=new Float32Array([1,2]);Object.setPrototypeOf(value,null);try{return Array.from(value)}catch(e){return e.name}",
  "const value=new Float32Array([1,2]);value[Symbol.iterator]=function*(){yield 7};return Array.from(value)",
  "try{new (Object.getPrototypeOf(Float32Array))()}catch(e){return e.name}",
  "const value=new Float32Array([1,2]);return [value instanceof Float32Array,Array.from(value)]"
])("matches the native Float32Array prototype graph: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){'use strict';${source}})()`)});
});
