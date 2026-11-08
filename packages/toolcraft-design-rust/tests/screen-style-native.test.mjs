import assert from "node:assert/strict";
import {test} from "node:test";
import * as reference from "../../toolcraft-design/dist/screen/style.js";
const load=()=>import("toolcraft-design-rust/screen/style");

test("screen style root and subpath contracts preserve flags, channels and SGR transitions",async()=>{
  const native=await load(),root=await import("../dist/index.js");
  assert.deepEqual(Object.keys(native),Object.keys(reference));
  for(const name of ["packStyle","styleToSgrDelta"]){assert.equal(root[name],native[name]);assert.equal(native[name].name,reference[name].name);assert.equal(native[name].length,reference[name].length);}
  for(let flags=0;flags<16;flags++)for(const value of [undefined,null,0,1,8,9,11,255,256,-1,1.9,NaN,Infinity,2**40]){
    const options={bold:flags&1,dim:flags&2,underline:flags&4,inverse:flags&8,fg:value,bg:value};
    assert.equal(native.packStyle(options),reference.packStyle(options));
  }
  const styles=[...Array.from({length:16},(_,i)=>i),-1,NaN,Infinity,-Infinity,2**40,0x010100,0x010b00,0xffffff,0x80000000,0xffffffff];
  for(const previous of styles)for(const next of styles)for(const colors of [false,true])assert.equal(native.styleToSgrDelta(previous,next,colors),reference.styleToSgrDelta(previous,next,colors));
  for(const style of [...styles,undefined,null,"1234",true])for(const name of ["foreground","background"])assert.equal(native[name](style),reference[name](style));
});

test("screen style property access and repeated coercions keep their order and failures",async()=>{
  const native=await load();
  function packed(api){const trace=[];const value=new Proxy({bold:1,dim:0,underline:[],inverse:null,fg:{valueOf(){trace.push("fg value");return 257;}},bg:{valueOf(){trace.push("bg value");return -1;}}},{get(target,key){trace.push(key);return target[key];}});return [api.packStyle(value),trace];}
  assert.deepEqual(packed(native),packed(reference));
  function delta(api){let count=0;const trace=[];const value=name=>({valueOf(){trace.push(name);return ++count*257;}});return [api.styleToSgrDelta(value("previous"),value("next"),true),trace];}
  assert.deepEqual(delta(native),delta(reference));
  for(const failure of [{},undefined,null,17,"stop"]){
    for(const api of [reference,native]){
      let caught=false;try{api.styleToSgrDelta({valueOf(){throw failure;}},1,true);}catch(error){caught=true;assert.equal(error,failure);}assert.equal(caught,true);
    }
  }
  for(const api of [reference,native]){const value={valueOf(){throw Error("must remain lazy");}};assert.equal(api.styleToSgrDelta(value,value,true),"");assert.equal(api.styleToSgrDelta(value,0,false),"");}
});

test("screen SGR emission preserves array hooks, deduplication and environment defaults",async()=>{
  const native=await load();
  function run(api){const push=Array.prototype.push;let trace="";try{Array.prototype.push=function(...values){trace+=values.join(",")+"|";return push.apply(this,values);};return [api.styleToSgrDelta(0,0x010b0f,true),trace];}finally{Array.prototype.push=push;}}
  assert.deepEqual(run(native),run(reference));
  const env={NO_COLOR:process.env.NO_COLOR,TERM:process.env.TERM};
  try{for(const [noColor,term] of [[undefined,undefined],["","xterm"],[undefined,"dumb"],[undefined,"xterm"]]){if(noColor===undefined)delete process.env.NO_COLOR;else process.env.NO_COLOR=noColor;if(term===undefined)delete process.env.TERM;else process.env.TERM=term;assert.equal(native.styleToSgrDelta(0,1),reference.styleToSgrDelta(0,1));}}finally{for(const [key,value] of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
