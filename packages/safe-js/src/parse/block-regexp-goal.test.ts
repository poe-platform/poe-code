import { expect, it } from "vitest";
import { parse, parseEvalScript, parseModule } from "./parser.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each(["{}", "{0;}", "{{}}", "0;{}", "{}{}", "if(true){}", "while(false){}", "try{}finally{}", "switch(0){}"])("recognizes a regexp statement after %s", async prefix=>{
  const source=prefix+'/x/.test("x");';
  expect(()=>parseEvalScript(source)).not.toThrow();
  expect(()=>parseEvalScript('"use strict";'+source)).not.toThrow();
  expect(await run(prefix+'return /x/.test("x");')).toMatchObject({ok:true,returnValue:true});
  expect(await run(prefix+'/x/.test("x");return true;')).toMatchObject({ok:true,returnValue:true});
});

it.each([
  'return ({valueOf(){return 8}})/2;',
  'return `${{valueOf(){return 8}}/2}`;',
  'const value=function(){} /2;return Number.isNaN(value);',
  'const value=(()=>{})/2;return Number.isNaN(value);',
  'const value=true?{}:{};return Number.isNaN(value/2);'
])("preserves expression-ending braces: %s", async source=>{
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it("keeps the legacy expression parser's object division goal",()=>{
  expect(parse('{} /2').type).toBe('BinaryExpression');
  expect(()=>parseModule('const x={} /2;')).not.toThrow();
});

it("recognizes brace-containing regexps after blocks inside template substitutions", async()=>{
  const source='return `${(()=>{if(true){} /[}]/.test("}");return 7})()}`;';
  expect(await run(source)).toMatchObject({ok:true,returnValue:'7'});
});

it("preserves regexp source and authority through repeated replay",async()=>{
  const source='if(true){} /x/.test("x");const f=()=>/x/;await 0;return [f().test("x"),f.toString(),f.constructor("return typeof process+\',\'+typeof require")()];';
  const expected={ok:true,returnValue:[true,'()=>/x/','undefined,undefined']};let pending=run(source);
  for(let i=0;i<3;i++){
    const settled=pending.catch(error=>error);
    try{const saved=JSON.parse(await dump(pending));expect(await settled).toMatchObject(expected);pending=run(source,{snapshot:restore(saved,{source})});}finally{await settled;}
  }
  expect(await pending).toMatchObject(expected);
  expect(await run(source,{snapshot:restore(JSON.parse(await dump(pending)),{source})})).toMatchObject(expected);
});

it.each(['switch','if'])("keeps division after a method named %s",async name=>{
  const source=`const object={${name}(){return 8}};return object.${name}()/2;`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:4});
});

it.each([
  'return Function("{} /x/.test(\'x\');return 7")();',
  'return await (async function(){}).constructor("{} /x/.test(\'x\');return 7")();',
  'return (function*(){}).constructor("{} /x/.test(\'x\');return 7")().next().value;',
  'return (await (async function*(){}).constructor("{} /x/.test(\'x\');return 7")().next()).value;'
])("uses the statement-list goal for dynamic function bodies: %s",async source=>{
  expect(await run(source)).toMatchObject({ok:true,returnValue:7});
});

it("recognizes a regexp after a for-await block",async()=>{
  expect(await run('for await(const x of []){} /x/.test("x");return 7;')).toMatchObject({ok:true,returnValue:7});
});
