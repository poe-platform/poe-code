import { expect, it } from "vitest";
import { run } from "../run.js";
import { deepCopyFromSandbox, deepCopyToSandbox } from "./values.js";

it.each([
  'Object(Symbol("x"))',
  '[Object(Symbol.iterator)]',
  'new Map([[Object(Symbol("x")),1]])',
  'new Set([Object(Symbol("x"))])',
  '{get value(){return Object(Symbol("x"))}}'
])("rejects boxed symbols before transfer: %s", async value => {
  const source = `const buffer=new ArrayBuffer(1);try{structuredClone(${value},{transfer:[buffer]});return "accepted"}catch(e){return [e.name,e.code,buffer.detached]}`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it("rejects a boxed symbol before evaluating subsequent getters", async () => {
  const source = 'const trace=[];try{structuredClone({first:Object(Symbol("x")),get next(){trace.push("next");return 1}})}catch(e){trace.push(e.name)}return trace';
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it("does not coerce boxed symbols during rejection", async () => {
  const source = 'const value=Object(Symbol("x"));const trace=[];value.valueOf=()=>{trace.push("valueOf");return 1};Object.defineProperty(value,Symbol.toPrimitive,{value:()=>{trace.push("primitive");return 1}});try{structuredClone(value)}catch(e){trace.push(e.name)}return trace';
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it("preserves boxed symbols in ordinary sandbox copying", () => {
  const symbol = Symbol("x");
  const copy = deepCopyFromSandbox(deepCopyToSandbox(Object(symbol)));
  expect(Symbol.prototype.valueOf.call(copy)).toBe(symbol);
});
