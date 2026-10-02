import assert from "node:assert/strict";
import {test} from "node:test";
import {createInputParser as original} from "../../toolcraft-design/dist/terminal/input.js";
const load=async()=>(await import("toolcraft-design-rust/terminal/input")).createInputParser;
function clock(run){const saved={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout},timers=new Map(),trace=[];let next=0;
  globalThis.setTimeout=(fn,delay)=>{const id=++next;timers.set(id,fn);trace.push(["arm",id,delay]);return id;};
  globalThis.clearTimeout=id=>{trace.push(["clear",id]);timers.delete(id);};
  try{return run({trace,fire(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}}});}finally{Object.assign(globalThis,saved);}
}

test("Input parser preserves every byte split, malformed UTF-8, control and mouse events",async()=>{
  const create=await load();assert.equal(create.name,original.name);assert.equal(create.length,original.length);
  const inputs=["aA hé🙂\x03\x00\x1f\x7f","\x1b\x1b[B","\x1b\r\x1b[3~","\x1b[200~a\n\x1b[31m🙂\x1b[201~","\x1b[<64;12;4M\x1b[<65;.5;-2m","\x1bOA\x1bOB\x1bOH\x1bOF\x1bOZ","\x1b[6~\x1b[8~\x1b[99~","\x1b\x03\x1ba\x1b🙂",...Array.from({length:10},(_,n)=>`\x1b[1;${n}A`)].map(text=>Buffer.from(text));
  inputs.push(Buffer.from([0x80,0x61,0xc0,0xaf,0xf5,0x80,0x80,0x80,0xed,0xa0,0x80,0xff,1,2,3]));
  function run(factory,bytes,split){return clock(({trace,fire})=>{const parser=factory(),events=[];events.push(...parser.feed(bytes.subarray(0,split)),...parser.feed(bytes.subarray(split)));fire();events.push(...parser.flush());parser.destroy();return [events,trace,Object.entries(parser).map(([k,v])=>[k,v.name,v.length])];});}
  for(const bytes of inputs)for(let split=0;split<=bytes.length;split++)assert.deepEqual(run(create,bytes,split),run(original,bytes,split),`${bytes.toString("hex")} at ${split}`);
});

test("Input parser retains timer callbacks, getter order, receiver and destroy state",async()=>{
  const create=await load();
  function run(factory,callback){return clock(({trace,fire})=>{const options={get escTimeoutMs(){trace.push("timeout getter");return 7;},get onEvent(){trace.push("event getter");return callback?function(event){assert.equal(this,options);trace.push(event);}:undefined;}};
    const parser=factory(options),output=[];output.push(parser.feed(Buffer.from("\x1b\x1b")),parser.flush());fire();output.push(parser.flush());output.push(parser.feed(Buffer.from("\x1b")),parser.feed(Buffer.from("a")));fire();output.push(parser.feed(Buffer.from("\x1b[200~partial")));parser.destroy();output.push(parser.feed(Buffer.from("after\x1b[201~")),parser.flush());parser.destroy();return [output,trace];});}
  for(const callback of [false,true])assert.deepEqual(run(create,callback),run(original,callback));
});

test("Input parser preserves thrown callbacks and reentrant event delivery",async()=>{
  const create=await load();
  for(const failure of [undefined,null,{},"stop"]){function run(factory){return clock(({trace,fire})=>{let parser;parser=factory({onEvent(event){trace.push(event);trace.push(parser.feed(Buffer.from("X")));throw failure;}});parser.feed(Buffer.from("\x1b\x1b"));let caught=false;try{fire();}catch(error){caught=true;assert.equal(error,failure);}assert.equal(caught,true);trace.push(parser.flush());parser.destroy();return trace;});}assert.deepEqual(run(create),run(original));}
});

test("Input timeout preserves callback lookup failures",async()=>{
  const create=await load();
  function run(factory){return clock(({trace,fire})=>{let reads=0;const parser=factory({get onEvent(){trace.push(++reads);return reads===1?()=>{}:undefined;}});parser.feed(Buffer.from("\x1b"));let error;try{fire();}catch(caught){error=[caught.name,caught.message];}parser.destroy();return [error,trace];});}
  assert.deepEqual(run(create),run(original));
});
