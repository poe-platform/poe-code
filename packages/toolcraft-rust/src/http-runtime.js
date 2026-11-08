import {createRequire} from "node:module";
import {createHttpServer} from "tiny-http-mcp-server-rust/server";
import {createMCPServerForTransport} from "./mcp.js";
import {enableSourceMaps} from "./stack-trim.js";
import {isHostedOAuthConfiguration} from "./hosted-oauth-config.js";
import {prepareHostedOAuthRuntime} from "./hosted-oauth-runtime.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
const defineProperty=Object.defineProperty;
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.httpPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,object:()=>({}),
  error:message=>{throw new Error(message);},
  copy:value=>({...value}),set:(object,key,value)=>{defineProperty(object,key,{value,enumerable:true,writable:true,configurable:true});},
  owns:(object,key)=>!!Object.prototype.hasOwnProperty.call(object,key),
  resource:options=>new URL(options.resource).href,
  one:values=>values.length===1,scopes:values=>[...values],
  authorization:(options,issuer,resource,requiredScopes,scopesSupported)=>({resource,authorizationServers:[issuer],requiredScopes,scopesSupported,verifier:{async verify(input){invoke("verify",[input,issuer,resource]);const verified=await options.authorizationServer.verifyAccessToken(input.token,resource);return invoke("verified",[input.token,issuer,verified]);}}}),
  verified:(token,issuer,resource,scopes,expiresAt,sub,client_id,aud,jti,subject,clientId)=>({token,issuer,audience:[resource],scopes,expiresAt,claims:{sub,client_id,aud,jti},subject,clientId}),
  hosted:isHostedOAuthConfiguration,
  resolved:(options,runtime,applicationServices,path,sessionIdGenerator,enableJsonResponse)=>({path,options:{...options,oauth:runtime.oauth,sessionIdGenerator,enableJsonResponse,requestServices:async context=>{const identity=invoke("subject",[context]);const application={...(invoke("hasApplication",[applicationServices])?await applicationServices(context):{})};return {...application,...await runtime.requestServices(invoke("identity",[identity]))};},requestHandler:runtime.requestHandler}}),
  subject:(auth,subject)=>({auth,subject}),identity:(issuer,subject,clientId,scopes,resource)=>({issuer,subject,clientId,scopes,resource}),
  wrap:(server,path)=>{const listenHttp=server.listenHttp.bind(server);server.listenHttp=async(listenOptions={})=>listenHttp(invoke("hostedListen",[listenOptions,path]));},
  startsSlash:listenOptions=>!!listenOptions.path.startsWith("/"),prefix:value=>`/${value}`,
  long:withLeadingSlash=>withLeadingSlash.length>1,endsSlash:withLeadingSlash=>!!withLeadingSlash.endsWith("/"),trimSlash:withLeadingSlash=>withLeadingSlash.slice(0,-1),
  conflict(requestedPath,hostedMcpPath){throw new Error(`Hosted OAuth MCP path ${JSON.stringify(requestedPath)} conflicts with publicUrl path ${JSON.stringify(hostedMcpPath)}.`);},
  listen:(listenOptions,path)=>({...listenOptions,path}),
  invalidOperation(){throw new TypeError("Invalid Toolcraft HTTP operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function toVerifiedAccessToken(token,issuer,verified){return invoke("verified",[token,issuer,verified]);}
export function createHTTPMCPAuthorization(options){return invoke("authorization",[options]);}
export function createTransportOptions(options,serverOptions){return invoke("transport",[options,serverOptions]);}
export function createListenOptions(options){return invoke("listen",[options]);}
export async function createHTTPMCPServer(roots,options){
  let resolvedOptions=options,hostedMcpPath;
  if(invoke("hosted",[options])){const runtime=await prepareHostedOAuthRuntime(options.oauth);const resolved=invoke("resolved",[options,runtime]);resolvedOptions=resolved.options;hostedMcpPath=resolved.path;}
  let server;
  await createMCPServerForTransport(roots,resolvedOptions,{
    supportsStreaming:invoke("streaming",[resolvedOptions]),
    createServer(serverOptions){server=createHttpServer(createTransportOptions(resolvedOptions,serverOptions));return server;},
    getRequestContext(){return server?.getRequestContext();},
    requestServices:resolvedOptions.requestServices
  });
  return invoke("finish",[server,hostedMcpPath]);
}
export async function runHTTPMCP(roots,options){enableSourceMaps();const server=await createHTTPMCPServer(roots,options);return server.listenHttp(createListenOptions(options));}
