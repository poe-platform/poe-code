import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/dashboard/store.js";

test("dashboard store preserves bounded keyed output, snapshots and identity",async()=>{
 const native=await import("toolcraft-design-rust/dashboard/store");
 assert.deepEqual(Object.keys(native),Object.keys(original));
 function observe(api){
  const store=api.createStore(),initial=store.getState(),output=initial.output,stats=initial.stats;
  assert.deepEqual(Object.keys(store),["getState","appendOutput","updateStats","onChange"]);
  for(const [name,fn] of Object.entries(store)){assert.equal(fn.name,name);assert.equal(Object.hasOwn(fn,"prototype"),true);}
  assert.equal(new store.getState(),initial);
  const first={id:"a",kind:"info",text:"first",ts:1};store.appendOutput(first);
  assert.equal(store.getState().output[0],first);assert.equal(initial.output,output);assert.equal(store.getState().stats,stats);
  const held=store.getState().output;
  for(let i=0;i<270;i++)store.appendOutput({id:String(i),kind:"tool",text:i===269?"x".repeat(20000)+"LATEST":"line "+i,ts:i,detail:i===269?"d".repeat(20000)+"DETAIL":undefined});
  store.appendOutput({id:"269",kind:"tool",text:"updated",ts:300});
  store.updateStats({status:"running",tokensIn:15});
  assert.equal(held[0],first);assert.equal(held.length,1);assert.equal(initial.stats.status,"idle");
  return store.getState();
 }
 assert.deepEqual(observe(native),observe(original));
});

test("store listeners preserve live iteration, reentrancy, unsubscribe and thrown identity",async()=>{
 const native=await import("toolcraft-design-rust/dashboard/store");
 function observe(api){
  const store=api.createStore(),trace=[];let nested=false;
  const late=()=>trace.push(["late",store.getState().stats.iterations]);
  const off=store.onChange(()=>{trace.push(["first",store.getState().stats.iterations]);if(!nested){nested=true;store.onChange(late);store.updateStats({iterations:2});}});
  store.updateStats({iterations:1});off();store.appendOutput({kind:"info",text:"line",ts:0});
  const failure={};const remove=store.onChange(()=>{throw failure;});
  assert.throws(()=>store.updateStats({iterations:3}),e=>e===failure);assert.equal(store.getState().stats.iterations,3);remove();
  store.updateStats({iterations:4});return trace;
 }
 assert.deepEqual(observe(native),observe(original));
});

test("store retains getter order and reentrant state during matching and spreads",async()=>{
 const native=await import("toolcraft-design-rust/dashboard/store");
 function observe(api){
  const store=api.createStore(),trace=[];
  store.appendOutput({id:"a",kind:"info",text:"start",ts:0});
  let reentered=false;
  const item=new Proxy({id:"a",kind:"info",text:"updated",detail:undefined,ts:1},{get(target,key){trace.push(["item",key]);if(key==="id"&&!reentered){reentered=true;store.updateStats({iterations:1});}return target[key];},ownKeys(target){trace.push("itemKeys");return Reflect.ownKeys(target);}});
  store.appendOutput(item);
  const state=store.getState();Object.defineProperty(state,"extra",{enumerable:true,get(){trace.push("state.extra");return 42;}});
  const partial=new Proxy({tokensOut:9},{ownKeys(target){trace.push("partialKeys");return Reflect.ownKeys(target);},get(target,key){trace.push(["partial",key]);return target[key];}});
  store.updateStats(partial);
  const final=store.getState();return [trace,final.stats,final.extra,final.output.length];
 }
 assert.deepEqual(observe(native),observe(original));
});
