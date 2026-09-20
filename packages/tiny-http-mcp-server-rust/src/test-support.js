import http from 'node:http';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createRequire} from 'node:module';
import {Audio,defineSchema,File,Image} from './stdio-server.js';
import {createHttpServer} from './http-server.js';
const native=createRequire(import.meta.url)('./tiny-http-mcp-server-rust.node');

const STATE=Symbol.for('tiny-http-mcp-server-rust.in-memory-http-state');
const META=Symbol.for('tiny-http-mcp-server-rust.in-memory-http-meta');
function state(){return globalThis[STATE]??= {installed:false,nextPort:41000,servers:new Map()};}
function hostname(value){return value?.startsWith('[')&&value.endsWith(']')?value.slice(1,-1):value;}
function origin(host,port){return new URL(`http://${host.includes(':')?`[${host}]`:host}:${port}`).origin;}
function normalized(input,init){
 if(input instanceof Request)return {url:new URL(input.url),init:{...init,method:init.method??input.method,headers:init.headers??input.headers,body:init.body??input.body,signal:init.signal??input.signal}};
 return {url:new URL(String(input)),init};
}
function aborted(signal){return signal.reason??new DOMException('Request aborted','AbortError');}
async function bytes(body){
 if(body===undefined||body===null)return undefined;
 if(typeof body==='string'||body instanceof URLSearchParams)return Buffer.from(String(body));
 if(body instanceof Uint8Array)return Buffer.from(body);
 if(body instanceof ArrayBuffer)return Buffer.from(body);
 if(body instanceof ReadableStream||body instanceof Blob)return Buffer.from(await new Response(body).arrayBuffer());
 return Buffer.from(String(body));
}

export function installInMemoryHttp(){
 const current=state();if(current.installed)return;
 current.installed=true;
 const address=http.Server.prototype.address,close=http.Server.prototype.close,closeAll=http.Server.prototype.closeAllConnections,fetch=globalThis.fetch.bind(globalThis);
 http.Server.prototype.listen=function(...args){
  if(this[META]?.listening)throw Object.assign(new Error('Listen method has been called more than once without closing.'),{code:'ERR_SERVER_ALREADY_LISTEN'});
  const options=args.find(arg=>arg!==null&&typeof arg==='object')??{};
  const callback=args.find(arg=>typeof arg==='function');
  const requested=options.port??(typeof args[0]==='number'?args[0]:0);
  const host=hostname(options.host??options.hostname??(typeof args[1]==='string'?args[1]:undefined))||'127.0.0.1';
  const normalizedHost=host==='localhost'?'127.0.0.1':host;
  let port=requested;
  if(port===0){do{port=current.nextPort++;}while(current.servers.has(origin(normalizedHost,port)));}
  const key=origin(normalizedHost,port);
  if(current.servers.has(key)){queueMicrotask(()=>this.emit('error',Object.assign(new Error(`Address already in use: ${key}`),{code:'EADDRINUSE'})));return this;}
  const meta={origin:key,address:{address:normalizedHost,family:normalizedHost.includes(':')?'IPv6':'IPv4',port},listening:true,responses:new Set()};
  this[META]=meta;current.servers.set(key,this);
  Object.defineProperty(this,'listening',{configurable:true,get(){return this[META]?.listening??false;}});
  queueMicrotask(()=>{this.emit('listening');callback?.();});return this;
 };
 http.Server.prototype.address=function(){return this[META]?.address??address.call(this);};
 http.Server.prototype.close=function(callback){
  const meta=this[META];if(meta===undefined)return close.call(this,callback);
  if(meta.listening){current.servers.delete(meta.origin);meta.listening=false;}
  queueMicrotask(()=>{callback?.();this.emit('close');});return this;
 };
 http.Server.prototype.closeAllConnections=function(){
  const meta=this[META];if(meta===undefined)return closeAll?.call(this);
  for(const response of [...meta.responses])response.destroy();
 };
 globalThis.fetch=async(input,init={})=>{
  const request=normalized(input,init),server=current.servers.get(request.url.origin);
  return server===undefined?fetch(input,init):fetchInMemory(server,request.url,request.init);
 };
}

