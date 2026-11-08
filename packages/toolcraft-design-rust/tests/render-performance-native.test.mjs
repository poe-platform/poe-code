import assert from "node:assert/strict";
import {test} from "node:test";
import * as native from "../dist/index.js";
import * as reference from "../../toolcraft-design/dist/render-performance.js";
const outcome=fn=>{try{return {value:fn()};}catch(error){return {error:[error?.constructor?.name,error?.message]};}};

test("performance monitors preserve rolling percentiles, repaint buckets and input coalescing",()=>{
  assert.equal(typeof native.createRenderPerformanceMonitor,"function");
  function run(create,sampleSize) {
    let now=0;const monitor=create({now:()=>now,sampleSize}),snapshots=[monitor.snapshot()];
    for(const [duration,changedCells,kind] of [[0,0,"update"],[20,4,"input"],[2,2,"input"],[200,0,"resize"],[1,1,"update"],[100,8,"input"],[4,2,"update"]]){
      monitor.request(kind);monitor.request("update");const start=monitor.begin();now+=duration;monitor.end(start,{changedCells});snapshots.push(monitor.snapshot());
    }
    for(const time of [1000,1001,1200,2000,-1,NaN,Infinity]){now=time;snapshots.push(monitor.snapshot());}
    return snapshots;
  }
  for(const size of [1,2,4,256,4096])assert.deepEqual(run(native.createRenderPerformanceMonitor,size),run(reference.createRenderPerformanceMonitor,size));
});

test("performance validation retains defaults and exact errors",()=>{
  for(const sampleSize of [0,-1,1.5,4097,NaN,Infinity,"2"]){assert.deepEqual(outcome(()=>native.createRenderPerformanceMonitor({sampleSize})),outcome(()=>reference.createRenderPerformanceMonitor({sampleSize})));}
  for(const options of [undefined,{}, {sampleSize:null,now:null}])assert.deepEqual(native.createRenderPerformanceMonitor(options).snapshot(),reference.createRenderPerformanceMonitor(options).snapshot());
});

test("performance clocks preserve receivers, getters and nonfinite durations",()=>{
  function run(create) {
    const trace=[];let time=0;
    const options={get now(){trace.push("now option");return function(){trace.push(["clock",this===undefined]);return time;};},get sampleSize(){trace.push("size option");return 2;}};
    const monitor=create(options),snapshots=[];
    for(const value of [2,0,-1,NaN,Infinity]){time=value;monitor.request("input");monitor.request("input");monitor.end({valueOf(){trace.push("start");return 0;}},{get changedCells(){trace.push("cells");return 1;}});snapshots.push(monitor.snapshot());}
    return [snapshots,trace];
  }
  assert.deepEqual(run(native.createRenderPerformanceMonitor),run(reference.createRenderPerformanceMonitor));
  const thrown={},monitor=native.createRenderPerformanceMonitor({now(){throw thrown;}});assert.throws(()=>monitor.begin(),error=>error===thrown);
});

test("performance formatting retains nested getter and toFixed receivers",()=>{
  assert.equal(typeof native.formatRenderPerformance,"function");
  function run(format) {
    const trace=[],percentile={toFixed(digits){trace.push(["fixed",digits,this===percentile]);return "12.3";}};
    const stats=new Proxy({fps:10,renderMs:{p95:percentile},inputMs:{p95:percentile},slowFrames:2,coalesced:3},{get(target,key){trace.push(key);return target[key];}});
    return [format(stats,100),trace];
  }
  assert.deepEqual(run(native.formatRenderPerformance),run(reference.formatRenderPerformance));
  const monitor=reference.createRenderPerformanceMonitor({now:()=>0});for(const width of [-1,0,0.5,8,32,100,NaN,Infinity])assert.deepEqual(outcome(()=>native.formatRenderPerformance(monitor.snapshot(),width)),outcome(()=>reference.formatRenderPerformance(monitor.snapshot(),width)));
});

