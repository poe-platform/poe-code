import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'const f=async function(){};delete Object.getPrototypeOf(f)[Symbol.toStringTag];return Object.prototype.toString.call(f)',
  'const f=async()=>{};delete Object.getPrototypeOf(f)[Symbol.toStringTag];return Object.prototype.toString.call(f.bind(null))',
  'const f=async function(){};return Object.prototype.toString.call(f)',
  'const f=async()=>{};return Object.prototype.toString.call(f.bind(null))',
  'const f=async()=>{};return Object.getPrototypeOf(f.bind(null))===Object.getPrototypeOf(f)',
  'const f=async()=>{};const before=Object.getPrototypeOf(f);Object.defineProperty(f,"length",{get(){Object.setPrototypeOf(f,{changed:true});return 0}});return Object.getPrototypeOf(f.bind(null))===before',
  'const f=function*(){};delete Object.getPrototypeOf(f)[Symbol.toStringTag];return Object.prototype.toString.call(f)',
  'const f=async function*(){};delete Object.getPrototypeOf(f)[Symbol.toStringTag];return Object.prototype.toString.call(f)',
  'const f=async()=>{};Object.defineProperty(Object.getPrototypeOf(f),Symbol.toStringTag,{value:7});return Object.prototype.toString.call(f)'
])("matches native callable tag fallback: %s", source => {
  return expect(run(source)).resolves.toMatchObject({
    ok: true, returnValue: runInNewContext(`(function(){${source}})()`)
  });
});