async function fetchInMemory(server,url,init){
 const signal=init.signal??undefined;if(signal?.aborted)throw aborted(signal);
 const body=await bytes(init.body);if(signal?.aborted)throw aborted(signal);
 const headers=new Headers(init.headers);if(!headers.has('host'))headers.set('host',url.host);
 const request=Object.assign(Readable.from(body===undefined?[]:[body]),{method:init.method??'GET',url:`${url.pathname}${url.search}`,headers:Object.fromEntries(headers),socket:{}});
 const response=new EventEmitter();
 const responseHeaders=new Headers();let controller,finished=false,resolveHeaders,rejectHeaders;
 const ready=new Promise((resolve,reject)=>{resolveHeaders=resolve;rejectHeaders=reject;});
 const stream=new ReadableStream({start(value){controller=value;},cancel(){response.destroy();}});
 Object.assign(response,{statusCode:200,statusMessage:undefined,headersSent:false,writableEnded:false,destroyed:false,writableLength:0});
 const cleanup=()=>{signal?.removeEventListener('abort',onAbort);server[META]?.responses.delete(response);};
 const markHeaders=()=>{
  if(response.headersSent)return;
  response.headersSent=true;
  const noBody=request.method==='HEAD'||[204,205,304].includes(response.statusCode);
  try{resolveHeaders(new Response(noBody?null:stream,{status:response.statusCode,statusText:response.statusMessage??http.STATUS_CODES[response.statusCode]??'',headers:responseHeaders}));}catch(error){rejectHeaders(error);response.destroy(error);}
 };
 response.setHeader=(name,value)=>{
  responseHeaders.delete(name);
  if(Array.isArray(value)&&name.toLowerCase()==='set-cookie')for(const item of value)responseHeaders.append(name,item);
  else responseHeaders.set(name,Array.isArray(value)?value.join(', '):String(value));
  return response;
 };
 response.getHeader=name=>responseHeaders.get(name)??undefined;
 response.getHeaders=()=>Object.fromEntries(responseHeaders);
 response.getHeaderNames=()=>[...responseHeaders.keys()];
 response.hasHeader=name=>responseHeaders.has(name);
 response.removeHeader=name=>responseHeaders.delete(name);
 response.writeHead=(status,reason,values)=>{
  response.statusCode=status;if(typeof reason==='string')response.statusMessage=reason;
  for(const [name,value] of Object.entries(typeof reason==='string'?values??{}:reason??{}))response.setHeader(name,value);
  markHeaders();return response;
 };
 response.flushHeaders=markHeaders;
 response.write=(chunk)=>{
  if(finished)return false;
  markHeaders();controller.enqueue(Buffer.from(chunk));return true;
 };
 response.end=chunk=>{
  if(finished)return response;
  if(chunk!==undefined)response.write(chunk);else markHeaders();
  finished=true;response.writableEnded=true;cleanup();
  try{controller.close();}catch{}response.emit('finish');response.emit('close');return response;
 };
 response.destroy=error=>{
  if(finished)return response;
  finished=true;response.destroyed=true;cleanup();request.destroy();
  if(!response.headersSent)rejectHeaders(error??new Error('Response closed before headers'));
  try{if(error===undefined)controller.close();else controller.error(error);}catch{}
  response.emit('close');return response;
 };
 const onAbort=()=>response.destroy(aborted(signal));
 signal?.addEventListener('abort',onAbort,{once:true});server[META]?.responses.add(response);
 try{server.emit('request',request,response);}catch(error){response.destroy(error);}
 return ready;
}

export async function nodeFetch(input,init={}){
 const requestInput=normalized(input,init),{url}=requestInput;init=requestInput.init;
 const server=globalThis[STATE]?.servers.get(url.origin);
 if(server!==undefined)return fetchInMemory(server,url,init);
 const signal=init.signal??undefined;if(signal?.aborted)throw aborted(signal);
 const body=await bytes(init.body);if(signal?.aborted)throw aborted(signal);
 const client=url.protocol==='https:'?https:http;
 return new Promise((resolve,reject)=>{
  const headers=new Headers(init.headers);
  const request=client.request({method:init.method??'GET',hostname:hostname(url.hostname),port:url.port?Number(url.port):url.protocol==='https:'?443:80,path:`${url.pathname}${url.search}`,headers:Object.fromEntries(headers)},response=>{
   const responseHeaders=new Headers();
   for(const [name,value] of Object.entries(response.headers)){
    if(Array.isArray(value))for(const item of value)responseHeaders.append(name,item);
    else if(typeof value==='string')responseHeaders.set(name,value);
   }
   const noBody=init.method==='HEAD'||[204,205,304].includes(response.statusCode);
   try{resolve(new Response(noBody?null:Readable.toWeb(response),{status:response.statusCode,statusText:response.statusMessage??'',headers:responseHeaders}));if(noBody)response.resume();}catch(error){response.destroy();reject(error);}
  });
  const onAbort=()=>request.destroy(aborted(signal));
  const cleanup=()=>signal?.removeEventListener('abort',onAbort);
  request.on('error',reject);request.once('close',cleanup);
  signal?.addEventListener('abort',onAbort,{once:true});
  if(body!==undefined)request.write(body);request.end();
 });
}

export function createTestMcpServer(options={}){
 const selected={name:options.name??'conformance-test-server',version:options.version??'1.0.0'};
 for(const key of ['enableJsonResponse','sessionIdGenerator','oauth'])if(Object.hasOwn(options,key))selected[key]=options[key];
 const server=createHttpServer(selected),empty=defineSchema({}),text=defineSchema({text:{type:'string'}});
 server.tool('echo','Echo input text',text,({text})=>String(text));
 server.tool('reverse','Reverse input text',text,({text})=>native.httpTestReverse(String(text)));
 server.tool('uppercase','Uppercase input text',text,({text})=>String(text).toUpperCase());
 server.tool('get_user','Return a test user object',defineSchema({id:{type:'string'}}),({id})=>({id:String(id),name:'Alice',role:'admin'}),{type:'object',properties:{id:{type:'string'},name:{type:'string'},role:{type:'string'}},required:['id','name','role'],additionalProperties:false});
 server.tool('get_list','Return a numeric array',empty,()=>[1,2,3]);
 server.tool('get_image','Return an image block',empty,()=>Image.fromBase64('iVBORw0KGgo=','image/png'));
 server.tool('get_audio','Return an audio block',empty,()=>Audio.fromBase64('SUQzBAAAAAA=','audio/mpeg'));
 server.tool('get_file','Return a file block',empty,()=>File.fromText('hello,world','text/csv'));
 server.tool('get_mixed','Return multiple content blocks',empty,()=>[Image.fromBase64('iVBORw0KGgo=','image/png'),'Caption for the image',File.fromText('notes')]);
 server.tool('throw_sync','Throw synchronously',empty,()=>{throw new Error('sync boom');});
 server.tool('throw_async','Throw asynchronously',empty,async()=>{throw new Error('async boom');});
 server.tool('empty_result','Return undefined',empty,()=>undefined);
 server.tool('slow','Resolve slowly',empty,async()=>{await new Promise(resolve=>setTimeout(resolve,10));return 'done';});
 server.tool('large_output','Return 100KB of text',empty,()=>'x'.repeat(100000));
 return server;
}
