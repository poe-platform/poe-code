import {expect, test, vi} from "vitest";
import process from "node:process";

const factory=vi.hoisted(()=>({create:vi.fn()}));
vi.mock("../../toolcraft-design/src/dashboard/dashboard.js",()=>({createDashboard:factory.create}));
vi.mock("../dist/dashboard-runtime.js",()=>({createDashboard:factory.create}));
import * as original from "../../toolcraft-design/src/dashboard/demo.ts";
import * as native from "../dist/dashboard-demo.js";

async function scenario(api,trigger,failureAt){
  const events=[],signals=new Map();let command;
  const failure={stage:failureAt};
  vi.useFakeTimers();vi.setSystemTime(1234);
  vi.spyOn(Math,"random").mockReturnValue(0);
  vi.spyOn(process,"once").mockImplementation(function(name,callback){
    expect(this).toBe(process);events.push(["once",name,callback.name,callback.length]);signals.set(name,callback);return this;
  });
  vi.spyOn(process,"exit").mockImplementation(function(code){
    expect(this).toBe(process);events.push(["exit",code]);if(failureAt==="exit")throw failure;
  });
  const dashboard={
    appendOutput(value){expect(this).toBe(dashboard);events.push(["output",value]);},
    updateStats(value){expect(this).toBe(dashboard);events.push(["stats",value]);if(failureAt==="stats")throw failure;},
    onCommand(callback){expect(this).toBe(dashboard);events.push(["command",callback.name,callback.length]);command=callback;if(failureAt==="command")throw failure;},
    start(){expect(this).toBe(dashboard);events.push("start");if(failureAt==="start")throw failure;},
    destroy(){expect(this).toBe(dashboard);events.push("destroy");if(failureAt==="destroy")throw failure;}
  };
  factory.create.mockImplementation(function(options){
    expect(this).toBeUndefined();events.push(["create",options]);if(failureAt==="create")throw failure;return dashboard;
  });
  try{
    try{events.push(["result",await api.main()]);}catch(error){expect(error).toBe(failure);events.push("startup rejected");}
    if(!["create","stats","command","start"].includes(failureAt)){
      await vi.advanceTimersByTimeAsync(1000);
      command("help");command(new String("quit"));
      try{if(trigger==="quit")command("quit");else signals.get(trigger)();}
      catch(error){expect(error).toBe(failure);events.push("shutdown threw");}
      command("quit");for(const callback of signals.values())callback();
      events.push(["timers",vi.getTimerCount()]);
      await vi.advanceTimersByTimeAsync(30000);
    }
    return events;
  }finally{vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();factory.create.mockReset();}
}

test.each(["quit","SIGINT","SIGTERM"])("demo main preserves %s shutdown and timer cleanup",async trigger=>{
  expect(await scenario(native,trigger)).toEqual(await scenario(original,trigger));
});
test.each(["create","stats","command","start","destroy","exit"])("demo main preserves arbitrary %s failures",async stage=>{
  expect(await scenario(native,"quit",stage)).toEqual(await scenario(original,"quit",stage));
});
