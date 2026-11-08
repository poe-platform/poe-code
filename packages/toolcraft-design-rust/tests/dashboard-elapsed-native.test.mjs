import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/dashboard/elapsed.js";

test("elapsed formatting preserves invalid inputs, second boundaries and large numeric hours",async()=>{
 const native=await import("toolcraft-design-rust/dashboard/elapsed");
 assert.deepEqual(Object.keys(native),Object.keys(original));assert.equal(native.formatElapsed.length,original.formatElapsed.length);
 for(const ms of [-Infinity,Infinity,NaN,-0,-1,0,999,1000,1999,59999,60000,3599999,3600000,90061000,Number.MAX_SAFE_INTEGER,1e27,1e100,Number.MAX_VALUE,undefined,null,"1000",1000n,{},new Number(1000)])assert.equal(native.formatElapsed(ms),original.formatElapsed(ms),String(ms));
});

test("elapsed formatting preserves observable Math order and thrown values",async()=>{
 const native=await import("toolcraft-design-rust/dashboard/elapsed");
 function observe(api){
  const trace=[],floor=Math.floor,max=Math.max,isFinite=Number.isFinite;
  try{
   Number.isFinite=value=>{trace.push(["finite",value]);return isFinite(value);};
   Math.floor=value=>{trace.push(["floor",value]);return floor(value);};
   Math.max=(...values)=>{trace.push(["max",...values]);return max(...values);};
   const result=api.formatElapsed(90061000);return [result,trace];
  }finally{Math.floor=floor;Math.max=max;Number.isFinite=isFinite;}
 }
 assert.deepEqual(observe(native),observe(original));
 const floor=Math.floor,failure={};try{Math.floor=()=>{throw failure;};assert.throws(()=>native.formatElapsed(1),error=>error===failure);}finally{Math.floor=floor;}
});
