import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/prompts/index.js";
import {withOutputFormat as originalFormat} from "../../toolcraft-design/dist/internal/output-format.js";
import {withOutputFormat} from "../dist/logging.js";
const load=()=>import("../dist/prompt-output.js");
function capture(fn,scope,format,action){
  const trace=[],saved=Object.getOwnPropertyDescriptor(process.stdout,"write");
  Object.defineProperty(process.stdout,"write",{configurable:true,get(){trace.push("writer");return function(chunk){trace.push([this===process.stdout,chunk]);return true;};}});
  try{scope(format,()=>action(fn,trace));}catch(error){trace.push([error.constructor.name,error.message]);}
  finally{if(saved)Object.defineProperty(process.stdout,"write",saved);else delete process.stdout.write;}
  return trace;
}

test("prompt output matches terminal, Markdown and JSON reference bytes",async()=>{
  const native=await load(),root=await import("../dist/index.js");
  for(const name of ["intro","introPlain","outro","cancel"]){assert.equal(native[name],root[name]);assert.equal(native[name].name,original[name].name);assert.equal(native[name].length,original[name].length);}
  assert.equal(native.log,root.log);assert.deepEqual(Object.keys(native.log),Object.keys(original.log));
  const savedForce=process.env.FORCE_COLOR,savedNo=process.env.NO_COLOR;
  try{delete process.env.NO_COLOR;
    for(const color of ["0","1"]){process.env.FORCE_COLOR=color;
      for(const format of ["terminal","markdown","json"]){
        for(const value of ["","Hello","one\r\ntwo\nthree\r","\x1b[31mcolor\x1b[0m","界🙂e\u0301\ud800",undefined,null,1,false,Symbol("value"),new String("boxed")]){
          for(const name of ["intro","introPlain","outro","cancel"]){const action=(api,trace)=>trace.push(["result",api[name](value)]);assert.deepEqual(capture(native,withOutputFormat,format,action),capture(original,originalFormat,format,action),`${name}/${format}`);}
          for(const name of Object.keys(original.log)){const action=(api,trace)=>trace.push(["result",api.log[name](value)]);assert.deepEqual(capture(native,withOutputFormat,format,action),capture(original,originalFormat,format,action),`log.${name}/${format}`);}
        }
      }
    }
  }finally{for(const [key,value] of [["FORCE_COLOR",savedForce],["NO_COLOR",savedNo]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test("prompt log retains option reads, spacing, blank lines and coercion order",async()=>{
  const native=await load();
  for(const format of ["terminal","markdown","json"]){
    for(const options of [undefined,null,{}, {spacing:0}, {spacing:2.5,symbol:"!",secondarySymbol:"+"}, {withGuide:false}, {withGuide:0,spacing:-1,symbol:"",secondarySymbol:null}]){
      const action=(api,trace)=>trace.push(["result",api.log.message("\nfirst\n\nlast\n",options)]);
      assert.deepEqual(capture(native,withOutputFormat,format,action),capture(original,originalFormat,format,action));
    }
    const action=(api,trace)=>{
      const options=Object.fromEntries(["symbol","secondarySymbol","spacing","withGuide"].map(key=>[key,undefined]));
      for(const key of Object.keys(options))Object.defineProperty(options,key,{get(){trace.push(key);return key==="spacing"?{valueOf(){trace.push("spacing coerce");return 2;}}:undefined;}});
      api.log.message("one\n\ntwo",options);
    };
    assert.deepEqual(capture(native,withOutputFormat,format,action),capture(original,originalFormat,format,action));
  }
});

test("prompt output preserves custom string effects and writer failure identity",async()=>{
  const native=await load();
  for(const name of ["intro","introPlain","outro","cancel"]){
    const action=(api,trace)=>api[name]({get length(){trace.push("length");return 0;},toString(){trace.push("coerce");return "title";}});
    assert.deepEqual(capture(native,withOutputFormat,"terminal",action),capture(original,originalFormat,"terminal",action));
  }
  const failure={},saved=process.stdout.write;
  process.stdout.write=()=>{throw failure;};
  try{for(const format of ["terminal","markdown","json"]){for(const api of [native,original]){const scope=api===native?withOutputFormat:originalFormat;assert.throws(()=>scope(format,()=>api.log.message("message")),error=>error===failure);}}}finally{process.stdout.write=saved;}
});

test("prompt logs preserve split iterator effects and cancellation identity",async()=>{
  const native=await load();
  for(const empty of [true,false]){
    const action=(api,trace)=>{
      const line={get length(){trace.push("line length");return 1;},toString(){trace.push("line coerce");return "line";}};
      const msg={split(separator){trace.push(["split",separator]);return {get length(){trace.push("content length");return empty?0:3;},*[Symbol.iterator](){trace.push("iterator");yield undefined;yield "";yield line;}};}};
      api.log.message(msg,{symbol:"!",secondarySymbol:"+",spacing:2});
    };
    assert.deepEqual(capture(native,withOutputFormat,"terminal",action),capture(original,originalFormat,"terminal",action));
  }
  const root=await import("../dist/index.js"),{CANCEL,isCancel}=await import("toolcraft-design-rust/prompts/interactive/cancel-symbol");
  assert.equal(isCancel,root.isCancel);assert.equal(isCancel,(await import("toolcraft-design-rust/is-cancel")).isCancel);
  assert.equal(isCancel,(await import("toolcraft-design-rust/prompts/primitives/cancel")).isCancel);
  assert.equal(CANCEL,Symbol.for("poe.cancel"));
  for(const value of [CANCEL,Symbol("poe.cancel"),Object(CANCEL),null,undefined,false,0,"poe.cancel"]){assert.equal(isCancel(value),original.isCancel(value));}
  for(const [subpath,name] of [["intro","intro"],["intro-plain","introPlain"],["outro","outro"],["cancel","cancel"],["log","log"]])assert.equal((await import(`toolcraft-design-rust/${subpath}`))[name],root[name]);
});
