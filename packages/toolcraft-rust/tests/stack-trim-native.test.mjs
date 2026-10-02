import assert from "node:assert/strict";
import test from "node:test";
import * as original from "../../toolcraft/dist/stack-trim.js";

const native=()=>import("../dist/stack-trim.js");
test("stack diagnostics preserve exports, raw identity, causes and frame summaries",async()=>{
  const api=await native();
  assert.deepEqual(Object.keys(api),Object.keys(original));
  for(const name of Object.keys(original)){
    assert.equal(api[name].name,original[name].name);
    assert.equal(api[name].length,original[name].length);
  }
  const frames=["", "    at user (/app/main.ts:1:2)","    at Windows (C:\\app\\node_modules\\toolcraft\\cli.js:1:2)","    at api (/app/node_modules/toolcraft-openapi/index.js:1:2)","    at schema (/app/node_modules/toolcraft-schema/index.js:1:2)","    at parser (/app/node_modules/commander/index.js:1:2)","    at runtime (node:internal/task.js:1:2)","    at local (/app/packages/toolcraft/src/cli.ts:1:2)","    at own (/app/node_modules/toolcraft-rust/index.js:1:2)","\ufeff\u00a0[cause]: Error: inner","𐐀\ud800\udfff"];
  for(let i=0;i<frames.length;i++){
    const stack=["Error: outer",...frames.slice(i),...frames.slice(0,i)].join("\n");
    assert.equal(api.trimStack(stack),original.trimStack(stack));
    for(const mode of ["raw","trim",undefined,"other",new String("raw")])assert.equal(api.formatDebugStack(stack,mode),original.formatDebugStack(stack,mode));
  }
  const value={split(){throw new Error("must not split raw mode");}};
  assert.equal(api.formatDebugStack(value,"raw"),value);
  const boxed=new String("Error: user\n    at app (/app/user.js:1:2)");
  assert.equal(api.trimStack(boxed),boxed);
  assert.equal(api.trimStack(""),"");
});

test("stack diagnostics preserve host method order, receivers and iterator cleanup",async()=>{
  const api=await native();
  function run(module,failAt){
    const trace=[],failure={failAt};
    function line(name,hidden,cause){
      const value={
        trimStart(){assert.equal(this,value);trace.push(["trim",name]);if(failAt===`cause:${name}`)throw failure;return {startsWith(prefix){trace.push(["cause",name,prefix]);return cause;}};},
        replaceAll(from,to){assert.equal(this,value);trace.push(["replace",name,from,to]);return {includes(pattern){trace.push(["includes",name,pattern]);if(failAt===name)throw failure;return hidden&&pattern==="node_modules/commander/";}};},
        toString(){trace.push(["string",name]);return name;}
      };return value;
    }
    const first=line("first",false,false),second=line("hidden",true,false),cause=line("cause",false,true),last=line("last",false,false);
    const lines={0:"Error",slice(start){assert.equal(this,lines);trace.push(["slice",start]);return { *[Symbol.iterator](){try{yield first;yield second;yield cause;yield last;}finally{trace.push("iterator closed");}}};}};
    const stack={split(separator){assert.equal(this,stack);trace.push(["split",separator]);return lines;}};
    try{const value=module.trimStack(stack);return {trace,value};}
    catch(error){assert.equal(error,failure);return {trace,error:"same failure"};}
  }
  for(const failAt of [undefined,"first","hidden","last","cause:first","cause:last"])assert.deepEqual(run(api,failAt),run(original,failAt));
});

test("stack diagnostics preserve split failures and malformed values",async()=>{
  const api=await native();
  for(const value of [null,undefined,1,{}, {split:3},{split(){return [];}}]){
    const run=module=>{try{return {value:module.trimStack(value)};}catch(error){return {name:error.name,message:error.message};}};
    assert.deepEqual(run(api),run(original));
  }
  const failure={reason:"split"},value={get split(){throw failure;}};
  assert.throws(()=>api.trimStack(value),error=>error===failure);
  for(const failure of [undefined,null,false,17,Symbol("failure")]){
    assert.throws(()=>api.trimStack({split(){throw failure;}}),error=>error===failure);
  }
});

test("stack diagnostics retain callback metadata, live array methods and reentrancy",async()=>{
  const api=await native();
  function run(module){
    const trace=[],marker="Error: callback fixture";
    const originalMap=Array.prototype.map,originalReduce=Array.prototype.reduce;
    Array.prototype.map=function(callback,...args){
      if(this[0]?.header===marker){trace.push(["map",callback.name,callback.length]);const inner=module.trimStack("Inner\n at node:internal/inner");trace.push(["inner",inner]);}
      return Reflect.apply(originalMap,this,[callback,...args]);
    };
    Array.prototype.reduce=function(callback,...args){
      if(this[0]?.hiddenFrameCount===1){trace.push(["reduce",callback.name,callback.length,...args]);}
      return Reflect.apply(originalReduce,this,[callback,...args]);
    };
    try{return {value:module.trimStack(`${marker}\n    at app\n    at node:internal/hidden`),trace};}
    finally{Array.prototype.map=originalMap;Array.prototype.reduce=originalReduce;}
  }
  assert.deepEqual(run(api),run(original));
});

test("source map activation preserves optional access and process receiver",async()=>{
  const api=await native(),descriptor=Object.getOwnPropertyDescriptor(process,"setSourceMapsEnabled");
  function run(module,kind){
    const trace=[],failure={kind};
    Object.defineProperty(process,"setSourceMapsEnabled",{configurable:true,get(){trace.push("get");if(kind==="getter")throw failure;if(kind==="missing")return undefined;if(kind==="null")return null;if(kind==="nonfunction")return 3;return function(enabled){trace.push(["call",this===process,enabled]);if(kind==="throw")throw failure;};}});
    try{trace.push(["result",module.enableSourceMaps()]);}
    catch(error){trace.push(error===failure?"same failure":[error.name,error.message]);}
    finally{Object.defineProperty(process,"setSourceMapsEnabled",descriptor);}
    return trace;
  }
  for(const kind of ["present","missing","null","nonfunction","getter","throw"])assert.deepEqual(run(api,kind),run(original,kind));
});
