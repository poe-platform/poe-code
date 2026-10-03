import assert from "node:assert/strict";
import {it,vi,afterEach} from "vitest";
import * as definitions from "../dist/index.js";
import * as originals from "../../toolcraft/dist/index.js";
import {createReferenceHandler} from "./mcp-handler-reference.mjs";
const reports=vi.hoisted(()=>({write:vi.fn(async()=>undefined)}));
vi.mock("../dist/error-report.js",()=>({writeErrorReport:(...args)=>reports.write(...args)}));
afterEach(()=>reports.write.mockReset().mockResolvedValue(undefined));
const native=()=>import("../dist/mcp-handler.js");
const record=(shape={})=>({kind:"object",shape});
function fixture(factory,defs,handler,extra={}){
  const command={name:"run",secrets:{},params:record({displayName:{kind:"string",default:"default"}}),handler,...extra.command};
  const tool={name:"app_run",commandPath:"app.run",paramsSchema:command.params,command,...extra.tool};
  const environment={options:{errorReports:false,env:{TOKEN:"synthetic"},fs:{}},runtime:{},services:{shared:"base"},root:{name:"app"},runtimeFetch:()=>{},diagnostics:{emit(){}},casing:"snake",...extra.environment};
  return {handler:factory(tool,environment),tool,environment,defs};
}
const reference=(tool,environment)=>createReferenceHandler(tool,environment,{writeErrorReport:(...args)=>reports.write(...args)});
const snapshot=error=>({name:error?.name,message:error?.message,code:error?.code,data:error?.data});
async function outcome(handler,params={},context){try{return {value:await handler(params,context)};}catch(error){return {error:snapshot(error)};}}
it("Native MCP handlers compose services, secrets, validation, progress and wire result projection",async()=>{
  const api=await native();
  async function inspect(factory,defs){
    const trace=[],signal=new AbortController().signal,request={signal};
    const test=fixture(factory,defs,function(context){trace.push([this===test.tool.command,context.params,context.shared,context.request,context.root===test.environment.root,context.fetch===test.environment.runtimeFetch,context.fs===test.environment.options.fs,context.signal===signal,context.env.get("TOKEN")]);context.progress("working");return {displayName:context.params.displayName};},{tool:{resultSchema:record({displayName:{kind:"string"}})},environment:{runtime:{requestServices(context){trace.push(context===request);return {shared:"request",request:true};}},diagnostics:{emit(event){trace.push(event);}}}});
    return {value:await test.handler({display_name:"hello"},request),trace};
  }
  const actual=await inspect(api.createMCPToolHandler,definitions);assert.deepEqual(actual,await inspect(reference,originals));assert.deepEqual(actual.value.structuredContent,{display_name:"hello"});
});
it("Native MCP handlers preserve pending approvals and explicit MCP result identities",async()=>{
  const api=await native();
  for(const [factory,defs] of [[api.createMCPToolHandler,definitions],[reference,originals]]){
    const pending={status:"pending-approval",approvalId:"a",message:"wait",enqueuedAt:"now"};
    let called=false;const humanInLoop={invoke(command,context,path){assert.equal(this,humanInLoop);assert.equal(command,test.tool.command);assert.equal(path,"app.run");assert.deepEqual(context.params,{displayName:"default"});return pending;}};
    const test=fixture(factory,defs,()=>{called=true;},{environment:{humanInLoop}});assert.match((await test.handler({})).content[0].text,/Queued for human approval/);assert.equal(called,false);
    for(const isError of [true,false])for(const resultSchema of [undefined,record({displayName:{kind:"string"}})]){
      const value=defs.asMCPResult({content:[{type:"text",text:"custom"}],structuredContent:{displayName:"ok"},isError});
      const output=await fixture(factory,defs,()=>value,{tool:{resultSchema}}).handler({});
      if(isError||resultSchema===undefined)assert.equal(output,value);else{assert.notEqual(output,value);assert.equal(output.content,value.content);assert.deepEqual(output.structuredContent,{display_name:"ok"});}
    }
  }
});
it("Native MCP handlers transform results and classify transformation and validation failures",async()=>{
  const api=await native();
  for(const mode of ["plain","transform","invalid","throw","string","undefined"]){
    async function inspect(factory,defs){const test=fixture(factory,defs,()=>mode==="string"?"text":mode==="undefined"?undefined:{displayName:mode==="invalid"?17:"ok"},{tool:{resultSchema:["string","undefined"].includes(mode)?undefined:record({displayName:{kind:"string"}})},command:["transform","throw"].includes(mode)?{mcpResult(value){assert.equal(this,command);if(mode==="throw")throw new defs.UserError("transform");return {displayName:value.displayName+"!"};}}:{}});const command=test.tool.command;return outcome(test.handler);}
    assert.deepEqual(await inspect(api.createMCPToolHandler,definitions),await inspect(reference,originals));
  }
});
it("Native MCP handlers preserve all cancellation boundaries and abort-reason precedence",async()=>{
  const api=await native();
  for(const boundary of [1,2,3,4])for(const [factory,defs] of [[api.createMCPToolHandler,definitions],[reference,originals]]){
    const reason=Symbol("abort");let checks=0,called=false;const signal={aborted:false,throwIfAborted(){checks++;if(checks>=boundary){this.aborted=true;throw reason;}}};
    const test=fixture(factory,defs,()=>{called=true;signal.aborted=true;throw new Error("handler failure");});
    await assert.rejects(()=>test.handler({}, {signal}),error=>error===reason);assert.equal(called,boundary===4);
  }
});
it("Native MCP handlers return declined approvals and await reports before mapping failures",async()=>{
  const api=await native();
  async function declined(factory,defs){return fixture(factory,defs,()=>{throw new defs.ApprovalDeclinedError({reason:"No",commandPath:"app.run"});}).handler({});}
  assert.deepEqual(await declined(api.createMCPToolHandler,definitions),await declined(reference,originals));
  for(const [factory,defs] of [[api.createMCPToolHandler,definitions],[reference,originals]]){
    const failure=new defs.UserError("bad input");let finish;reports.write.mockImplementation(context=>{assert.equal(context.error,failure);assert.deepEqual(context.params,{displayName:"default"});return new Promise(resolve=>{finish=resolve;});});
    const test=fixture(factory,defs,()=>{throw failure;});let complete=false;const result=outcome(test.handler).then(value=>{complete=true;return value;});
    for(let index=0;index<12&&!finish;index++)await Promise.resolve();assert.equal(typeof finish,"function");assert.equal(complete,false);finish({displayPath:"report.json"});assert.equal((await result).error.code,-32602);
    const reportFailure=Symbol("report");reports.write.mockImplementation(()=>{throw reportFailure;});await assert.rejects(()=>test.handler({}),error=>error===reportFailure);
  }
});
it("Native MCP handlers retain getter order and arbitrary values thrown by callbacks",async()=>{
  const api=await native();
  async function inspect(factory,defs){const trace=[],track=(value,label)=>new Proxy(value,{get(target,key,receiver){trace.push([label,String(key)]);return Reflect.get(target,key,receiver);}});const test=fixture(factory,defs,()=>({displayName:"ok"}),{tool:{resultSchema:record({displayName:{kind:"string"}})}});test.tool.command=track(test.tool.command,"command");test.environment.options=track(test.environment.options,"options");test.environment.runtime=track(test.environment.runtime,"runtime");const value=await factory(track(test.tool,"tool"),test.environment)({});return {value,trace};}
  assert.deepEqual(await inspect(api.createMCPToolHandler,definitions),await inspect(reference,originals));
  for(const failure of [undefined,null,false,17,Symbol("failure")])assert.deepEqual(await outcome(fixture(api.createMCPToolHandler,definitions,()=>{throw failure;}).handler),await outcome(fixture(reference,originals,()=>{throw failure;}).handler));
});
it("Native MCP handlers retain promise timing and independent concurrent invocations",async()=>{
  const api=await native();
  async function inspect(factory,defs){const trace=[],pending=[];const test=fixture(factory,defs,context=>({get then(){trace.push("then:"+context.params.displayName);return resolve=>pending.push(()=>resolve(context.params.displayName));}}),{environment:{runtime:{requestServices(){trace.push("services");return {then(resolve){trace.push("services:then");resolve({});}};}}}});const first=test.handler({display_name:"first"}),second=test.handler({display_name:"second"});trace.push("returned");queueMicrotask(()=>trace.push("tick"));for(let index=0;index<20&&pending.length<2;index++)await Promise.resolve();assert.equal(pending.length,2);pending[1]();const b=await second;pending[0]();const a=await first;return {trace,a,b};}
  assert.deepEqual(await inspect(api.createMCPToolHandler,definitions),await inspect(reference,originals));
});
it("Native MCP handlers run requirements before parameter validation and preserve secret report context",async()=>{
  const api=await native();
  for(const mode of ["ok","missing","check-failure","params-failure"]){
    async function inspect(factory,defs){const trace=[];reports.write.mockImplementation(context=>{trace.push(["report",context.params,context.secrets]);});const test=fixture(factory,defs,context=>{trace.push(["handler",context.secrets]);return "ok";},{command:{secrets:{token:{env:mode==="missing"?"MISSING":"TOKEN"}},requires:{async check(context){trace.push(["check",context.params,context.secrets]);return {ok:mode!=="check-failure",message:"rejected"};}}}});const result=await outcome(test.handler,mode==="params-failure"?{display_name:17}:{});return {trace,result};}
    assert.deepEqual(await inspect(api.createMCPToolHandler,definitions),await inspect(reference,originals));
  }
});
