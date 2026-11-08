import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/dashboard/components/stats-pane.js";
import {ScreenBuffer as OriginalBuffer} from "../../toolcraft-design/dist/dashboard/buffer.js";
const base={status:"running",iterations:2,tokensIn:100,tokensOut:200,elapsedMs:5000};

test("dashboard stats retains number formatting, elapsed identity and visual lines",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/stats-pane");
  const {formatElapsed}=await import("toolcraft-design-rust/dashboard/elapsed");
  assert.equal(native.formatElapsed,formatElapsed);assert.deepEqual(Object.keys(native),Object.keys(original));
  for(const value of [0,-0,NaN,Infinity,-Infinity,1234.56789,-123456789,1e21])assert.equal(native.formatNumber(value),original.formatNumber(value));
  for(const status of ["idle","running","paused","error","done"])for(const width of [0,1,3,8,20,44])for(const currentAction of [undefined,"","Improve streaming output (review)","界 👩‍💻 é\nnext\x1b[31mred\x1b[0m"]){
    const stats={...base,status,currentAction,iterationsLabel:"任务",iterationsTotal:90};
    assert.deepEqual(native.statsToLines(stats,width),original.statsToLines(stats,width));
  }
});

test("dashboard stats preserves compact and sidebar priorities in short panes",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/stats-pane");
  const {ScreenBuffer}=await import("toolcraft-design-rust/dashboard/buffer");
  for(const method of ["renderStatsPane","renderCompactStatsPane"])for(const width of [0,3,15,44])for(const height of [0,1,2,3,10,15])for(const extra of [{},{currentAction:"Task 2/8 failed (implement)"},{currentAction:"Improve streaming output with long task labels",iterations:68,iterationsTotal:90,iterationsLabel:"Tasks"}]){
    const a=new ScreenBuffer(width+2,height+2),b=new OriginalBuffer(width+2,height+2),rect={x:1,y:1,width,height};
    native[method](a,rect,{...base,...extra});original[method](b,rect,{...base,...extra});assert.deepEqual({...a},{...b});
  }
});

test("dashboard stats preserves getter order, receivers, reentrancy and thrown identity",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/stats-pane");
  function capture(api,method){
    const trace=[];const wrap=(tag,value)=>new Proxy(value,{get(target,key,receiver){trace.push([tag,key]);return Reflect.get(target,key,receiver);}});
    const rect=wrap("rect",{x:1,y:2,width:20,height:3}),stats=wrap("stats",{...base,currentAction:"A long action to keep in view",iterationsTotal:9});let nested=false;
    const buffer={get clearRect(){trace.push("clear getter");return function(value){assert.equal(this,buffer);trace.push(["clear",{...value}]);};},get putInRect(){trace.push("put getter");return function(value,...args){assert.equal(this,buffer);trace.push([{...value},...args]);if(!nested){nested=true;trace.push(api.statsToLines(base,8));}};}};
    api[method](buffer,rect,stats);const failure={};assert.throws(()=>api[method]({clearRect(){throw failure;}},rect,stats),error=>error===failure);return trace;
  }
  for(const method of ["renderStatsPane","renderCompactStatsPane"])assert.deepEqual(capture(native,method),capture(original,method));
});
