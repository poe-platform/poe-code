import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "return Function('[created]=[7];return [created,globalThis.created]')()",
  "return Function('({value:created}={value:7});return created')()",
  "return Function('for(created of [7]){}return created')()",
  "return Function('const o={};Object.defineProperty(o,\"x\",{value:1});o.x=2;return o.x')()",
  "return Function('const o=Object.preventExtensions({});o.x=2;return Object.hasOwn(o,\"x\")')()",
  "return Function('const o={get x(){return 1}};o.x=2;return o.x')()",
  "return Function('const o=Object.freeze([1]);o[0]=2;return o[0]')()",
  "return Function('const o=Object.freeze({x:1});return [o.x++,++o.x,o.x]')()",
  "return Function('const o=Object.freeze({x:1});[o.x]=[2];return o.x')()",
  "return Function('const o=Object.create(Object.freeze({x:1}));o.x=2;return [o.x,Object.hasOwn(o,\"x\")]')()",
  "return Function('const o=[1];Object.defineProperty(o,\"length\",{writable:false});o[1]=2;return [o.length,o[1]]')()",
  "return Function('const o=[1,2,3];Object.defineProperty(o,\"1\",{configurable:false});o.length=0;return [o.length,o[0],o[1],o[2]]')()",
  "return Function('const value=3;value.x=7;return value.x')()",
  "return Function('try{Object.assign(Object.freeze({x:1}),{x:2})}catch(e){return e.name}')()",
  "return Function('try{Object.freeze([1]).push(2)}catch(e){return e.name}')()",
  "return Function('const o={set x(value){throw new Error(\"setter\")}};try{o.x=2}catch(e){return e.message}')()",
  "try{return Function('missing+=1')()}catch(e){return e.name}",
  "try{return Function('\"use strict\";[created]=[7]')()}catch(e){return e.name}",
  "try{return Function('\"use strict\";const o=Object.freeze({x:1});o.x=2')()}catch(e){return e.name}",
  "try{const C=Function('return class {x=(created=1)}')();new C()}catch(e){return [e.name,Object.hasOwn(globalThis,'created')]}",
  "try{Function('return class {static x=(created=1)}')()}catch(e){return [e.name,Object.hasOwn(globalThis,'created')]}",
  "try{Function('return class {static {created=1}}')()}catch(e){return [e.name,Object.hasOwn(globalThis,'created')]}",
  "return Function('const o=Object.freeze({x:1});return delete o.x')()",
  "return Function('const value=1;return delete value')()",
  "return Function('return delete missing')()",
  "try{Function('\"use strict\";return delete missing')}catch(e){return e.name}"
])("matches native dynamic assignment semantics: %s", async source => {
  expect(await run(source)).toMatchObject({ok: true, returnValue: runInNewContext(`(function(){${source}})()`)});
});
