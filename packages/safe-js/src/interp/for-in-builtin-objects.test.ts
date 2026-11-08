import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  "new Date(0)", "new ArrayBuffer(4)", "new SharedArrayBuffer(4)",
  "new DataView(new ArrayBuffer(4))", "new Uint8Array(2)",
  "new Number(1)", "new Boolean(false)", "new String('ab')", "Object(1n)",
  "Object(Symbol())", "new Map()", "new Set()", "/x/", "Promise.resolve(1)",
  "new Error('x')", "new (class {})()"
])("enumerates built-in own and inherited guest properties: %s", async expression => {
  const source=`const value=${expression};value.extra=7;
    const parent=Object.getPrototypeOf(value);parent.inherited=8;
    Object.defineProperty(value,'hidden',{value:1});value[Symbol('hidden')]=2;
    const keys=[];for(const key in value)keys.push(key);return keys;`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext("(()=>{"+source+"})()")});
});

it.each([
  ["Number", "7"], ["Boolean", "false"], ["String", "'ab'"],
  ["BigInt", "1n"], ["Symbol", "Symbol()"]
])("enumerates the guest %s prototype when boxing a primitive", async (name,value) => {
  const source=`${name}.prototype.inherited=1;const keys=[];for(const key in ${value})keys.push(key);return keys;`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext("(()=>{"+source+"})()")});
});
