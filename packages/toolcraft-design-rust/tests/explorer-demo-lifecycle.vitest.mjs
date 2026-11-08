import {expect,test,vi} from "vitest";
import process from "node:process";
const runner=vi.hoisted(()=>({runExplorer:vi.fn()}));
vi.mock("../../toolcraft-design/src/explorer/index.js",()=>runner);
vi.mock("../dist/explorer.js",()=>runner);
import * as original from "../../toolcraft-design/src/explorer/demo.ts";
import * as native from "../dist/explorer-demo.js";

async function detailScenario(api,mode,scenario){
  vi.useFakeTimers();
  const trace=[],controller=new AbortController();
  if(scenario==="already aborted")controller.abort();
  const config=api.buildExplorerDemoConfig({mode,slowDetail:scenario!=="fast"});
  const row=(await config.rows())[0];
  const failure={failed:true};
  const ctx=scenario==="signal failure"?{get signal(){throw failure;}}:{signal:controller.signal};
  let settled=false;
  try{
    const result=config.detail.items(row,ctx).then(items=>{settled=true;trace.push(["items",items.map(item=>({id:item.id,title:item.title,text:item.render()}))]);},error=>{expect(error).toBe(failure);settled=true;trace.push("rejected");});
    trace.push(["initial",settled,vi.getTimerCount()]);
    await Promise.resolve();trace.push(["microtask",settled]);
    if(scenario==="abort")controller.abort();
    await vi.advanceTimersByTimeAsync(499);trace.push(["499",settled,vi.getTimerCount()]);
    await vi.advanceTimersByTimeAsync(1);await result;
    trace.push(["500",settled,vi.getTimerCount()]);return trace;
  }finally{vi.clearAllTimers();vi.useRealTimers();}
}
for(const mode of ["single-detail-mode","list-detail-mode"]){
  test.each(["fast","slow","abort","already aborted","signal failure"])(`${mode} preserves %s detail scheduling`,async scenario=>{
    expect(await detailScenario(native,mode,scenario)).toEqual(await detailScenario(original,mode,scenario));
  });
}

async function mainScenario(api,kind){
  const argv=process.argv,savedMode=process.env.EXPLORER_DEMO_MODE,savedSlow=process.env.EXPLORER_DEMO_SLOW_DETAIL,events=[];
  const failure={failed:true};
  process.argv=["node","demo","--mode",kind==="invalid"?"bad":"list-detail-mode"];
  delete process.env.EXPLORER_DEMO_MODE;delete process.env.EXPLORER_DEMO_SLOW_DETAIL;
  runner.runExplorer.mockImplementation(async function(config){
    events.push(["run",this===undefined,config.title,config.multiSelect]);
    if(kind==="failure")throw failure;
    const rows=await config.rows();events.push(rows);
    events.push((await config.detail.items(rows[0],{})).map(item=>item.render()));
    return 123;
  });
  try{
    try{events.push(["result",await api.main()]);}
    catch(error){if(kind==="failure"){expect(error).toBe(failure);events.push("failed");}else events.push([error.name,error.message]);}
    return events;
  }finally{
    process.argv=argv;
    for(const [key,value] of [["EXPLORER_DEMO_MODE",savedMode],["EXPLORER_DEMO_SLOW_DETAIL",savedSlow]]){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
    runner.runExplorer.mockReset();
  }
}
test.each(["success","failure","invalid"])("explorer demo main preserves %s behavior",async kind=>{
  expect(await mainScenario(native,kind)).toEqual(await mainScenario(original,kind));
});
