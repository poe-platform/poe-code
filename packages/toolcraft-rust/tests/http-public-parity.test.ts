import assert from "node:assert/strict";
import {it,vi} from "vitest";
import {createHttpServer} from "tiny-http-mcp-server-rust/server";
import {createMCPServerForTransport} from "../dist/mcp.js";
import {prepareHostedOAuthRuntime} from "../dist/hosted-oauth-runtime.js";
import {isHostedOAuthConfiguration} from "../dist/hosted-oauth-config.js";
import {enableSourceMaps} from "../dist/stack-trim.js";
import {loadHostedOAuthReference} from "./hosted-oauth-reference.mjs";
const hooks=vi.hoisted(()=>({http:undefined,mcp:undefined,hosted:undefined,maps:undefined}));
vi.mock("tiny-http-mcp-server-rust/server",async load=>({...await load(),createHttpServer:options=>hooks.http(options)}));
vi.mock("../dist/mcp.js",()=>({createMCPServerForTransport:(...args)=>hooks.mcp(...args)}));
vi.mock("../dist/hosted-oauth-runtime.js",async load=>({...await load(),prepareHostedOAuthRuntime:config=>hooks.hosted(config)}));
vi.mock("../dist/stack-trim.js",()=>({enableSourceMaps:()=>hooks.maps()}));
const reference=loadHostedOAuthReference(["toVerifiedAccessToken","createHTTPMCPAuthorization","createTransportOptions","createListenOptions","createHTTPMCPServer","runHTTPMCP"],{createHttpServer,createMCPServerForTransport,prepareHostedOAuthRuntime,isHostedOAuthConfiguration,enableSourceMaps},new URL("../../toolcraft/src/http.ts",import.meta.url));
const native=()=>import("../dist/http-runtime.js");

function fixture(options={}){
  const trace=[],context={request:"context"};let transport,forwarded;
  const server={async listenHttp(value){assert.equal(this,server);trace.push(["listen",value]);return {value};},getRequestContext(){assert.equal(this,server);return context;}};
  const hosted={mcpPath:"/mcp",oauth:{hosted:true},requestHandler(){},async requestServices(identity){assert.equal(this,hosted);trace.push(["hostedServices",identity]);return {collision:"hosted",credential:true};}};
  hooks.maps=()=>trace.push("maps");hooks.hosted=async config=>{trace.push(["prepareHosted",config]);return hosted;};
  hooks.http=value=>{forwarded=value;trace.push("http");return server;};
  hooks.mcp=async(roots,selected,runtime)=>{trace.push(["mcp",roots]);transport=runtime;if(!options.missing)runtime.createServer({name:"server",version:"1",validateToolArguments:false});assert.equal(runtime.getRequestContext(),options.missing?undefined:context);if(options.failure)throw options.failure;};
  return {trace,server,hosted,get transport(){return transport;},get forwarded(){return forwarded;}};
}

it("Native HTTP and hosted OAuth entry points preserve runtime export names",async()=>{
  const [http,hosted,originalHttp,originalHosted]=await Promise.all([import("../dist/http.js"),import("../dist/http-hosted-oauth.js"),import("toolcraft/http"),import("toolcraft/http/hosted-oauth")]);
  assert.deepEqual(Object.keys(http).sort(),Object.keys(originalHttp).sort());assert.deepEqual(Object.keys(hosted).sort(),Object.keys(originalHosted).sort());
});

it("Native HTTP authorization validates issuer/resource and retains token projection",async()=>{
  const api=await native();
  async function inspect(module){const trace=[],options={resource:"https://resource.example:443/mcp",requiredScopes:["mcp"],authorizationServer:{issuer:"https://issuer.example",async verifyAccessToken(token,resource){assert.equal(this,options.authorizationServer);trace.push([token,resource]);return {resource,scopes:["mcp"],expiresAt:10,subject:"subject",clientId:"client",tokenId:"id"};}}};const oauth=module.createHTTPMCPAuthorization(options);const verified=await oauth.verifier.verify({token:"token",authorizationServers:["https://issuer.example"],resource:"https://resource.example/mcp"});for(const input of [{authorizationServers:[],resource:options.resource},{authorizationServers:["wrong"],resource:options.resource},{authorizationServers:["https://issuer.example"],resource:"https://wrong.example"}])await assert.rejects(oauth.verifier.verify(input));return {oauth:{...oauth,verifier:undefined},verified,trace};}
  assert.deepEqual(await inspect(api),await inspect(reference));
});

