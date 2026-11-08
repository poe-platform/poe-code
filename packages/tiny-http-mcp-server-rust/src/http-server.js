import http from 'node:http';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createRequire} from 'node:module';
import {createServer} from './stdio-server.js';
import {StreamableHttpTransport} from './http-transport.js';
import {authorizeBearerRequest,PROTECTED_RESOURCE_METADATA_CACHE_CONTROL,PROTECTED_RESOURCE_METADATA_PATH} from './auth.js';
const native=createRequire(import.meta.url)('./tiny-http-mcp-server-rust.node');
export function createProtectedResourceMetadataDocument(options){
 const input={resource:options.resource instanceof URL?options.resource.toString():options.resource,authorizationServers:options.authorizationServers.map(value=>value instanceof URL?value.toString():value)};
 for(const key of ['bearerMethodsSupported','scopesSupported'])if(options[key]!==undefined)input[key]=[...options[key]];
 return native.protectedResourceMetadata(JSON.stringify(input));
}
export function createHttpServer(options){
 const storage=new AsyncLocalStorage(),server=createServer(options);
 const transport=new StreamableHttpTransport(server,options,(request,callback)=>storage.run({request,sessionId:Array.isArray(request.headers['mcp-session-id'])?request.headers['mcp-session-id'][0]:request.headers['mcp-session-id'],auth:request.auth},callback));
 const metadata=options.oauth===undefined?undefined:JSON.stringify(createProtectedResourceMetadataDocument(options.oauth));
 const fallback={request:{headers:{},socket:{}}},tool=server.tool.bind(server),registerTool=server.registerTool.bind(server);
 server.tool=(name,description,schema,handler,outputSchema)=>{tool(name,description,schema,(args,context)=>handler(args,{...(storage.getStore()??fallback),...context}),outputSchema);return server;};
 server.registerTool=(definition,handler)=>{registerTool(definition,(args,context)=>handler(args,{...(storage.getStore()??fallback),...context}));return server;};
 async function authorize(request,response,path){
  if(options.oauth===undefined||request.method==='OPTIONS'||request.auth!==undefined)return true;
  const result=await authorizeBearerRequest(request,{...options.oauth,protectedResourcePath:path,trustedProxy:options.trustedProxy});
  if(result.ok)return true;
  options.observability?.onEvent?.({type:'auth.failure',statusCode:result.statusCode,...(result.statusCode===503?{}:{challenge:result.challenge}),sessionId:Array.isArray(request.headers['mcp-session-id'])?request.headers['mcp-session-id'][0]:request.headers['mcp-session-id']});
  response.writeHead(result.statusCode,{...(result.statusCode===503?{}:{'WWW-Authenticate':result.challenge}),'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});response.end();return false;
 }
 server.handleRequest=async(request,response)=>{
  if(options.requestHandler!==undefined&&await options.requestHandler(request,response))return;
  const path=typeof request.baseUrl==='string'&&request.baseUrl.length>0?request.baseUrl:'/mcp';
  if(await authorize(request,response,path))await transport.handleRequest(request,response);
 };
 server.getRequestContext=()=>storage.getStore();
 server.listenHttp=async(optionsForListen={})=>{
  const {port=0,hostname='127.0.0.1',path:requestedPath='/mcp',signal,requestTimeoutMs,headersTimeoutMs,keepAliveTimeoutMs}=optionsForListen;
  const path=native.normalizeHttpPath(requestedPath,false);
  const listener=http.createServer(async(request,response)=>{
   const url=new URL(request.url??'/','http://127.0.0.1');
   try{
    if(options.requestHandler!==undefined&&await options.requestHandler(request,response))return;
    if(metadata!==undefined&&request.method==='GET'&&[PROTECTED_RESOURCE_METADATA_PATH,`${PROTECTED_RESOURCE_METADATA_PATH}${path}`].includes(url.pathname)){
     response.writeHead(200,{'Cache-Control':PROTECTED_RESOURCE_METADATA_CACHE_CONTROL,'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});response.end(metadata);return;
    }
    if(url.pathname!==path){response.writeHead(404,{'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});response.end();return;}
    if(await authorize(request,response,path))await transport.handleRequest(request,response);
   }catch{if(!response.headersSent)response.writeHead(500,{'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});if(!response.writableEnded)response.end();}
  });
  if(requestTimeoutMs!==undefined)listener.requestTimeout=requestTimeoutMs;
  if(headersTimeoutMs!==undefined)listener.headersTimeout=headersTimeoutMs;
  if(keepAliveTimeoutMs!==undefined)listener.keepAliveTimeout=keepAliveTimeoutMs;
  await new Promise((resolve,reject)=>{
   const error=error=>{listener.off('listening',listening);reject(error);},listening=()=>{listener.off('error',error);resolve();};
   listener.once('error',error);listener.once('listening',listening);listener.listen(port,hostname);
  });
  const address=listener.address();if(address===null||typeof address==='string')throw new Error('Expected Node HTTP server to bind to a TCP port');
  let pending,removeAbort=()=>{};
  const close=()=>{
   if(pending!==undefined)return pending;
   pending=(async()=>{removeAbort();await transport.close();if(listener.listening)await new Promise((resolve,reject)=>{listener.close(error=>error?reject(error):resolve());listener.closeIdleConnections?.();});})().catch(error=>{pending=undefined;throw error;});return pending;
  };
  if(signal!==undefined){const aborted=()=>{void close();};if(signal.aborted)aborted();else{signal.addEventListener('abort',aborted,{once:true});removeAbort=()=>signal.removeEventListener('abort',aborted);}}
  const url=new URL('http://127.0.0.1');url.hostname=hostname.includes(':')&&!hostname.startsWith('[')?`[${hostname}]`:hostname;url.port=String(address.port);url.pathname=path;
  return {url:url.toString(),port:address.port,close,closeAllConnections:()=>listener.closeAllConnections()};
 };
 return server;
}
