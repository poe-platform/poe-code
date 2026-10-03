import assert from "node:assert/strict";
import {it} from "vitest";
import * as original from "../../toolcraft/dist/mcp.js";
import * as definitions from "../dist/index.js";
import * as referenceDefinitions from "../../toolcraft/dist/index.js";
const native=()=>import("../dist/mcp.js");
const initialize={protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"parity",version:"1"}};
async function session(server,notify){const value=server.createMessageSession(notify);await value.handleMessage("initialize",initialize);await value.handleMessage("notifications/initialized");return value;}
function root(defs,stream=false){const {S}=defs;return defs.defineGroup({name:"example",children:[defs.defineCommand({name:"hello",scope:["mcp"],params:S.Object({displayName:S.String({default:"default"})}),result:S.Object({displayName:S.String()}),handler:({params})=>({displayName:params.displayName})}),...(stream?[defs.defineStreamCommand({name:"watch",scope:["mcp"],params:S.Object({}),event:S.Object({itemName:S.String()}),async *handler({status}){status({type:"connected"});yield {itemName:"first"};}})]:[])]});}
it("Native public MCP has the original export surface and executes listed tools",async()=>{
  const api=await native();assert.deepEqual(Object.keys(api).sort(),Object.keys(original).sort());assert.deepEqual(api.MCP_STREAM_METHODS,original.MCP_STREAM_METHODS);
  async function inspect(module,defs){const connected=await session(module.createMCPServer(root(defs),{name:"example",version:"1",errorReports:false}));try{return [await connected.handleMessage("tools/list",{}),await connected.handleMessage("tools/call",{name:"example__hello",arguments:{display_name:"hello"}})];}finally{connected.close();}}
  assert.deepEqual(await inspect(api,definitions),await inspect(original,referenceDefinitions));
});
it("Native public MCP streams status, cased data and end through a real session",async()=>{
  const api=await native();
  async function inspect(module,defs){const notifications=[];let finish;const done=new Promise(resolve=>{finish=resolve;});const connected=await session(module.createMCPServer(root(defs,true),{name:"example",version:"1",errorReports:false}),message=>{notifications.push(message);if(message.params?.type==="end")finish();});try{const list=await connected.handleMessage(module.MCP_STREAM_METHODS.list,{}),subscription=await connected.handleMessage(module.MCP_STREAM_METHODS.subscribe,{name:"example__watch",arguments:{}});await done;return {list,subscription,notifications,unsubscribed:await connected.handleMessage(module.MCP_STREAM_METHODS.unsubscribe,{subscriptionId:subscription.result.subscriptionId})};}finally{connected.close();}}
  assert.deepEqual(await inspect(api,definitions),await inspect(original,referenceDefinitions));
});
it("Native public MCP rejects unsupported streaming before constructing the transport",async()=>{
  const api=await native();
  for(const [module,defs] of [[api,definitions],[original,referenceDefinitions]]){let created=false;await assert.rejects(()=>module.createMCPServerForTransport(root(defs,true),{name:"example",version:"1"},{supportsStreaming:false,createServer(){created=true;throw new Error("unexpected factory");}}),error=>error.message.includes("Unsupported streams: \"example__watch\""));assert.equal(created,false);}
});
it("Native public MCP preserves runtime getter order, registration and connect receivers",async()=>{
  const api=await native();
  async function inspect(module,defs){const trace=[],tracked=(value,label)=>new Proxy(value,{get(target,key,receiver){trace.push([label,String(key)]);return Reflect.get(target,key,receiver);}}),methods=new Map(),tools=[];const server={method(name,handler){trace.push(["method",this===server,name]);methods.set(name,handler);},registerTool(tool,handler){trace.push(["register",this===server,tool]);tools.push(handler);},connectSDK(){trace.push(["connect",this===server]);return Promise.resolve();}};const runtime=tracked({createServer(options){trace.push(["create",this===runtime,options]);return server;}},"runtime"),options=tracked({name:"example",version:"1",errorReports:false},"options");const result=await module.createMCPServerForTransport(root(defs),options,runtime);assert.equal(result,undefined);return {trace,result:await tools[0]({})};}
  assert.deepEqual(await inspect(api,definitions),await inspect(original,referenceDefinitions));
});
