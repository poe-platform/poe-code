import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'try{return Function.prototype.caller}catch(e){return e.name}',
  'try{return Function.prototype.arguments}catch(e){return e.name}',
  'try{Function.prototype.caller=1;return "assigned"}catch(e){return e.name}',
  'try{Function.prototype.arguments=1;return "assigned"}catch(e){return e.name}',
  'try{return (()=>{}).caller}catch(e){return e.name}',
  'try{return (function(){"use strict"}).arguments}catch(e){return e.name}',
  'const a=Object.getOwnPropertyDescriptor(Function.prototype,"caller"),b=Object.getOwnPropertyDescriptor(Function.prototype,"arguments");return [a.enumerable,a.configurable,b.enumerable,b.configurable,a.get===a.set,a.get===b.get,a.get===b.set]',
  'const f=Object.getOwnPropertyDescriptor(Function.prototype,"caller").get;return [f.name,f.length,Object.isExtensible(f),Object.getPrototypeOf(f)===Function.prototype,Object.getOwnPropertyDescriptor(f,"length"),Object.getOwnPropertyDescriptor(f,"name")]',
  'Object.defineProperty(Function.prototype,"caller",{value:7});return (()=>{}).caller',
  'delete Function.prototype.arguments;return (()=>{}).arguments'
])("matches native restricted function properties: %s", source => {
  const program = `const prototype=Object.getPrototypeOf(function(){});${source.replaceAll("Function.prototype", "prototype")}`;
  return expect(run(program)).resolves.toMatchObject({
    ok: true, returnValue: runInNewContext(`(function(){"use strict";${program}})()`)
  });
});
