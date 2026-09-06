import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each(["undefined", "null", "true", "false", "{}", "[]", "Symbol('space')", "2n", "Object(2n)", "new Boolean(true)", "new Number(2)", "new String('--')", "NaN", "Infinity", "-Infinity", "-1", "2.9", "'abcdefghijkl'", "'😀😀😀😀😀😀'"])("matches native spacing option %s", async spacing => {
  const source=`return JSON.stringify({a:[1,{b:2}]},null,${spacing});`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it.each([
  "const calls=[];const space=new Number(2);space[Symbol.toPrimitive]=hint=>{calls.push(hint);return 3};const json=JSON.stringify({a:1},null,space);return [json,calls];",
  "const calls=[];const space=new String('x');space.toString=()=>{calls.push('string');return '--'};const json=JSON.stringify({a:1},null,space);return [json,calls];",
  "const space={valueOf(){throw new Error('coerced')},toString(){throw new Error('coerced')}};return JSON.stringify({a:1},null,space);",
  "const calls=[];const keys=['a'];Object.defineProperty(keys,'0',{get(){calls.push('key');return 'a'}});const space=new Number(2);space.valueOf=()=>{calls.push('space');return 2};const value={toJSON(){calls.push('value');return {a:1}}};const json=JSON.stringify(value,keys,space);return [json,calls];",
  "const space=new Number(2);space.valueOf=()=>1n;try{return JSON.stringify({},null,space)}catch(error){return error.name}"
])("preserves spacing conversion behavior: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});
