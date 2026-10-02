import assert from "node:assert/strict";
import {test} from "node:test";
import {renderDashboardSnapshot as reference} from "../../toolcraft-design/dist/dashboard/snapshot.js";

const stats={status:"paused",iterations:7,iterationsTotal:12,tokensIn:1234,tokensOut:500,elapsedMs:65000,currentAction:"Review 项目 👩‍💻"};
const items=[{kind:"info",text:"First\nsecond",ts:0},{kind:"error",text:"\u001b[31mFailure\u001b[0m é",ts:500},{kind:"success",text:"Ready 项目 👩‍💻",ts:1000}];

test("dashboard snapshots preserve ANSI cells, responsive panes and namespace identity",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/snapshot");
  const {dashboard}=await import("toolcraft-design-rust");
  assert.deepEqual(Object.keys(native),["renderDashboardSnapshot"]);
  assert.equal(dashboard.renderDashboardSnapshot,native.renderDashboardSnapshot);
  for(const [width,height] of [[0,0],[1,1],[12,5],[40,12],[80,20],[120,28],[40.8,12.9],[-1,-1]]){
    const opts={width,height,title:"Run 项目",statsTitle:"Progress",stats,items};
    assert.equal(native.renderDashboardSnapshot(opts),reference(opts),`${width}x${height}`);
  }
});

test("dashboard snapshot defaults keep nullish behavior, read order and one clock read",async()=>{
  const {renderDashboardSnapshot}=await import("toolcraft-design-rust/dashboard/snapshot");
  const now=Date.now;
  try {
    for(const opts of [undefined,{}, {width:null,height:null,title:null,statsTitle:null,items:null,stats:null}, {width:24,height:9,title:"",statsTitle:"",items:[],stats}]){
      function capture(render){
        const trace=[];
        Date.now=()=>{trace.push("now");return 100000;};
        const input=opts===undefined?undefined:new Proxy(opts,{get(target,key,receiver){trace.push(key);return Reflect.get(target,key,receiver);}});
        return {text:render(input),trace};
      }
      assert.deepEqual(capture(renderDashboardSnapshot),capture(reference));
    }
  } finally {Date.now=now;}
});

test("dashboard snapshot preserves thrown identity and reentrant option getters",async()=>{
  const {renderDashboardSnapshot}=await import("toolcraft-design-rust/dashboard/snapshot");
  const failure={reason:"caller"};
  for(const key of ["width","height","title","statsTitle","items","stats"]){
    const opts=Object.defineProperty({width:2,height:2,items,stats},key,{get(){throw failure;}});
    assert.throws(()=>renderDashboardSnapshot(opts),error=>error===failure);
  }
  function capture(render){
    const nested=[];
    const text=render({get width(){nested.push(render({width:20,height:6,items:[],stats}));return 30;},height:8,items,stats});
    return {text,nested};
  }
  assert.deepEqual(capture(renderDashboardSnapshot),capture(reference));
});
