import assert from "node:assert/strict";
import {it,vi,beforeEach} from "vitest";
const state=vi.hoisted(()=>({trace:[],proxy:true,resolve:async()=>{},servers:[]}));
const fake=vi.hoisted(()=>options=>{const server={options,method(name){state.trace.push(["method",name]);},registerTool(){},listen(){state.trace.push(["listen",this===server]);return Promise.resolve();},connectSDK(transport){state.trace.push(["connect",this===server,transport]);return Promise.resolve();}};state.servers.push(server);return server;});
vi.mock("tiny-stdio-mcp-server-rust",async load=>({...await load(),createServer:fake}));
vi.mock("tiny-stdio-mcp-server",async load=>({...await load(),createServer:fake}));
vi.mock("../dist/mcp-proxy.js",async load=>({...await load(),hasMcpProxyGroups:()=>state.proxy,resolveMcpProxies:(...args)=>state.resolve(...args)}));
vi.mock("../../toolcraft/dist/mcp-proxy.js",async load=>({...await load(),hasMcpProxyGroups:()=>state.proxy,resolveMcpProxies:(...args)=>state.resolve(...args)}));
import * as native from "../dist/mcp.js";
import * as original from "../../toolcraft/dist/mcp.js";
beforeEach(()=>{state.trace=[];state.servers=[];state.proxy=true;state.resolve=async()=>{};});
const root=()=>({kind:"group",name:"app",aliases:[],children:[],secrets:{}});
it("Native deferred MCP resolves lazily once for concurrent listen/connect/await",async()=>{
  async function inspect(api){state.trace=[];state.servers=[];let release;state.resolve=()=>{state.trace.push("resolve");return new Promise(resolve=>{release=resolve;});};const deferred=api.createMCPServer(root(),{name:"app",version:"1",approvals:false});assert.equal(state.servers.length,0);assert.deepEqual(state.trace,[]);const transport={transport:true};const listening=deferred.listen(),connected=deferred.connect(transport),awaited=Promise.resolve(deferred);assert.deepEqual(state.trace,["resolve"]);release();await listening;await connected;const resolved=await awaited;assert.equal(state.servers.length,1);await resolved.connect(transport);return state.trace;}
  assert.deepEqual(await inspect(native),await inspect(original));
});
it("Native deferred MCP resets failed resolution and preserves rejection identity",async()=>{
  for(const api of [native,original]){state.servers=[];const failure=Symbol("discovery"),options={name:"app",version:"1",approvals:false};let attempts=0;state.resolve=async()=>{if(++attempts===1)throw failure;};const deferred=api.createMCPServer(root(),options);await assert.rejects(()=>deferred.listen(),error=>error===failure);const resolved=await deferred;assert.equal(attempts,2);assert.equal(state.servers.length,1);assert.equal(typeof resolved.connect,"function");}
});
it("Native immediate MCP spreads the underlying server and binds SDK connection to it",async()=>{
  for(const api of [native,original]){state.trace=[];state.servers=[];state.proxy=false;state.resolve=async()=>{throw new Error("unexpected discovery");};const server=api.createMCPServer(root(),{name:"app",version:"1",approvals:false});assert.notEqual(server,state.servers[0]);const transport={};await server.connect(transport);assert.deepEqual(state.trace.at(-1),["connect",true,transport]);}
});
it("Native runMCP awaits discovery before listening and retains lifecycle failures",async()=>{
  async function inspect(api){state.trace=[];state.servers=[];state.resolve=async()=>{state.trace.push("resolve");};await api.runMCP(root(),{name:"app",version:"1",approvals:false});return state.trace;}
  assert.deepEqual(await inspect(native),await inspect(original));
  for(const api of [native,original]){state.servers=[];const failure=Symbol("discovery");state.resolve=async()=>{throw failure;};await assert.rejects(()=>api.runMCP(root(),{name:"app",version:"1",approvals:false}),error=>error===failure);assert.equal(state.servers.length,0);}
});
