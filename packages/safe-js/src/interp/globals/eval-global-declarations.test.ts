import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  '(0,eval)("var fresh=7");return [fresh,globalThis.fresh]',
  '(0,eval)("var fresh=7");return Object.getOwnPropertyDescriptor(globalThis,"fresh")',
  '(0,eval)("function fresh(){return 7}");return [fresh(),fresh===globalThis.fresh]',
  '(0,eval)("function fresh(){return 7}");const d=Object.getOwnPropertyDescriptor(globalThis,"fresh");return [d.writable,d.enumerable,d.configurable]',
  '(0,eval)("let hidden=7;function fresh(){return ++hidden}");return [fresh(),fresh(),typeof hidden]',
  '(0,eval)("var fresh=7");return [delete globalThis.fresh,typeof fresh]',
  '(0,eval)("let hidden=7");return typeof hidden',
  'Object.defineProperty(globalThis,"fresh",{value:3,writable:false,configurable:true});(0,eval)("var fresh=7");return fresh',
  'Object.defineProperty(globalThis,"fresh",{value:3,writable:false,configurable:false});try{(0,eval)("function fresh(){}")}catch(e){return e.name}',
  '(0,eval)("{function fresh(){return 7}}");return fresh()',
  'Object.defineProperty(globalThis,"fresh",{value:3,writable:true,enumerable:true,configurable:false});(0,eval)("function fresh(){return 7}");return [fresh(),Object.getOwnPropertyDescriptor(globalThis,"fresh").configurable]',
  `return (0,eval)(${JSON.stringify('"use strict";var fresh=7;fresh')})`
])("instantiates indirect eval global declarations: %s", async source => {
  const expected: unknown = runInNewContext(`(function(){${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it("replaces a configurable non-writable global with an eval function", async () => {
  // Native Node's ordinary global matches this; node:vm's contextified global does not.
  expect(await run('Object.defineProperty(globalThis,"fresh",{value:3,writable:false,configurable:true});(0,eval)("function fresh(){return 7}");const d=Object.getOwnPropertyDescriptor(globalThis,"fresh");return [fresh(),d.writable,d.enumerable,d.configurable]'))
    .toMatchObject({ ok: true, returnValue: [7, true, true, true] });
});

it("rejects incompatible global functions before creating any var bindings", async () => {
  // EvalDeclarationInstantiation checks functions before creating vars.
  // Node 22 (including its ordinary global) currently creates the var first.
  // https://tc39.es/ecma262/multipage/global-object.html#sec-evaldeclarationinstantiation
  expect(await run('Object.defineProperty(globalThis,"fresh",{value:3,writable:false,configurable:false});try{(0,eval)("var earlier;function fresh(){}")}catch(e){return [e.name,Object.hasOwn(globalThis,"earlier")]}'))
    .toMatchObject({ ok: true, returnValue: ["TypeError", false] });
});
