import assert from "node:assert/strict";
import {test} from "node:test";
import {createFrameWriter as original} from "../../toolcraft-design/dist/terminal/output.js";
const load=async()=>(await import("toolcraft-design-rust/terminal/output")).createFrameWriter;

function withProcess(callback){
  const saved={once:process.once,removeListener:process.removeListener,kill:process.kill},trace=[],listeners=new Map();
  process.once=function(name,listener){trace.push(["once",name,listener.name]);listeners.set(name,listener);return this;};
  process.removeListener=function(name,listener){trace.push(["remove",name,listener.name]);if(listeners.get(name)===listener)listeners.delete(name);return this;};
  process.kill=(pid,signal)=>{assert.equal(pid,process.pid);trace.push(["kill",signal]);return true;};
  try{return callback(trace,listeners);}finally{Object.assign(process,saved);}
}
test("Frame writer preserves modes, idempotency, option getters and frame coercion",async()=>{
  const create=await load();assert.equal(create.name,original.name);assert.equal(create.length,original.length);
  function run(factory,mouse){return withProcess(trace=>{
    const writer=factory({get write(){trace.push("write getter");return function(value){trace.push(["write",value]);return false;};}},{get mouse(){trace.push("mouse");return mouse;}});
    const shape=Object.entries(writer).map(([key,value])=>[key,value.name,value.length]);
    writer.writeFrame({get length(){throw new Error("closed");}});writer.close();writer.open();writer.open();writer.writeFrame("");writer.writeFrame("frame");writer.writeFrame({get length(){trace.push("length");return 1;},[Symbol.toPrimitive](hint){trace.push(hint);return "coerced";}});writer.close();writer.close();writer.open();writer.close();return [shape,trace];
  });}
  for(const mouse of [undefined,true,false,0])assert.deepEqual(run(create,mouse),run(original,mouse));
});
test("Frame writer preserves signal and fatal-error cleanup",async()=>{
  const create=await load();
  for(const event of ["SIGINT","SIGTERM","uncaughtException"]){function run(factory){return withProcess((trace,listeners)=>{const writer=factory({write(value){trace.push(["write",value]);return true;}});writer.open();const failure={};try{listeners.get(event)(failure);}catch(error){assert.equal(event,"uncaughtException");assert.equal(error,failure);trace.push("caught");}writer.close();return trace;});}assert.deepEqual(run(create),run(original));}
});
test("Frame writer keeps state across write failures and reentrant closes",async()=>{
  const create=await load();
  function run(factory){return withProcess(trace=>{const failure={};let throws=true,reenter=false,writer;writer=factory({write(value){trace.push(value);if(throws){throws=false;throw failure;}if(reenter){reenter=false;writer.close();}return true;}});try{writer.open();}catch(error){assert.equal(error,failure);}writer.open();writer.close();reenter=true;writer.open();writer.writeFrame("closed");writer.close();return trace;});}
  assert.deepEqual(run(create),run(original));
});