test("performance snapshots preserve typed-array species, sorting and Math callback order",()=>{
  function run(create) {
    let now=0;const trace=[],monitor=create({sampleSize:2,now:()=>now});monitor.request("input");now=10;monitor.end(0,{changedCells:2});
    const slice=Float64Array.prototype.slice,sort=Float64Array.prototype.sort,min=Math.min,ceil=Math.ceil;
    Float64Array.prototype.slice=function(...args){trace.push(["slice",...args]);return slice.apply(this,args);};
    Float64Array.prototype.sort=function(...args){trace.push("sort");return sort.apply(this,args);};
    Math.min=(...args)=>{trace.push(["min",...args]);return min(...args);};Math.ceil=value=>{trace.push(["ceil",value]);return ceil(value);};
    try{return [monitor.snapshot(),trace];}finally{Float64Array.prototype.slice=slice;Float64Array.prototype.sort=sort;Math.min=min;Math.ceil=ceil;}
  }
  assert.deepEqual(run(native.createRenderPerformanceMonitor),run(reference.createRenderPerformanceMonitor));
});

test("performance root and subpath identities and method descriptors match",async()=>{
  const module=await import("toolcraft-design-rust/render-performance");assert.deepEqual(Object.keys(module),Object.keys(reference));
  for(const key of Object.keys(module)){assert.equal(module[key],native[key]);assert.equal(module[key].name,reference[key].name);assert.equal(module[key].length,reference[key].length);}
  const a=native.createRenderPerformanceMonitor({now:()=>0}),b=reference.createRenderPerformanceMonitor({now:()=>0});assert.deepEqual(Object.keys(a),Object.keys(b));
  for(const key of Object.keys(a)){const left=Object.getOwnPropertyDescriptor(a,key),right=Object.getOwnPropertyDescriptor(b,key);assert.deepEqual({...left,value:null},{...right,value:null});assert.equal(a[key].name,b[key].name);assert.equal(a[key].length,b[key].length);assert.equal(Object.hasOwn(a[key],"prototype"),Object.hasOwn(b[key],"prototype"));}
  const request=a.request,end=a.end,snapshot=a.snapshot;request("update");end(0,{changedCells:1});assert.equal(snapshot().frames,1);
});

test("performance clocks and frame getters can reenter at the same partial states",()=>{
  function run(create) {
    let now=0,monitor,reenter=false;const trace=[];
    monitor=create({sampleSize:2,now(){trace.push("clock");if(reenter){reenter=false;monitor.request("input");now++;}return now;}});
    reenter=true;monitor.request("input");now=30;
    let reads=0;
    monitor.end(0,{get changedCells(){trace.push(["cells",++reads]);if(reads===1){monitor.request("update");trace.push(monitor.snapshot());}if(reads===2)monitor.request("input");return 2;}});
    trace.push(monitor.snapshot());return trace;
  }
  assert.deepEqual(run(native.createRenderPerformanceMonitor),run(reference.createRenderPerformanceMonitor));
});

test("performance Math reentrancy preserves assignment capture and snapshot field order",()=>{
  function run(create) {
    let now=0,nested=false;const monitor=create({sampleSize:2,now:()=>now}),trace=[],max=Math.max,min=Math.min;
    monitor.request("input");now=20;
    Math.max=(...args)=>{trace.push(["max",...args]);if(!nested){nested=true;monitor.request("update");}return max(...args);};
    try{monitor.end(0,{changedCells:2});}finally{Math.max=max;}
    nested=false;
    Math.min=(...args)=>{trace.push(["min",...args]);if(!nested){nested=true;monitor.request("update");}return min(...args);};
    try{return [monitor.snapshot(),trace];}finally{Math.min=min;}
  }
  assert.deepEqual(run(native.createRenderPerformanceMonitor),run(reference.createRenderPerformanceMonitor));
});
