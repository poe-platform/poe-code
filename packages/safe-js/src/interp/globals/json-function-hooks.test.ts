import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "const fn=function(){};fn.toJSON=function(key){return key+':function'};return [JSON.stringify(fn),JSON.stringify({fn}),JSON.stringify([fn])];",
  "const fn=function(){};const calls=[];Object.defineProperty(fn,'toJSON',{get(){calls.push('get');return function(key){calls.push(this===fn,key);return 3}}});const json=JSON.stringify(fn);return [json,calls];",
  "const fn=function(){};fn.toJSON=()=>2;return JSON.stringify(fn,(key,value)=>typeof value==='number'?value+1:value);",
  "const fn=function(){};fn.toJSON=1;return [JSON.stringify(fn),JSON.stringify([fn])];",
  "const fn=function(){};fn.toJSON=()=>Symbol('x');return [JSON.stringify(fn),JSON.stringify([fn])];"
])("matches native JSON behavior: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function('"use strict";'+source)()});
});
