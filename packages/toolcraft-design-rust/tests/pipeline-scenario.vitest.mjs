import {expect,test,vi} from "vitest";
import process from "node:process";
const factory=vi.hoisted(()=>({createDashboard:vi.fn(),createDashboardLineBuffer:vi.fn()}));
vi.mock("../../toolcraft-design/src/dashboard/dashboard.js",()=>({createDashboard:factory.createDashboard}));
vi.mock("../dist/dashboard-runtime.js",()=>({createDashboard:factory.createDashboard}));
vi.mock("../../toolcraft-design/src/dashboard/line-buffer.js",()=>({createDashboardLineBuffer:factory.createDashboardLineBuffer}));
vi.mock("../dist/line-buffer.js",()=>({createDashboardLineBuffer:factory.createDashboardLineBuffer}));

async function scenario(module,name,failureAt,options={}){
  vi.resetModules();
  const trace=[],timers=[],signals=new Map(),argv=process.argv;
  let command,buffered="",reentered=false;
  const failure={failureAt};
  process.argv=["node","fixture",name];
  const dashboard={
    onCommand(callback){expect(this).toBe(dashboard);command=callback;trace.push(["command",callback.name,callback.length]);},
    start(){expect(this).toBe(dashboard);trace.push("start");if(failureAt==="start")throw failure;},
    destroy(){expect(this).toBe(dashboard);trace.push("destroy");},
    get appendOutput(){trace.push("get append");if(options.reentrant && timers.length && !reentered){reentered=true;timers[0].callback();}return function(item){expect(this).toBe(dashboard);trace.push(["output",item]);if(failureAt==="append")throw failure;};},
    get updateStats(){trace.push("get stats");return function(item){expect(this).toBe(dashboard);trace.push(["stats",item]);if(failureAt==="stats")throw failure;};}
  };
  factory.createDashboard.mockImplementation(function(options){trace.push(["create",this===undefined,options]);if(failureAt==="create")throw failure;return dashboard;});
  factory.createDashboardLineBuffer.mockImplementation(function(callback){
    trace.push(["buffer",this===undefined,callback.name,callback.length]);
    const buffer={
      get push(){trace.push("get push");return function(value){expect(this).toBe(buffer);trace.push(["push",value]);buffered+=value;const end=buffered.lastIndexOf("\n");if(end>=0){callback(buffered.slice(0,end));buffered=buffered.slice(end+1);}};},
      flush(){expect(this).toBe(buffer);trace.push("flush");callback(buffered);buffered="";}
    };return buffer;
  });
  vi.spyOn(process,"once").mockImplementation(function(name,callback){expect(this).toBe(process);trace.push(["once",name,callback.name,callback.length]);signals.set(name,callback);return this;});
  vi.spyOn(globalThis,"setInterval").mockImplementation(function(callback,delay){const timer={id:timers.length,callback};timers.push(timer);trace.push(["interval",this===undefined,delay,callback.name,callback.length]);if(options.immediate)callback();return options.undefinedTimer?undefined:timer;});
  vi.spyOn(globalThis,"clearInterval").mockImplementation(function(timer){trace.push(["clear",this===undefined,timer?.id]);});
  const repeat=String.prototype.repeat;
  vi.spyOn(String.prototype,"repeat").mockImplementation(function(count){
    trace.push(["repeat",String(this),count]);
    if(options.repeatThrows)throw failure;
    return Reflect.apply(repeat,this,[count]);
  });
  try{
    try{const api=await import(module);trace.push(["exports",Object.keys(api)]);}
    catch(error){expect(error).toBe(failure);trace.push("failed");return trace;}
    expect(signals.get("SIGINT")).toBe(signals.get("SIGTERM"));
    for(const timer of timers)timer.callback();
    command("other");command(new String("quit"));command("quit");command("forceQuit");
    for(const callback of signals.values())callback();
    for(const timer of timers)timer.callback();
    return trace;
  }finally{process.argv=argv;vi.restoreAllMocks();factory.createDashboard.mockReset();factory.createDashboardLineBuffer.mockReset();}
}
test.each([undefined,"streaming","burst","empty","oversized","newline-free","execution-error","failure","unicode","label-controls","unicode-title","cursor-controls","resumed","queue"])("pipeline scenario preserves %s setup, output and cleanup",async name=>{
  expect(await scenario("../dist/pipeline-scenario.js",name)).toEqual(await scenario("../../toolcraft-design/src/dashboard/testing/pipeline-scenario.ts",name));
});
test.each(["create","start","stats","append"])("pipeline scenario preserves arbitrary %s failures",async stage=>{
  expect(await scenario("../dist/pipeline-scenario.js","streaming",stage)).toEqual(await scenario("../../toolcraft-design/src/dashboard/testing/pipeline-scenario.ts","streaming",stage));
});

test.each(["streaming","burst"])("pipeline scenario preserves %s reentrant append getters",async name=>{
  expect(await scenario("../dist/pipeline-scenario.js",name,undefined,{reentrant:true})).toEqual(await scenario("../../toolcraft-design/src/dashboard/testing/pipeline-scenario.ts",name,undefined,{reentrant:true}));
});
test.each([{undefinedTimer:true},{immediate:true},{undefinedTimer:true,immediate:true}])("pipeline scenario preserves timer host behavior %j",async options=>{
  expect(await scenario("../dist/pipeline-scenario.js","burst",undefined,options)).toEqual(await scenario("../../toolcraft-design/src/dashboard/testing/pipeline-scenario.ts","burst",undefined,options));
});
test.each(["label-controls","unicode-title","newline-free","oversized","cursor-controls"])("pipeline scenario preserves %s repeat failures",async name=>{
  expect(await scenario("../dist/pipeline-scenario.js",name,undefined,{repeatThrows:true})).toEqual(await scenario("../../toolcraft-design/src/dashboard/testing/pipeline-scenario.ts",name,undefined,{repeatThrows:true}));
});
test.each([null,42,false,{},"unknown"])("pipeline scenario preserves arbitrary scenario %j",async name=>{
  expect(await scenario("../dist/pipeline-scenario.js",name)).toEqual(await scenario("../../toolcraft-design/src/dashboard/testing/pipeline-scenario.ts",name));
});
