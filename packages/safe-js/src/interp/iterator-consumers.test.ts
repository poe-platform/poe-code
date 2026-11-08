import { runInNewContext } from "node:vm";
import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { Budget, createRealm } from "../core.js";

const cases=[
  "return [1,2,3].values().toArray()",
  "return [1,2,3].values().reduce((sum,value,index)=>sum+value+index,0)",
  "return [1,2,3].values().reduce((sum,value)=>sum+value)",
  "return [1,2,3].values().some(value=>value===2)",
  "return [1,2,3].values().every(value=>value<3)",
  "return [1,2,3].values().find(value=>value===2)",
  "const log=[];const result=[1,2].values().forEach(function(value,index){log.push([value,index,this===undefined])});return [log,result]",
  "const log=[];const it={index:0,next(){log.push('next');return {value:this.index++,done:false}},return(){log.push('return');return {done:true}}};const result=Iterator.prototype.some.call(it,value=>value===1);return [result,log]",
  "const log=[];const it={next(){return {value:1,done:false}},return(){log.push('return');throw 2}};try{Iterator.prototype.forEach.call(it,()=>{throw 1})}catch(error){return [error,log]}",
  "return [Iterator.prototype.toArray.length,Iterator.prototype.reduce.length,Iterator.prototype.find.name]",
  "return [].values().reduce(()=>7,undefined)",
  "try{[].values().reduce(()=>7)}catch(error){return error.name}",
  "return [1,2].values().some(async()=>false)",
  "const it={next(){return {done:true,get value(){throw 1}}}};return Iterator.prototype.toArray.call(it)",
  "const log=[];const source={index:0,get next(){log.push('get');return function(){return {value:this.index++,done:this.index>2}}},[Symbol.iterator](){throw 7}};return [Iterator.prototype.toArray.call(source),log]",
  ...["next","done","value"].map(stage=>"const log=[];const it={next(){"+(stage==='next'?"throw 7":"return {get done(){"+(stage==='done'?"throw 7":"return false")+"},get value(){throw 7}}")+"},return(){log.push('return');return {done:true}}};try{Iterator.prototype.toArray.call(it)}catch(error){return [error,log]}"),
  ...["some","every","find"].map(name=>"const it={next(){return {value:1,done:false}},return(){return 7}};try{Iterator.prototype."+name+".call(it,()=>"+(name==='every'?'false':'true')+")}catch(error){return error.name}")
];

it.each(cases)("implements the standard iterator consumer: %s",async source=>{
  const expected=runInNewContext("(()=>{'use strict';"+source+"})()");
  const result=await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual(expected);
});

it("bounds toArray accumulation",async()=>{
  await expect(run("const it={index:0,next(){return {value:'x'.repeat(1000),done:this.index++===30}}};return Iterator.prototype.toArray.call(it)",
    {budget:new Budget({dataSize:12000})})).rejects.toMatchObject({code:'budgetExceeded',budget:'dataSize'});
});

it("bounds an endless direct iterator by execution steps",async()=>{
  await expect(run("return Iterator.prototype.forEach.call({next(){return {value:1,done:false}}},()=>{})",
    {budget:new Budget({maxSteps:300})})).rejects.toMatchObject({code:'budgetExceeded',budget:'steps'});
});

it("releases consumer roots after completion and callback failure",async()=>{
  const budget=new Budget();
  const realm=createRealm({budget});
  try {
    expect(await realm.evaluate("return [1,2].values().reduce((a,b)=>a+b,0)")).toMatchObject({ok:true,returnValue:3});
    expect([...budget.retainedValues()]).toEqual([]);
    expect(await realm.evaluate("try{[1,2].values().forEach(()=>{throw 7})}catch(error){return error}")).toMatchObject({ok:true,returnValue:7});
    expect([...budget.retainedValues()]).toEqual([]);
  } finally {await realm.close()}
});

// ECMA-262 2025 requires IteratorClose before throwing for an invalid callback.
// Node 22's native implementation does not yet perform this close.
it.each(["reduce","forEach","some","every","find"])("closes before reading next for an invalid %s callback",async name=>{
  const result=await run("const log=[];const it={get next(){log.push('next');throw 1},return(){log.push('return');throw 2}};try{Iterator.prototype."+name+".call(it,null)}catch(error){return [error.name,log]}");
  assert(result.ok);
  expect(result.returnValue).toEqual(['TypeError',['return']]);
});

it("replays consumers after an await with captured callbacks",async()=>{
  const source="const offset=7;const predicate=value=>value>offset;const reducer=(sum,value)=>sum+value+offset;await 0;return [[1,8].values().find(predicate),[1,2].values().reduce(reducer,0),[3,4].values().toArray()]";
  const first=await run(source);
  assert(first.ok);
  expect(first.returnValue).toEqual([8,17,[3,4]]);
  const replay=await run(source,{snapshot:JSON.parse(await dump(first))});
  assert(replay.ok);
  expect(replay.returnValue).toEqual(first.returnValue);
});
