import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";

it("preserves species construction and aliasing across completed replay", async () => {
  const source = "let calls=0;class Items extends Array{constructor(n){super(n);calls++}};const value={};const items=new Items(1);items[0]=value;const mapped=items.map(x=>x);await 0;return [mapped instanceof Items,mapped[0]===value,calls]";
  const initial = await run(source);
  expect(initial.returnValue).toEqual([true, true, 2]);
  const snapshot = restore(JSON.parse(await dump(initial)), { source });
  expect((await run(source, { snapshot })).returnValue).toEqual([true, true, 2]);
});

it("keeps custom species allocation subject to data limits", async () => {
  const source = "const values=[1];values.constructor={[Symbol.species]:function(){return {data:'x'.repeat(10000)}}};return values.map(x=>x)";
  await expect(run(source, { budget: new Budget({ dataSize: 8000 }) })).rejects.toMatchObject({ budget: "dataSize" });
});

it.each([
  "const values=[1,2];const depth={valueOf(){values.push(3);return 1}};return values.flat(depth)",
  "const values=[1,2];values.constructor={get [Symbol.species](){values.push(3);return Array}};return values.flat()",
  "const mapped=[1,2];Object.defineProperty(mapped,'0',{get(){mapped.push(3);return 1}});return [0].flatMap(()=>mapped)",
  ...["map(x=>x)", "filter(x=>true)", "slice()", "concat(3)", "flat()", "flatMap(x=>[x])", "splice(0,1)"]
    .flatMap(method => [
      `const values=[1,,3];values.constructor={[Symbol.species]:function(n){return {initial:n}}};const result=values.${method};return [Object.keys(result),result.initial,result.length,result[0],result[1],result[2]]`,
      `const log=[];const values=[1,2];values.constructor={[Symbol.species]:function(n){return {set length(n){log.push(n)}}}};const result=values.${method};return [log,Object.keys(result),result[0],result[1],values.length,values[0],values[1]]`,
      `const values=[1];values.constructor={[Symbol.species]:function(){return Object.freeze({})}};try{values.${method}}catch(error){return error.name}`,
      `const values=[1];values.constructor={[Symbol.species]:()=>{}};try{values.${method}}catch(error){return error.name}`
    ]),
  "const values=[1];values.constructor=null;try{values.map(x=>x)}catch(error){return error.name}",
  "const log=[];const values=[1];Object.defineProperty(values,'constructor',{get(){log.push('constructor');throw 1}});try{values.map(null)}catch(error){return [error.name,log]}",
  "const values={0:1,length:1,get constructor(){throw 1}};return Array.prototype.map.call(values,x=>x)",
  "const values=[1];values.constructor={[Symbol.species]:function(){return function result(){}}};const result=values.map(x=>x);return [typeof result,result[0],result.name]",
  "const values=[1];values.constructor={[Symbol.species]:function(){return Object.defineProperty({},'0',{set(value){throw 1},configurable:true})}};return values.map(x=>x)[0]",
  "const getter=Object.getOwnPropertyDescriptor(Array,Symbol.species).get;const marker={};return [getter.call(marker)===marker,getter.name,getter.length,Object.getOwnPropertyDescriptor(Array,Symbol.species).enumerable]",
  "return Array[Symbol.species] === Array",
  "const values=[1,2];values.constructor={[Symbol.species]:function(n){return {initial:n}}};function* iterate(){return values.map(yield 'callback')}const iterator=iterate();const first=iterator.next();const last=iterator.next(x=>x);return [first.value,last.value.initial,last.value[0],last.value[1]]",
  "const log=[];const values=[1,2];values.constructor={[Symbol.species]:function(){return {set length(n){log.push(values.length,values[0]);throw 'stop'}}}};try{values.splice(0,1)}catch(error){return [error,log,values.length,values[0]]}",
  ...["map(x=>x)", "filter(x=>true)", "slice()", "concat(3)", "flat()", "flatMap(x=>[x])", "splice(0,1)"]
    .map(method => `class Items extends Array{};return new Items(1,2).${method} instanceof Items`),
  "const log=[];const values=[1,2];Object.defineProperty(values,'constructor',{get(){log.push('constructor');return {[Symbol.species]:function(n){log.push(n);return {}}}}});const result=values.map(x=>{log.push(x);return x});return [log,result.length,result[0],result[1]]",
  ...["toReversed()", "toSorted()", "toSpliced(0,1)", "with(0,9)"]
    .map(method => `class Items extends Array{};return new Items(1,2).${method} instanceof Items`),
  "class Items extends Array{static get [Symbol.species](){return null}};return new Items(1,2).map(x=>x) instanceof Items"
])("honors Array species selection: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});
