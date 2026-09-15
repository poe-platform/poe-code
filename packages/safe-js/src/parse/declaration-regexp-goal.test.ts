import { expect, it } from "vitest";
import { run } from "../run.js";
import { parseEvalScript, parseModule } from "./parser.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  'function f(){}', 'function* f(){}', 'async function f(){}', 'async function* f(){}',
  'class C{}', 'class C extends Object{}', 'class C extends class{}{}',
  '{function f(){} /x/.test("x");}', '{class C{} /x/.test("x");}',
  'function f(a={}){}', 'class C{method(){}}', 'class C{class(){} function(){}}'
])("recognizes regexp statements after declarations: %s",async prefix=>{
  const source=prefix+'/x/.test("x");';
  expect(()=>parseEvalScript(source)).not.toThrow();
  expect(()=>parseEvalScript('"use strict";'+source)).not.toThrow();
  expect(await run(source+'return true;')).toMatchObject({ok:true,returnValue:true});
});

it.each([
  'class C extends function(){{}/x/.test("x");}{} /x/;return true;',
  'class C{class\nextends(a){{}/x/;return 7}}return new C().extends();',
  'const f=function(){} /2;return Number.isNaN(f);',
  'const f=function named(){} /2;return Number.isNaN(f);',
  'const f=async function(){} /2;return Number.isNaN(f);',
  'const f=function*(){} /2;return Number.isNaN(f);',
  'const f=async function*(){} /2;return Number.isNaN(f);',
  'const C=class{} /2;return Number.isNaN(C);',
  'const C=class Named{} /2;return Number.isNaN(C);',
  'const C=class extends Object{} /2;return Number.isNaN(C);',
  'const C=class extends class{}{} /2;return Number.isNaN(C);',
  'const x={class:1,function:2};return x.class+x.function;',
  'class C{class;method(){{}/x/.test("x");return 7}}return new C().method();',
  'class C{field=class {method(){return 7}}}return new (new C().field)().method();',
  'return `${class{}/2}`;',
  'return `${(()=>{function f(){} /[}]/.test("}");class C{} /[}]/;return 7})()}`;'
])("preserves expression and nested declaration contexts: %s",async source=>{
  expect(await run(source)).toMatchObject({ok:true,returnValue:await Function('return async function(){'+source+'}')()()});
});

it.each(['export default function(){} /x/;', 'export default class{} /x/;'])("accepts a regexp following an export declaration: %s",source=>{
  expect(()=>parseModule(source)).not.toThrow();
});

it("retains declaration source and host boundaries through replay",async()=>{
  const source='function f(){return 7}/x/;class C{value(){return 8}}/x/;await 0;return [f(),new C().value(),f.toString(),C.toString(),f.constructor("return typeof process+\',\'+typeof require")()];';
  const expected={ok:true,returnValue:[7,8,'function f(){return 7}','class C{value(){return 8}}','undefined,undefined']};let pending=run(source);
  for(let i=0;i<3;i++){
    const settled=pending.catch(error=>error);
    try{const saved=JSON.parse(await dump(pending));expect(await settled).toMatchObject(expected);pending=run(source,{snapshot:restore(saved,{source})});}finally{await settled;}
  }
  expect(await pending).toMatchObject(expected);
  expect(await run(source,{snapshot:restore(JSON.parse(await dump(pending)),{source})})).toMatchObject(expected);
});
