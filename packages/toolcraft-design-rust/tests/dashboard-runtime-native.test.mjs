import assert from "node:assert/strict";
import {test} from "node:test";
import {PassThrough} from "node:stream";
import {createDashboard as reference} from "../../toolcraft-design/dist/dashboard/dashboard.js";
import {withOutputFormat as referenceFormat} from "../../toolcraft-design/dist/internal/output-format.js";
import {createDashboard} from "toolcraft-design-rust/dashboard/dashboard";
import {withOutputFormat,dashboard} from "toolcraft-design-rust";
import * as namespace from "toolcraft-design-rust/dashboard/index";
import * as originalNamespace from "../../toolcraft-design/dist/dashboard/index.js";

function streams(cols=40,rows=12){
  const trace=[];
  const stdin=Object.assign(new PassThrough(),{setRawMode(value){trace.push(["raw",value,this===stdin]);}});
  const stdout=Object.assign(new PassThrough(),{columns:cols,rows});
  stdout.on("data",chunk=>trace.push(["write",chunk.toString()]));
  return {stdin,stdout,trace};
}

test("dashboard runtime completes namespace exports with shared function identities",()=>{
  assert.deepEqual(Object.keys(namespace),Object.keys(originalNamespace));
  assert.deepEqual(Object.keys(dashboard),Object.keys(namespace));
  for(const key of Object.keys(namespace))assert.equal(dashboard[key],namespace[key],key);
  assert.equal(dashboard.createDashboard,createDashboard);
});

test("dashboard lifecycle preserves frames, raw modes, subscriptions, commands and restart",()=>{
  const clock=Date.now;Date.now=()=>64000;
  try {
    for(const appearance of ["panels","conversation"]){
      function capture(create,format){return format("terminal",()=>{
        const {stdin,stdout,trace}=streams();
        const ui=create({stdin,stdout,appearance,title:"Run 项目",hints:[{key:"q",label:"Quit"}]});
        trace.push(["keys",Object.keys(ui)]);
        ui.appendOutput({kind:"tool",text:"Run npm test",role:"action",ts:1000});
        ui.updateStats({status:"running",context:["one","two"],run:{activePlanId:"a",queue:[{id:"a",kind:"plan",path:"a.md",status:"running"}]}});
        const handler=command=>trace.push(["command",command]);
        ui.onCommand(handler);ui.onCommand(handler);ui.start();ui.start();
        stdin.emit("data",Buffer.from("q"));
        ui.updateStats({status:"paused",iterations:3});
        stdout.columns=80;stdout.rows=20;stdout.emit("resize");
        ui.stop();ui.stop();ui.start();
        const performance=ui.getPerformance();trace.push(["performanceKeys",Object.keys(performance)]);
        ui.destroy();ui.destroy();ui.start();ui.appendOutput({kind:"error",text:"ignored",ts:0});ui.updateStats({status:"running"});ui.onCommand(()=>{throw Error("destroyed");});
        trace.push(["listeners",stdin.listenerCount("data"),stdout.listenerCount("resize")]);
        return trace;
      });}
      assert.deepEqual(capture(createDashboard,withOutputFormat),capture(reference,referenceFormat),appearance);
    }
  }finally{Date.now=clock;}
});

test("dashboard creation and fallback preserve getters, receivers and thrown values",()=>{
  for(const format of ["markdown","json"]){
    function capture(create,scope){return scope(format,()=>{
      const trace=[];
      const stdout={write(message){trace.push(["write",message,this===stdout]);}};
      const options=new Proxy({stdin:{},stdout},{get(target,key,receiver){trace.push(["option",key]);return Reflect.get(target,key,receiver);}});
      const ui=create(options);ui.start();
      for(const kind of ["success","error","tool","info","status"]){
        ui.appendOutput(new Proxy({kind,text:`${kind}\nnext`},{get(target,key,receiver){trace.push(["item",key]);return Reflect.get(target,key,receiver);}}));
      }
      ui.updateStats(new Proxy({},{get(){throw Error("stats should not be read");}}));
      ui.destroy();return trace;
    });}
    assert.deepEqual(capture(createDashboard,withOutputFormat),capture(reference,referenceFormat));
  }
  for(const value of [undefined,null,17,Symbol("failure"),{failure:true}]){
    assert.throws(()=>createDashboard({get title(){throw value;}}),error=>error===value);
    withOutputFormat("json",()=>{
      const ui=createDashboard({stdout:{write(){throw value;}}});
      assert.throws(()=>ui.appendOutput({kind:"info",text:"throw",ts:0}),error=>error===value);
      ui.destroy();
    });
  }
});

test("dashboard callbacks retain receiver, live command iteration and reentrant teardown",()=>{
  function capture(create,scope){return scope("terminal",()=>{
    const {stdin,stdout,trace}=streams(15,6);let ui;let observe;
    const options={stdin,stdout,onPerformance(snapshot){trace.push(["performance",this===options,snapshot.frames]);observe?.();}};
    ui=create(options);ui.start();
    const second=command=>trace.push(["second",command]);
    ui.onCommand(command=>{trace.push(["first",command]);ui.onCommand(second);});
    stdin.emit("data",Buffer.from("q"));
    observe=()=>ui.stop();ui.updateStats({status:"paused"});
    observe=undefined;ui.start();ui.destroy();
    return trace;
  });}
  assert.deepEqual(capture(createDashboard,withOutputFormat),capture(reference,referenceFormat));
});

test("dashboard submissions preserve callback receivers, promise turns and post-destroy failures",async()=>{
  const clock=Date.now;Date.now=()=>64000;
  try {
    for(const outcome of ["accepted","rejected","sync-throw"]){
      async function capture(create,scope){return scope("terminal",async()=>{
        const {stdin,stdout,trace}=streams(40,12);let settle;
        const options={stdin,stdout,onSubmit(submission){
          trace.push(["submit",this===options,submission]);
          if(outcome==="sync-throw")throw "Rejected\u001b[2J input";
          return new Promise((resolve,reject)=>{settle=()=>outcome==="accepted"?resolve():reject("Rejected\u001b[2J input");});
        }};
        const ui=create(options);
        ui.updateStats({status:"running",run:{activePlanId:"a",queue:[{id:"a",kind:"plan",path:"a.md",status:"running"}]}});
        ui.start();stdin.emit("data",Buffer.from("Review\r"));
        trace.push(["after-input"]);
        if(outcome==="rejected")ui.destroy();
        settle?.();
        await Promise.resolve();trace.push(["first-turn"]);
        await Promise.resolve();trace.push(["second-turn"]);
        ui.destroy();return trace;
      });}
      assert.deepEqual(await capture(createDashboard,withOutputFormat),await capture(reference,referenceFormat),outcome);
    }
  }finally{Date.now=clock;}
});
