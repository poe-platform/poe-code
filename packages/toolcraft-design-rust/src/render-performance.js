import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {fitToWidth} from "./explorer-text.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke=createComponentPolicy(native.designRenderPerformancePolicy,{
  integer:value=>!!Number.isInteger(value),lt:(a,b)=>a<b,gt:(a,b)=>a>b,same:(a,b)=>a===b,add:(a,b)=>a+b,
  undefined:()=>undefined,
  invalidCapacity(){throw new Error("sampleSize must be an integer between 1 and 4096");},
  clock:now=>now(),request:state=>{state.requests++;state.pending++;},input:(state,now)=>{state.firstInput??=now();},
  duration:(finished,started)=>Math.max(0,finished-started),
  recordDuration:(state,capacity,duration)=>{state.durations[state.renders%capacity]=duration;},
  longest:(state,duration)=>{state.longestRenderMs=Math.max(state.longestRenderMs,duration);},
  slow:state=>{state.slowFrames++;},
  rendered:state=>{state.renders++;state.coalesced+=Math.max(0,state.pending-1);state.pending=0;},
  recordInput:(state,capacity,finished)=>{state.inputs[state.inputCount++%capacity]=Math.max(0,finished-state.firstInput);state.firstInput=undefined;},
  frame:(state,frame)=>{state.frames++;state.changedCells+=frame.changedCells;},
  bucket:finished=>Math.floor(finished/10),bucketIndex:(bucket,buckets)=>bucket%buckets.length,
  at:(values,index)=>values[index],
  resetBucket:(buckets,counts,index,bucket)=>{buckets[index]=bucket;counts[index]=0;},
  countBucket:(counts,index)=>{counts[index]=counts[index]+1;},
  lower:(buckets,index,time)=>buckets[index]*10>=time-1000,upper:(buckets,index,time)=>buckets[index]*10<=time,
  snapshot:(state,fps,capacity)=>({fps,frames:state.frames,renders:state.renders,requests:state.requests,coalesced:state.coalesced,changedCells:state.changedCells,slowFrames:state.slowFrames,longestRenderMs:state.longestRenderMs,
    sampleCount:Math.min(state.renders,capacity),renderMs:invoke("percentiles",[state.durations,Math.min(state.renders,capacity)]),inputMs:invoke("percentiles",[state.inputs,Math.min(state.inputCount,capacity)])}),
  zeroPercentiles:()=>({p50:0,p95:0,max:0}),sort:(samples,count)=>samples.slice(0,count).sort(),
  percentiles:(sorted,count)=>({p50:sorted[Math.ceil(count*.5)-1],p95:sorted[Math.ceil(count*.95)-1],max:sorted[count-1]}),
  format:stats=>`FPS ${stats.fps} · paint p95 ${stats.renderMs.p95.toFixed(1)}ms · input p95 ${stats.inputMs.p95.toFixed(1)}ms · slow ${stats.slowFrames} · merged ${stats.coalesced}`,
  fit:fitToWidth,
  invalidOperation(){throw new TypeError("Invalid render performance operation");}
});
export function createRenderPerformanceMonitor(options={}) {
  const now=options.now??(()=>performance.now()),capacity=options.sampleSize??256;
  invoke("validate",[capacity]);
  const state={durations:new Float64Array(capacity),inputs:new Float64Array(capacity),buckets:new Float64Array(101).fill(-Infinity),counts:new Uint32Array(101),renders:0,frames:0,requests:0,pending:0,coalesced:0,changedCells:0,inputCount:0,slowFrames:0,longestRenderMs:0,firstInput:undefined};
  return {
    request(kind){return invoke("request",[state,now,kind]);},
    begin(){return now();},
    end(startedAt,frame){return invoke("end",[state,capacity,now,startedAt,frame]);},
    snapshot(){return invoke("snapshot",[state,capacity,now]);}
  };
}
export function formatRenderPerformance(stats,width){return invoke("format",[stats,width]);}
