import assert from "node:assert/strict";
import {test} from "node:test";
import {withSpinner as original} from "../../toolcraft-design/dist/prompts/index.js";
import {withOutputFormat as originalFormat} from "../../toolcraft-design/dist/internal/output-format.js";
import {withOutputFormat} from "../dist/logging.js";

async function run(factory,scope,{format="terminal",tty=true,noSpinner,elapsed=61234,failAt,overrides},result){
  const trace=[],timers=new Map(),failure={failure:failAt};let time=1000,next=0;
  const saved={interval:globalThis.setInterval,clear:globalThis.clearInterval,now:Date.now,write:Object.getOwnPropertyDescriptor(process.stdout,"write"),tty:Object.getOwnPropertyDescriptor(process.stdout,"isTTY"),env:process.env.POE_NO_SPINNER};
  function record(name,...values){trace.push([name,...values]);if(name===failAt)throw failure;}
  globalThis.setInterval=(fn,delay)=>{record("interval",delay);const id=++next;timers.set(id,fn);return id;};
  globalThis.clearInterval=id=>{record("clear",id);timers.delete(id);};
  Date.now=()=>{record("now",time);return time;};
  Object.defineProperty(process.stdout,"isTTY",{configurable:true,get(){record("tty");return tty;}});
  Object.defineProperty(process.stdout,"write",{configurable:true,get(){record("writer");return function(chunk){record("write",this===process.stdout,chunk);return true;};}});
  if(noSpinner===undefined)delete process.env.POE_NO_SPINNER;else process.env.POE_NO_SPINNER=noSpinner;
  try{
    const options={};
    const values={message:function(){record("message",this===undefined);return "Working";},fn:async function(){record("fn",this===undefined);time+=elapsed;for(const [id,tick]of timers){record("tick",id);tick();}return result;},stopMessage:function(value){record("stopMessage",this===undefined,value===result);return "Finished";},subtext:function(value){record("subtext",this===undefined,value===result);return "first\nsecond\n";}};
    Object.assign(values,overrides);
    for(const key of Object.keys(values))Object.defineProperty(options,key,{get(){record("option",key);return values[key];}});
    const returned=await scope(format,()=>factory(options));record("result",returned===result);
  }catch(error){trace.push(["error",error===failure,error?.name,error?.message]);}
  finally{
    trace.push(["remaining",[...timers.keys()]]);globalThis.setInterval=saved.interval;globalThis.clearInterval=saved.clear;Date.now=saved.now;
    for(const [key,descriptor]of [["write",saved.write],["isTTY",saved.tty]]){if(descriptor)Object.defineProperty(process.stdout,key,descriptor);else delete process.stdout[key];}
    if(saved.env===undefined)delete process.env.POE_NO_SPINNER;else process.env.POE_NO_SPINNER=saved.env;
  }
  return trace;
}

test("withSpinner matches formats, callbacks, elapsed time and cleanup",async()=>{
  const {withSpinner}=await import("../dist/index.js");assert.equal(typeof withSpinner,"function");
  assert.equal(withSpinner,(await import("toolcraft-design-rust/with-spinner")).withSpinner);
  assert.equal(withSpinner.name,original.name);assert.equal(withSpinner.length,original.length);
  const result={};
  for(const format of ["terminal","markdown","json"])for(const tty of [true,false,undefined])for(const noSpinner of [undefined,"1"])for(const elapsed of [0,59999,60000,123456,-1]){
    const options={format,tty,noSpinner,elapsed};assert.deepEqual(await run(withSpinner,withOutputFormat,options,result),await run(original,originalFormat,options,result));
  }
});

test("withSpinner preserves optional callbacks, coercion and unusual elapsed values",async()=>{
  const {withSpinner}=await import("../dist/index.js");
  for(const format of ["terminal","markdown","json"])for(const tty of [true,false]){
    for(const overrides of [
      {message:"Fixed",stopMessage:undefined,subtext:undefined},
      {message:undefined,stopMessage:null,subtext:false},
      {stopMessage:()=>"",subtext:()=>""},
      {stopMessage:()=>0,subtext:()=>0},
      {message:"\x1b[31mColor\x1b[0m\ud800",stopMessage:()=>"\udfff",subtext:()=>"\r\n"},
      {message:()=>({toString(){return "object";}})},
      {stopMessage:()=>({toString(){return "object";}})},
      {stopMessage:1},{subtext:1},{subtext:()=>1},
      {fn:()=>42},{fn:()=>({then(resolve){resolve(42);}})},
      {fn:()=>{throw undefined;}},{fn:()=>Promise.reject(null)}
    ]){
      const options={format,tty,overrides};assert.deepEqual(await run(withSpinner,withOutputFormat,options,42),await run(original,originalFormat,options,42));
    }
    for(const elapsed of [NaN,Infinity,-Infinity]){
      const options={format,tty,elapsed};assert.deepEqual(await run(withSpinner,withOutputFormat,options,42),await run(original,originalFormat,options,42));
    }
  }
});

test("withSpinner preserves failure identity and cleanup ordering",async()=>{
  const {withSpinner}=await import("../dist/index.js");assert.equal(typeof withSpinner,"function");
  for(const format of ["terminal","markdown","json"])for(const tty of [true,false])for(const failAt of ["option","tty","message","interval","fn","stopMessage","subtext","write","now","clear"]){
    const options={format,tty,failAt};assert.deepEqual(await run(withSpinner,withOutputFormat,options,0),await run(original,originalFormat,options,0));
  }
});
