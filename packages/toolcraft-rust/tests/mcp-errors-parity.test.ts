import assert from "node:assert/strict";
import {it} from "vitest";
import {original} from "./mcp-errors-reference.mjs";
import {ToolError} from "tiny-stdio-mcp-server-rust";
import {ToolError as OriginalToolError} from "tiny-stdio-mcp-server";
import {UserError} from "../dist/index.js";
import {UserError as OriginalUserError} from "../../toolcraft/dist/index.js";
const native=()=>import("../dist/mcp-errors.js");
const pending=()=>({status:"pending-approval",approvalId:"approval-1",message:"Pending",enqueuedAt:"2026-10-02T00:00:00Z",extra:17});
const snapshot=error=>({name:error.name,message:error.message,code:error.code,data:error.data});
const http=status=>({name:"HttpError",message:"Request failed",request:{method:"POST",url:"https://example.test/records",headers:{}},response:{status,statusText:"Error",headers:{"x-request-id":"synthetic","retry-after":"3"},body:{message:"Rejected",token:"synthetic secret",errors:{name:["Invalid name"]}}}});
it("Native MCP recognizes approval records with matching short-circuit property access",async()=>{
  const api=await native();
  for(const value of [undefined,null,false,17,"pending",{},pending(),{...pending(),approvalId:17},Object.assign([],pending())])assert.equal(api.isHumanInLoopPending(value),original.isHumanInLoopPending(value));
  function inspect(module){const trace=[],value=new Proxy(pending(),{get(target,key,receiver){trace.push(String(key));return Reflect.get(target,key,receiver);}});return {value:module.isHumanInLoopPending(value),trace};}
  assert.deepEqual(inspect(api),inspect(original));
});
it("Native MCP renders pending and declined approvals with exact content blocks",async()=>{
  const api=await native();assert.deepEqual(api.renderPendingApproval(pending()),original.renderPendingApproval(pending()));
  for(const reason of [undefined,"","No thanks",null]){const error={reason,commandPath:"records.create"};assert.deepEqual(api.renderDeclinedApproval(error),original.renderDeclinedApproval(error));}
  function inspect(module){const trace=[],error=new Proxy({reason:"Declined",commandPath:"run"},{get(target,key,receiver){trace.push(String(key));return Reflect.get(target,key,receiver);}});return {value:module.renderDeclinedApproval(error),trace};}
  assert.deepEqual(inspect(api),inspect(original));
});
it("Native MCP maps error classes and retains existing ToolError identity",async()=>{
  const api=await native();
  const already=new ToolError(-32000,"Existing",{value:17}),referenceError=new OriginalToolError(-32000,"Existing",{value:17});assert.equal(api.toToolError(already),already);assert.equal(original.toToolError(referenceError),referenceError);
  assert.deepEqual(snapshot(api.toToolError(new UserError("Input error"))),snapshot(original.toToolError(new OriginalUserError("Input error"))));
  for(const error of [new Error("Failure"),undefined,null,false,17,Symbol("failure"),{toString(){return "custom error";}}])assert.deepEqual(snapshot(api.toToolError(error)),snapshot(original.toToolError(error)));
  for(const module of [api,original])assert.equal(module.toToolError({toString(){return module.toToolError(new Error("nested")).message;}}).message,"nested");
});
it("Native MCP maps HTTP status families and preserves redacted error envelopes",async()=>{
  const api=await native();
  for(const status of [399,400,401,429,499,500,503,NaN]){const actual=snapshot(api.toToolError(http(status),"reports/synthetic.json"));assert.deepEqual(actual,snapshot(original.toToolError(http(status),"reports/synthetic.json")));assert.ok(!JSON.stringify(actual).includes("synthetic secret"));}
});
it("Native MCP preserves HTTP getter order and arbitrary mapping or rendering failures",async()=>{
  const api=await native();
  function inspect(module){const trace=[],track=(value,label)=>new Proxy(value,{get(target,key,receiver){trace.push([label,String(key)]);return Reflect.get(target,key,receiver);}}),value=http(429);value.response=track(value.response,"response");return {value:snapshot(module.toToolError(track(value,"error"),"report")),trace};}
  assert.deepEqual(inspect(api),inspect(original));
  for(const failure of [undefined,null,false,17,Symbol("failure")])for(const module of [api,original]){assert.throws(()=>module.toToolError({toString(){throw failure;}}),error=>error===failure);assert.throws(()=>module.renderPendingApproval({...pending(),toJSON(){throw failure;}}),error=>error===failure);}
});
it("Native MCP async error mapping retains argument identity, await order and reentrancy",async()=>{
  const api=await native();
  async function inspect(module){const trace=[],params={},session={},value={identity:17};const handler=function(p,s){trace.push([this,p===params,s===session]);return {get then(){trace.push("then");return resolve=>{trace.push("resolve");resolve(value);};}};};const wrapped=module.withToolErrorMapping(handler),task=wrapped(params,session);trace.push("returned");queueMicrotask(()=>trace.push("tick"));const result=await task;assert.equal(result,value);trace.push("done");return trace;}
  assert.deepEqual(await inspect(api),await inspect(original));
  for(const failure of [undefined,null,false,17,new Error("Failure")])for(const async of [false,true]){
    async function inspectFailure(module){try{await module.withToolErrorMapping(()=>{if(async)return Promise.reject(failure);throw failure;})({},{});}catch(error){return snapshot(error);}}
    assert.deepEqual(await inspectFailure(api),await inspectFailure(original));
  }
  for(const module of [api,original]){const releases=[];const wrapped=module.withToolErrorMapping(()=>new Promise(resolve=>releases.push(resolve)));const first=wrapped({},{}),second=wrapped({},{});releases[1]("second");assert.equal(await second,"second");releases[0]("first");assert.equal(await first,"first");}
});