it("Native HTTP option projections preserve getters, symbols and own session flags",async()=>{
  const api=await native();function inspect(module){const trace=[],symbol=Symbol.for("fixture"),options=new Proxy(Object.assign(Object.create({sessionIdGenerator:undefined}),{port:0,oauth:null}),{get(target,key,receiver){trace.push(["get",String(key)]);return Reflect.get(target,key,receiver);},getOwnPropertyDescriptor(target,key){trace.push(["own",String(key)]);return Reflect.getOwnPropertyDescriptor(target,key);}});const transport=module.createTransportOptions(options,{name:"server",version:"1",validateToolArguments:false,[symbol]:"symbol"});const listen=module.createListenOptions(options);assert.equal(Object.hasOwn(transport,"sessionIdGenerator"),false);return {trace,transport,listen};}assert.deepEqual(inspect(api),inspect(reference));
});

it("Native HTTP construction infers stream support and preserves server identity",async()=>{
  const api=await native();async function inspect(module){const results=[];for(const options of [{},Object.create({sessionIdGenerator:undefined}),{sessionIdGenerator:undefined},{sessionIdGenerator:()=>"id"}]){const f=fixture(),server=await module.createHTTPMCPServer("roots",options);assert.equal(server,f.server);results.push({supportsStreaming:f.transport.supportsStreaming,hasSession:Object.hasOwn(f.forwarded,"sessionIdGenerator"),sessionIsUndefined:f.forwarded.sessionIdGenerator===undefined,trace:f.trace});}return results;}assert.deepEqual(await inspect(api),await inspect(reference));
});

it("Native hosted HTTP merges application services before provider services",async()=>{
  const api=await native();async function inspect(module){const f=fixture(),oauth={kind:"hosted"},options={oauth,sessionIdGenerator:()=>"ignored",enableJsonResponse:false,async requestServices(context){assert.equal(this,undefined);f.trace.push(["application",context.marker]);return {collision:"application",application:true};}};const server=await module.createHTTPMCPServer("roots",options);const context={marker:"context",auth:{issuer:"issuer",subject:"subject",clientId:"client",scopes:["mcp"],resource:new URL("https://resource.example/mcp")}};const services=await f.transport.requestServices(context);for(const auth of [undefined,null,{}])await assert.rejects(f.transport.requestServices({auth}),{message:"Hosted OAuth request is missing a verified subject."});await server.listenHttp({path:"mcp/",port:0});return {services,trace:f.trace,session:f.forwarded.sessionIdGenerator,json:f.forwarded.enableJsonResponse,supportsStreaming:f.transport.supportsStreaming,oauth:f.forwarded.oauth};}assert.deepEqual(await inspect(api),await inspect(reference));
});

it("Native hosted HTTP normalizes paths and preserves arbitrary failures",async()=>{
  const api=await native();async function inspect(module){const outcomes=[];for(const path of [undefined,"mcp","/mcp","/mcp/","/wrong","mcp//","",null]){fixture();const server=await module.createHTTPMCPServer("roots",{oauth:{kind:"hosted"}});try{outcomes.push(await server.listenHttp({path}));}catch(error){outcomes.push([error.name,error.message]);}}fixture({missing:true});await assert.rejects(module.createHTTPMCPServer("roots",{}),{message:"Toolcraft HTTP MCP server was not created."});const failure=Symbol("failure");fixture({failure});await assert.rejects(module.createHTTPMCPServer("roots",{}),error=>error===failure);return outcomes;}assert.deepEqual(await inspect(api),await inspect(reference));
});

it("Native HTTP run enables source maps before startup and forwards listener options",async()=>{
  const api=await native();async function inspect(module){const f=fixture();const result=await module.runHTTPMCP("roots",{port:0,hostname:"127.0.0.1",headersTimeoutMs:7});return {trace:f.trace,result};}assert.deepEqual(await inspect(api),await inspect(reference));
});

it("Native HTTP authorization preserves live getters, await boundaries and thrown identity",async()=>{
  const api=await native();
  async function inspect(module){
    const trace=[];
    const tracked=(value,label)=>new Proxy(value,{get(target,key,receiver){trace.push(`${label}.${String(key)}`);return Reflect.get(target,key,receiver);}});
    const failure=Symbol("verification failure");let reject=false,release;
    const barrier=new Promise(resolve=>{release=resolve;});
    const authority=tracked({issuer:"https://issuer.example",async verifyAccessToken(token,resource){assert.equal(this,authority);trace.push(["verify",token,resource]);await barrier;if(reject)throw failure;return tracked({resource,scopes:["mcp"],expiresAt:10,subject:"subject",clientId:"client",tokenId:"id"},"verified");}},"authority");
    const options=tracked({authorizationServer:authority,resource:"https://resource.example/mcp",requiredScopes:["mcp"],scopesSupported:null},"options");
    const authorization=module.createHTTPMCPAuthorization(options);
    const rawInput={token:"before",authorizationServers:["https://issuer.example"],resource:options.resource},input=tracked(rawInput,"input");
    const pending=authorization.verifier.verify(input);rawInput.token="after";release();
    const value=await pending;assert.equal(value.token,"after");
    reject=true;await assert.rejects(authorization.verifier.verify(input),error=>error===failure);
    return {trace,value};
  }
  assert.deepEqual(await inspect(api),await inspect(reference));
});
