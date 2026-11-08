import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/dashboard/components/run-view.js";
import {ScreenBuffer as OriginalBuffer} from "../../toolcraft-design/dist/dashboard/buffer.js";

function options(){return {title:"Pipeline",scrollOffset:0,output:[{role:"agent",kind:"info",text:"**Checks passed**\n\n- ready\n",ts:0},{role:"action",kind:"tool",text:"Run checks",detail:"full details",ts:1000}],stats:{status:"running",iterations:2,tokensIn:1200,tokensOut:340,elapsedMs:123000,run:{agent:"codex",cwd:"/workspace",phase:"Follow-up",activity:"Review",activePlanId:"p1",activeTaskId:"t1",activeStep:"verify",queue:[{kind:"plan",id:"p1",path:"/workspace/docs/plans/first.md",status:"running"},{kind:"message",id:"m1",text:"Review result",afterPlanId:"p1",status:"completed"},{kind:"message",id:"m2",text:"Check API",afterPlanId:"p1",status:"running"},{kind:"plan",id:"p2",path:"/workspace/next.md",status:"pending"}],tasks:Array.from({length:8},(_,i)=>({id:`t${i}`,title:`Task ${i+1}`,status:i===0?"completed":"pending",steps:[{name:"implement",status:"completed"},{name:"verify",status:"pending"}]}))}},composer:{kind:"message",afterPlanId:"p1",text:"Review this\nresult",cursor:18,focused:true},now:65000};}

test("dashboard run view preserves responsive layout, queue navigation and composer results",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/run-view");
  assert.deepEqual(Object.keys(native),Object.keys(original));
  for(const [width,height]of [[0,0],[30,8],[40,12],[80,24],[120,32],[180,36]])for(const change of [{},{showQueue:true},{showQueue:true,workOffset:999},{composer:undefined},{submitting:true,feedback:"Queued"},{showDetails:true,scrollOffset:5},{composer:{...options().composer,focused:false},hints:[{key:"q",label:"Quit"},{key:"Space",label:"Pause"}]},{composer:{...options().composer,kind:"plan",text:"",cursor:0,error:"Missing plan"}}]){
    function capture(api){const calls=[],buffer={width,height,put(...args){calls.push(["put",...args]);},putInRect(...args){calls.push(["rect",...args]);},clearRect(rect){calls.push(["clear",rect]);}};return [api.renderRunView(buffer,{...options(),...change}),calls];}
    assert.deepEqual(capture(native),capture(original),`${width}x${height} ${JSON.stringify(change)}`);
  }
});

test("dashboard run view keeps native cells aligned in active, paused and finished views",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/run-view");
  const {ScreenBuffer}=await import("toolcraft-design-rust/dashboard/buffer");
  for(const status of ["running","paused","done","error","idle"])for(const [width,height]of [[40,12],[120,28]]){
    const data=options();data.stats.status=status;data.composer.text="项目 👩‍💻 é";data.composer.cursor=data.composer.text.length;
    const a=new ScreenBuffer(width,height),b=new OriginalBuffer(width,height);
    assert.deepEqual(native.renderRunView(a,data),original.renderRunView(b,data));assert.deepEqual({...a},{...b});
  }
});

test("dashboard run view retains live getter order, callback receivers and thrown identity",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/run-view");
  function capture(api,showQueue){
    const trace=[];const wrap=(tag,value)=>new Proxy(value,{get(target,key,receiver){trace.push([tag,key]);return Reflect.get(target,key,receiver);}});
    const data=options();data.showQueue=showQueue;data.workOffset=3;
    data.stats.run=wrap("run",data.stats.run);data.stats=wrap("stats",data.stats);data.composer=wrap("composer",data.composer);
    const buffer={get width(){trace.push("width");return 120;},get height(){trace.push("height");return 28;},get put(){trace.push("put getter");return function(...args){assert.equal(this,buffer);trace.push(args);};},get putInRect(){trace.push("rect getter");return function(...args){assert.equal(this,buffer);trace.push(args);};},clearRect(rect){trace.push(["clear",rect]);}};
    const result=api.renderRunView(buffer,wrap("options",data));
    const failure={};assert.throws(()=>api.renderRunView({width:80,height:24,putInRect(){throw failure;}},options()),error=>error===failure);
    return {trace,result};
  }
  for(const showQueue of [false,true])assert.deepEqual(capture(native,showQueue),capture(original,showQueue));
});
