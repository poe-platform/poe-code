import assert from "node:assert/strict";
import {test} from "node:test";
import {openExternal as original} from "../../toolcraft-design/dist/components/browser.js";
const load=async()=>(await import("toolcraft-design-rust/open-external")).openExternal;

test("browser launch preserves URL normalization, platform selection and child lifecycle",async()=>{
  const open=await load();assert.equal(open,(await import("../dist/index.js")).openExternal);
  assert.equal(open,(await import("toolcraft-design-rust/components/browser")).openExternal);
  assert.equal(open.name,original.name);assert.equal(open.length,original.length);
  for(const platform of ["darwin","win32","linux",undefined,null,"unknown",new String("darwin"),1,Symbol("darwin")]){
    for(const code of [0,-0,1,undefined,null,"0",false,1n]){
      async function run(fn){const trace=[],listeners=new Map();
        const options={get platform(){trace.push("platform");return platform;},get spawnProcess(){trace.push("spawn getter");return function(command,args,opts){trace.push(["spawn",this,command,args,opts]);return {once(event,callback){trace.push(["once",event]);listeners.set(event,callback);return this;},unref(){trace.push("unref");}};};}};
        const promise=fn("https://EXAMPLE.test/a b?q=hello world",options);
        trace.push("returned");listeners.get("close")(code,"SIGTERM");
        try{trace.push(["result",await promise]);}catch(error){trace.push(["error",error.constructor.name,error.message]);}
        return trace;
      }
      assert.deepEqual(await run(open),await run(original));
    }
  }
});

test("browser launch rejects invalid URLs and preserves process error identity",async()=>{
  const open=await load();
  for(const url of ["",undefined,null,"not a URL",Symbol("url")]){
    const run=async fn=>{const trace=[];const options={get platform(){trace.push("platform");throw new Error("should not read");}};try{await fn(url,options);}catch(error){trace.push([error.name,error.message]);}return trace;};
    assert.deepEqual(await run(open),await run(original));
  }
  const failure={};
  for(const event of ["spawn","error","once"]){
    for(const fn of [open,original]){
      const options={spawnProcess(){if(event==="spawn")throw failure;return {once(name,callback){if(event==="once")throw failure;if(name==="error")callback(failure);return this;},unref(){}};}};
      await assert.rejects(fn("https://example.test",options),error=>error===failure);
    }
  }
  async function run(fn){const trace=[],listeners=new Map();const promise=fn("https://example.test",{platform:"linux",spawnProcess(){return {once(event,callback){listeners.set(event,callback);return this;},unref(){trace.push("unref");}};}});listeners.get("error")(failure);listeners.get("close")(0,null);try{await promise;}catch(error){assert.equal(error,failure);trace.push("rejected");}return trace;}
  assert.deepEqual(await run(open),await run(original));
});
