import assert from "node:assert/strict";
import {test} from "node:test";
import {note as original} from "../../toolcraft-design/dist/prompts/primitives/note.js";
import {withOutputFormat as originalFormat} from "../../toolcraft-design/dist/internal/output-format.js";
import {withOutputFormat} from "../dist/logging.js";
const load=async()=>(await import("toolcraft-design-rust/note")).note;

test("note matches reference bytes, UTF-16 widths and format scoping",async()=>{
  const note=await load();
  assert.equal(note,(await import("../dist/index.js")).note);
  assert.equal(note.name,original.name);assert.equal(note.length,original.length);
  const oldForce=process.env.FORCE_COLOR,oldNo=process.env.NO_COLOR;
  try{
    delete process.env.NO_COLOR;
    for(const color of ["0","1"]){process.env.FORCE_COLOR=color;
      for(const format of ["terminal","markdown","json"]){
        for(const message of ["","one\ntwo\n","\x1b[31mred\x1b[0m\r\nline","界🙂e\u0301\ud800","\x1b]8;;https://example.test\x07link\x1b]8;;\x07"]){
          for(const title of [undefined,null,"","Title\r\nwith\nlines\r","\x1b[32m界🙂\x1b[0m","\udfff"]){
            const run=(fn,scope)=>{const trace=[];const result=scope(format,()=>fn(message,title,function(chunk){assert.equal(this,undefined);trace.push(chunk);return 123;}));assert.equal(result,undefined);return trace;};
            assert.deepEqual(run(note,withOutputFormat),run(original,originalFormat));
          }
        }
      }
    }
  }finally{for(const [key,value] of [["FORCE_COLOR",oldForce],["NO_COLOR",oldNo]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test("note preserves writer binding, thrown identity, reentrancy and invalid values",async()=>{
  const note=await load();
  for(const format of ["terminal","markdown","json"]){
    for(const value of [undefined,null,1,false,1n,Symbol("note"),{},["a"],new String("boxed")]){
      const run=(fn,scope)=>{const trace=[];try{scope(format,()=>fn(value,"title",chunk=>trace.push(chunk)));}catch(error){trace.push([error.constructor.name,error.message]);}return trace;};
      assert.deepEqual(run(note,withOutputFormat),run(original,originalFormat));
    }
    const failure={};assert.throws(()=>withOutputFormat(format,()=>note("hello",undefined,()=>{throw failure;})),error=>error===failure);
    const run=(fn,scope)=>{const trace=[];scope(format,()=>fn("outer","title",chunk=>{trace.push(chunk);scope("json",()=>fn("inner",undefined,chunk=>trace.push(chunk)));}));return trace;};
    assert.deepEqual(run(note,withOutputFormat),run(original,originalFormat));
  }
  const run=(fn,scope)=>{
    const saved=Object.getOwnPropertyDescriptor(process.stdout,"write"),trace=[];
    Object.defineProperty(process.stdout,"write",{configurable:true,get(){trace.push("write getter");return function(chunk){trace.push([this===process.stdout,chunk]);return true;};}});
    try{scope("json",()=>fn("body"));}finally{if(saved)Object.defineProperty(process.stdout,"write",saved);else delete process.stdout.write;}
    return trace;
  };
  assert.deepEqual(run(note,withOutputFormat),run(original,originalFormat));
});

test("note preserves custom split iteration, color access and coercion order",async()=>{
  const note=await load();
  const {color:nativeColor}=await import("../dist/color.js");
  const {color:referenceColor}=await import("../../toolcraft-design/dist/components/color.js");
  function run(fn,colors,scope){
    const trace=[],saved=new Map(["gray","green","reset"].map(key=>[key,Object.getOwnPropertyDescriptor(colors,key)]));
    for(const key of saved.keys())Object.defineProperty(colors,key,{configurable:true,get(){trace.push(key);return value=>{trace.push([key,String(value)]);return String(value);};}});
    const line={get length(){trace.push("line length");return 0;},toString(){trace.push("line coercion");return "line";}};
    const message={get length(){trace.push("message length");return 0;},get split(){trace.push("split getter");return function(separator){trace.push(["split call",this===message,separator]);return {[Symbol.iterator]:function*(){trace.push("iterate");yield line;}};};}};
    try{scope("terminal",()=>fn(message,"title",chunk=>trace.push(["output",chunk])));}finally{for(const [key,descriptor]of saved)Object.defineProperty(colors,key,descriptor);}
    return trace;
  }
  assert.deepEqual(run(note,nativeColor,withOutputFormat),run(original,referenceColor,originalFormat));
});
