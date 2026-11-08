import assert from "node:assert/strict";
import {test} from "node:test";
import {createServer} from "../dist/index.js";
import {createServer as reference} from "tiny-stdio-mcp-server";
const metadata={"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}};
test("SDK custom requests retain original undefined properties and parameter identity",async()=>{
  for(const modern of [false,true])for(const factory of [reference,createServer]){
    let receive;
    const transport={async start(){},async close(){},async send(message){receive(message);}};
    const server=factory({name:"test",version:"1"});
    const params={name:undefined,nested:{value:undefined},...(modern?{_meta:metadata}:{})};let seen;
    server.method("capture",value=>{seen=value;return {own:Object.hasOwn(value,"name"),nested:Object.hasOwn(value.nested,"value")};});
    const connected=server.connectSDK(transport);
    const request=(method,params)=>new Promise(resolve=>{receive=resolve;transport.onmessage({jsonrpc:"2.0",id:1,method,params});});
    if(!modern)await request("initialize",{});
    const result=await request("capture",params);
    assert.equal(seen,params);assert.equal(result.result.own,true);assert.equal(result.result.nested,true);
    transport.onclose?.();
    await connected;
  }
});
test("direct custom requests preserve undefined properties and original parameter identity",async()=>{
  for(const modern of [false,true])for(const factory of [reference,createServer]){
    const server=factory({name:"test",version:"1"});const params={name:undefined,nested:{value:undefined},...(modern?{_meta:metadata}:{})};let seen;
    server.method("capture",value=>{seen=value;return {own:Object.hasOwn(value,"name"),nested:Object.hasOwn(value.nested,"value")};});
    if(!modern)await server.handleMessage("initialize");
    const result=await server.handleMessage("capture",params);assert.equal(seen,params);assert.equal(result.result.own,true);assert.equal(result.result.nested,true);
  }
});
test("unvalidated tool requests retain original arguments including undefined values",async()=>{
  for(const args of [undefined,{optional:undefined}])for(const factory of [reference,createServer]){
    const server=factory({name:"test",version:"1",validateToolArguments:false});let seen;
    server.registerTool({name:"capture",inputSchema:{type:"object",properties:{}}},value=>{seen=value;return "ok";});
    await server.handleMessage("initialize");await server.handleMessage("tools/call",{name:"capture",arguments:args});if(args==null)assert.deepEqual(seen,{});else assert.equal(seen,args);
  }
});
test("null tool arguments are rejected before handler invocation",async()=>{
  for(const factory of [reference,createServer]){
    const server=factory({name:"test",version:"1",validateToolArguments:false});let calls=0;
    server.registerTool({name:"capture",inputSchema:{type:"object",properties:{}}},()=>{calls++;return "ok";});
    await server.handleMessage("initialize");
    assert.deepEqual(await server.handleMessage("tools/call",{name:"capture",arguments:null}),{error:{code:-32602,message:"Tool arguments must be an object"}});
    assert.equal(calls,0);
  }
});
test("invalid structured JSON returns preserve reference protocol errors",async()=>{
  for(const modern of [false,true])for(const type of ["array","object"])for(const explicit of [false,true]){
    const value=type==="array"?[undefined]:{optional:undefined};
    async function inspect(factory){const server=factory({name:"test",version:"1"});server.registerTool({name:"capture",inputSchema:{type:"object",properties:{}},outputSchema:type==="array"?{type,items:{type:"string"}}:{type,properties:{optional:{type:"string"}}}},()=>explicit?{content:[{type:"text",text:"invalid"}],structuredContent:value}:value);if(!modern)await server.handleMessage("initialize");return await server.handleMessage("tools/call",{name:"capture",arguments:{},...(modern?{_meta:metadata}:{})});}
    assert.deepEqual(await inspect(createServer),await inspect(reference));
  }
});
