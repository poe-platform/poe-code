import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "return JSON.stringify(Symbol('x'),(key,value)=>typeof value==='symbol'?'converted':value);",
  "return JSON.stringify({x:Symbol('x')},(key,value)=>typeof value==='symbol'?'converted':value);",
  "return JSON.stringify([Symbol('x')],(key,value)=>typeof value==='symbol'?'converted':value);",
  "const symbol=Symbol('x');const calls=[];const json=JSON.stringify({x:symbol},function(key,value){if(typeof value==='symbol')calls.push([key,value===symbol,this.x===symbol]);return value});return [json,calls];",
  "return [JSON.stringify(Symbol(),(key,value)=>value),JSON.stringify({x:Symbol()},(key,value)=>value),JSON.stringify([Symbol()],(key,value)=>value)];",
  "const value={toJSON(){return Symbol('x')}};return JSON.stringify(value,(key,value)=>typeof value==='symbol'?'hook':value);",
  "const symbol=Symbol('x');const value={[symbol]:1,x:symbol};const keys=[];const json=JSON.stringify(value,(key,value)=>{keys.push(key);return typeof value==='symbol'?2:value});return [json,keys];",
  "try{return JSON.stringify(Symbol(),()=>{throw new RangeError('replacer')})}catch(error){return [error.name,error.message]}",
  "return JSON.stringify({x:1},(key,value)=>key==='x'?Symbol():value);"
])("matches native Symbol replacer behavior: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function('"use strict";'+source)()});
});
