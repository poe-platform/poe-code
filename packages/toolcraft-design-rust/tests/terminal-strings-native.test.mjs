import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/dashboard/terminal-strings.js";

test("terminal string subpath preserves exports, descriptors and the existing stream filter",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/terminal-strings");
  const preview=await import("../dist/output-preview.js");
  assert.deepEqual(Object.keys(native),Object.keys(original));
  assert.equal(native.createTerminalStringFilter,preview.createTerminalStringFilter);
  for(const key of Object.keys(original)){
    assert.equal(native[key].name,original[key].name);
    assert.equal(native[key].length,original[key].length);
    const a=Object.getOwnPropertyDescriptor(native,key),b=Object.getOwnPropertyDescriptor(original,key);
    assert.deepEqual({...a,value:typeof a.value},{...b,value:typeof b.value});
  }
});

test("terminal tail boundaries match UTF-16, incomplete controls and numeric boundaries",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/terminal-strings");
  const samples=["","plain","a\x1b[31mred\x1b[0m", "a\u009b0;31mred", "a\x1b[123", "\x1b", "a\x1bzrest", "\x1b[3🌍1mred", "\ud800\x1b[1m\udfff"];
  for(const text of samples)
    for(const start of [-Infinity,-3,-0,0,0.5,1,1.5,2,3,4,5,8,16,text.length,text.length+1,NaN,undefined,null,"3",3n])
      for(const input of [text,Object(text)])
        assert.equal(native.terminalControlTailStart(input,start),original.terminalControlTailStart(input,start),`${JSON.stringify(text)}/${String(start)}`);
  for(const start of [Symbol("identity"),{},()=>{},Infinity])assert.equal(native.terminalControlTailStart("plain",start),start);
});

test("terminal tail preserves property order, repeated coercion and live numeric methods",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/terminal-strings");
  function trace(api,changing){
    const events=[];let coercions=0;
    const value="a\x1b[31mZ",text=new Proxy({
      includes(control){events.push(["includes",control,this===text]);return value.includes(control);},
      charCodeAt(index){events.push(["charCodeAt",index,this===text]);return {[Symbol.toPrimitive](hint){events.push(["code",hint]);return value.charCodeAt(index);}};},
      get length(){events.push("length");return value.length;}
    },{get(target,key,receiver){events.push(["get",String(key)]);return typeof key==="string"&&key!==""&&String(Number(key))===key?value[key]:Reflect.get(target,key,receiver);}});
    const start={[Symbol.toPrimitive](hint){events.push(["start",hint]);coercions++;return changing&&coercions===4?2:4;}};
    const saved=Math.min;
    Math.min=function(...values){events.push(["min",...values,this===Math]);return Reflect.apply(saved,this,values);};
    try{const result=api.terminalControlTailStart(text,start);return {events,result:result===start?"same start":result};}
    finally{Math.min=saved;}
  }
  for(const changing of [false,true])assert.deepEqual(trace(native,changing),trace(original,changing));
});

test("terminal tail observes patched string methods and Math.min getters in reference order",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/terminal-strings");
  function run(api){
    const events=[],code=String.prototype.charCodeAt,minimum=Object.getOwnPropertyDescriptor(Math,"min");
    String.prototype.charCodeAt=function(index){events.push(["code",String(this),index]);return index<5?0:code.call(this,index);};
    Object.defineProperty(Math,"min",{configurable:true,get(){events.push("min getter");return function(...args){events.push(["min call",this===Math,...args]);return minimum.value(...args);};}});
    try{return {result:api.terminalControlTailStart("\x1b[1mtext",2),events};}
    finally{String.prototype.charCodeAt=code;Object.defineProperty(Math,"min",minimum);}
  }
  assert.deepEqual(run(native),run(original));
});

test("terminal tail retains malformed-input diagnostics, thrown values and reentrancy",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/terminal-strings");
  function failure(api,text,start){try{return {value:api.terminalControlTailStart(text,start)};}catch(error){return {error:[error.constructor.name,error.message]};}}
  for(const text of [null,undefined,{},42])assert.deepEqual(failure(native,text,1),failure(original,text,1));
  assert.deepEqual(failure(native,"\x1b[31m",Symbol("start")),failure(original,"\x1b[31m",Symbol("start")));
  const reason={reason:true};
  for(const api of [native,original]){
    assert.throws(()=>api.terminalControlTailStart({includes(){throw reason;}},1),error=>error===reason);
    assert.throws(()=>api.terminalControlTailStart("\x1b[31m",{valueOf(){throw reason;}}),error=>error===reason);
    assert.throws(()=>api.terminalControlTailStart({includes(){return true;},0:"\x1b",1:"[",length:4,charCodeAt(){throw reason;}},1),error=>error===reason);
  }
  function run(api){
    const results=[],text={includes(){return true;},get 0(){results.push(api.terminalControlTailStart("x\x1b[31m",3));return "\x1b";},1:"[",length:4,charCodeAt(index){return "\x1b[1m".charCodeAt(index);}};
    results.push(api.terminalControlTailStart(text,2));return results;
  }
  assert.deepEqual(run(native),run(original));
});
