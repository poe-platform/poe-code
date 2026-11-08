import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/dashboard/composer.js";
const key=(name,flags={})=>({name,ctrl:false,meta:false,shift:false,...flags});

test("composer preserves creation, editing, Unicode boundaries and submission",async()=>{
 const native=await import("toolcraft-design-rust/dashboard/composer");assert.deepEqual(Object.keys(native),Object.keys(original));
 for(const kind of ["message","plan"])for(const after of [undefined,"p1",""])assert.deepEqual(native.createComposerState(kind,after),original.createComposerState(kind,after));
 const events=[key("paste",{ch:"  A👩‍💻éB\r\nnext\x1b[31m row\x1b[0m  "}),key("left"),key("backspace"),key("up"),key("down"),key("home"),key("x",{ch:"x"}),key("right"),key("delete"),key("end"),key("return",{meta:true}),key("paste",{ch:"a b"}),key("w",{ctrl:true}),key("u",{ctrl:true}),key("k",{ctrl:true}),key("return"),key("escape"),key("q",{ch:"q"})];
 for(const kind of ["message","plan"])for(const width of [4,10,Number.MAX_SAFE_INTEGER]){
  let a=native.createComposerState(kind,"p1"),b=original.createComposerState(kind,"p1");
  for(const event of events){const x=native.editComposer(a,event,width),y=original.editComposer(b,event,width);assert.deepEqual(x,y);assert.equal(x.state===a,y.state===b);a=x.state;b=y.state;}
 }
 for(const event of [key("c",{ctrl:true}),key("unknown"),key("tab"),key("return",{shift:true}),key("a",{ctrl:true}),key("e",{ctrl:true}),key("d",{ctrl:true})]){
  const state={...native.createComposerState("message"),text:"\nsecond line",cursor:0};assert.deepEqual(native.editComposer(state,event),original.editComposer({...state},event));
 }
});

test("composer preserves state/event getter order and arbitrary thrown values",async()=>{
 const native=await import("toolcraft-design-rust/dashboard/composer");
 function observe(api){
  const trace=[];
  for(const event of [key("x",{ch:"x"}),key("return"),key("up"),key("w",{ctrl:true}),key("unknown")]){
   const state=new Proxy({...api.createComposerState("message","p1"),text:"one two\nrow",cursor:11,error:"old"},{get(target,name){trace.push(["state",name]);return target[name];},ownKeys(target){trace.push("stateKeys");return Reflect.ownKeys(target);}});
   const input=new Proxy(event,{get(target,name){trace.push(["event",name]);return target[name];}});
   const result=api.editComposer(state,input,5);
   trace.push({state:result.state===state?"same":result.state,handled:result.handled,submit:result.submit});
  }
  const failure={};assert.throws(()=>api.editComposer(api.createComposerState("message"),{get name(){throw failure;}}),error=>error===failure);
  return trace;
 }
 assert.deepEqual(observe(native),observe(original));
});
