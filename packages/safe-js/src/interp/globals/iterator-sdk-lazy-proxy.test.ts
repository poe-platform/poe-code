import { expect, it } from "vitest";
import { run } from "../../run.js";
import { getSandboxPropertyDescriptor } from "../object-model.js";
import { isSandboxClosure } from "../values.js";

it.each(["map","filter","take","drop","flatMap"].flatMap(method =>
  ["receiver","next","result",...(method==="take"||method==="drop"?[]:["callback"])].map(kind=>({method,kind}))
))("dispatches SDK Iterator $method Proxy $kind", async ({method,kind}) => {
  const callback=method==="map"?"x=>x*2":method==="filter"?"x=>x>0":"x=>{let done=false;return {next(){const result={done,value:x*2};done=true;return result}}}";
  const argument=method==="take"||method==="drop"?"1":kind==="callback"?`new Proxy(${callback},{})`:callback;
  const setup=`let i=0;const next=function(){if(i>3)throw Error("unexpected extra next");const result={done:i===2,value:++i};return ${kind==="result"?"new Proxy(result,{})":"result"}};const raw={next:${kind==="next"?"new Proxy(next,{})":"next"},return(){return {done:true}}};const input=${kind==="receiver"?"new Proxy(raw,{})":"raw"};const argument=${argument};`;
  const native=new Function(`${setup}return Array.from(Iterator.prototype.${method}.call(input,argument))`)();
  const values=(await run(`${setup}return [Iterator.prototype.${method},input,argument]`)).returnValue;
  if (!Array.isArray(values)||!isSandboxClosure(values[0])) throw new Error("Expected SDK helper factory");
  const helper=await values[0].call([values[2]],{stack:[],thisValue:values[1]});
  const next=getSandboxPropertyDescriptor(helper,"next")?.value;
  if (!isSandboxClosure(next)) throw new Error("Expected helper next");
  const output=[];
  for(let index=0;index<5;index++){
    const result=await next.call([],{stack:[],thisValue:helper}) as {done:boolean;value:unknown};
    if(result.done){expect(output).toEqual(native);return;}
    output.push(result.value);
  }
  throw new Error("Helper failed to complete");
});

it.each([false,true])("closes SDK flatMap Proxy iterators in native order after advance=%s", async advance => {
  const setup='const events=[];const inner=new Proxy({next(){events.push("inner next");return {done:false,value:7}},return:new Proxy(function(){events.push(this===inner?"inner return":"wrong receiver");return {done:true}}, {})},{});const outer=new Proxy({next(){events.push("outer next");return {done:false,value:1}},return:new Proxy(function(){events.push(this===outer?"outer return":"wrong receiver");return {done:true}}, {})},{});const mapper=new Proxy(()=>inner,{});';
  const native=new Function(`${setup}const helper=Iterator.prototype.flatMap.call(outer,mapper);${advance?'helper.next();':''}return [helper.return(),events]`)();
  const values=(await run(`${setup}return [Iterator.prototype.flatMap,outer,mapper,events]`)).returnValue;
  if (!Array.isArray(values)||!isSandboxClosure(values[0])) throw new Error("Expected SDK factory");
  const helper=await values[0].call([values[2]],{stack:[],thisValue:values[1]});
  const next=getSandboxPropertyDescriptor(helper,"next")?.value;
  const close=getSandboxPropertyDescriptor(helper,"return")?.value;
  if (!isSandboxClosure(next)||!isSandboxClosure(close)) throw new Error("Expected helper methods");
  if(advance) await next.call([],{stack:[],thisValue:helper});
  expect([await close.call([],{stack:[],thisValue:helper}),values[3]]).toEqual(native);
});
