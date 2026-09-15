import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each([
  {source:"class S extends Symbol{};return Object.getPrototypeOf(S)===Symbol",expected:true},
  {source:"class S extends Symbol{constructor(){return {ok:7}}};return new S().ok",expected:7},
  {source:"class S extends Symbol{};try{new S()}catch(e){return e.name}",expected:"TypeError"},
  {source:"return Object.getPrototypeOf(Reflect.construct(function(){},[],Symbol))===Symbol.prototype",expected:true},
  {source:"let coerced=false;try{new Symbol({toString(){coerced=true;return 'x'}})}catch(e){return [e.name,coerced]}",expected:["TypeError",false]}
])("preserves Symbol construction semantics: $source", async ({source,expected})=>{
  expect(Function(source)()).toEqual(expected);
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

it("replays a Symbol subclass without exposing host constructors", async()=>{
  const source='class S extends Symbol{constructor(){return {value:7}}}await 0;return [new S().value,S.toString(),S.constructor("return typeof process+\',\'+typeof require")()];';
  const expected={ok:true,returnValue:[7,'class S extends Symbol{constructor(){return {value:7}}}','undefined,undefined']};
  let pending=run(source);
  for(let i=0;i<3;i++){
    const settled=pending.catch(error=>error);
    try{const saved=JSON.parse(await dump(pending));expect(await settled).toMatchObject(expected);pending=run(source,{snapshot:restore(saved,{source})});}finally{await settled;}
  }
  expect(await pending).toMatchObject(expected);
  expect(await run(source,{snapshot:restore(JSON.parse(await dump(pending)),{source})})).toMatchObject(expected);
});
