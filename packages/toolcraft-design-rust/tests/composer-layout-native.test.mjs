import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/dashboard/composer-layout.js";

test("composer layout preserves wrapping, UTF-16 offsets and end carets",async()=>{
 const native=await import("toolcraft-design-rust/dashboard/composer-layout");
 assert.deepEqual(Object.keys(native),Object.keys(original));
 for(const text of ["","abc","abcd","ab\ncd","a\tb","界👩‍💻é","\n\n","a\r\nb","\t\t"])for(const width of [-1,0,1,2,3,4,5,10,Infinity,NaN])for(let cursor=0;cursor<=text.length+1;cursor++){
  const a={kind:"message",text,cursor,focused:true},b={...a};
  assert.deepEqual(native.layoutComposer(a,width),original.layoutComposer(b,width),JSON.stringify({text,width,cursor}));
 }
});

test("composer layout caches by state identity, live text, cursor and normalized width",async()=>{
 const native=await import("toolcraft-design-rust/dashboard/composer-layout");
 function observe(api){
  const state={kind:"message",text:"abcdef",cursor:6,focused:true};const first=api.layoutComposer(state,3);
  assert.equal(api.layoutComposer(state,3),first);first.lines[0]="changed";assert.equal(api.layoutComposer(state,3).lines[0],"changed");
  assert.notEqual(api.layoutComposer({...state},3),first);
  state.cursor=1;const second=api.layoutComposer(state,3);assert.notEqual(second,first);
  state.text="xy";const third=api.layoutComposer(state,3);assert.notEqual(third,second);
  const narrow=api.layoutComposer(state,0);assert.equal(api.layoutComposer(state,-1),narrow);
  const nan=api.layoutComposer(state,NaN);assert.notEqual(api.layoutComposer(state,NaN),nan);
  return [second,third,narrow,nan];
 }
 assert.deepEqual(observe(native),observe(original));
});

test("composer layout preserves getter order, width coercion and thrown identity",async()=>{
 const native=await import("toolcraft-design-rust/dashboard/composer-layout");
 function observe(api){
  const trace=[];const state=new Proxy({text:"ab界\nxy",cursor:5},{get(target,key){trace.push(key);return target[key];}});
  const width={valueOf(){trace.push("width");return 3;}};
  const first=api.layoutComposer(state,width);assert.equal(api.layoutComposer(state,width),first);
  const failure={};assert.throws(()=>api.layoutComposer({get text(){throw failure;}},4),e=>e===failure);
  return [first,trace];
 }
 assert.deepEqual(observe(native),observe(original));
});
