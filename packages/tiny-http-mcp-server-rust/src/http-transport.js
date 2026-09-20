import {createRequire} from 'node:module';
import {validateHeaderValue} from 'node:http';
import {readAndClassifyBody,JsonRpcMessageError} from './parse-body.js';
import {createSessionStore,defaultSessionIdGenerator} from './session.js';
import {formatSseEvent,SSE_HEADERS} from './sse.js';
const native=createRequire(import.meta.url)('./tiny-http-mcp-server-rust.node');
const first=value=>Array.isArray(value)?value[0]:value;
const format=(id,handled)=>JSON.stringify({jsonrpc:'2.0',id,...handled});
export class StreamableHttpTransport{
 constructor(server,options={},runWithRequestContext=async(_request,callback)=>callback()){
  this.server=server;this.policy=new native.NativeHttpPolicy(options);this.settings=this.policy.settings;
  this.sessionIdGenerator=Object.hasOwn(options,'sessionIdGenerator')?options.sessionIdGenerator:defaultSessionIdGenerator;
  this.store=options.sessionStore??createSessionStore();this.runWithRequestContext=runWithRequestContext;
  this.observability=options.observability??{};this.nextRequest=1;this.requestIdGenerator=options.requestIdGenerator??(()=>`req-${this.nextRequest++}`);
  this.sessions=new Map();this.streams=new Map();this.expiryTimers=new Map();this.history=new native.NativeHttpEventHistory(this.settings.maxSseEventHistory,this.settings.maxResponseBytes);
  this.responses=new WeakMap();this.modern=new Map();this.modernStreams=new Set();this.activeTools=0;this.closed=false;
  if(this.sessionIdGenerator!==undefined){this.expiry=setInterval(()=>{try{this.purgeExpired();}catch{}},Math.min(this.settings.sessionTtlMs,60000));this.expiry.unref();}
 }
 call(command,input={}){return this.policy.call(command,command==='session_update'||command==='tool_ok'?input:JSON.stringify(input));}
 subject(request){const value=request.auth?.subject??request.auth?.clientId;return value!==undefined&&value.length>0?value:undefined;}
 headers(response,extra={},sessionId){
  const info=this.responses.get(response)??{};
  return {'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',Vary:'Origin',...(info.requestId===undefined?{}:{'X-Request-Id':info.requestId}),...(info.origin===undefined?{}:{'Access-Control-Allow-Origin':info.origin,'Access-Control-Expose-Headers':'Mcp-Session-Id, X-Request-Id'}),...extra,...(sessionId===undefined?{}:{'Mcp-Session-Id':sessionId})};
 }
 respond(response,status,sessionId,headers={},body){
  if(body!==undefined&&this.call('write',{bytes:Buffer.byteLength(body),buffered:0})==='destroy'){response.destroy();return;}
  response.writeHead(status,this.headers(response,headers,sessionId));response.end(body);
 }
 sendPlan(response,plan,id=null){
  if(plan===null)return false;
  const info=this.responses.get(response);if(info)info.reason=plan.reason??(plan.rpc===undefined?undefined:'json_rpc_error');
  this.respond(response,plan.status,undefined,plan.headers??(plan.body!==undefined||plan.rpc!==undefined?{'Content-Type':'application/json'}:{}),plan.body!==undefined?JSON.stringify(plan.body):plan.rpc!==undefined?format(id,{error:plan.rpc}):undefined);return true;
 }
 async handleRequest(request,response){
  const start=Date.now(),originInfo=native.httpRequestOrigin(JSON.stringify(request.headers),Boolean(request.socket?.encrypted),this.settings.trustedProxy);
  let endpointOrigin;try{endpointOrigin=new URL(`${originInfo.protocol}://${originInfo.host}`).origin;}catch{}
  const plan=this.call('http',{method:request.method,headers:request.headers,endpointOrigin,closed:this.closed,encrypted:Boolean(request.socket?.encrypted)});
  const requestId=plan.requestId??this.requestIdGenerator(),sessionId=plan.sessionId;
  this.responses.set(response,{requestId,origin:plan.origin});
  this.observability.onEvent?.({type:'request.start',requestId,method:request.method??'',path:request.url??'',sessionId});
  try{
   if(plan.rejection!==undefined){this.sendPlan(response,plan.rejection);return;}
   if(plan.route==='POST')await this.post(request,response);
   else if(plan.route==='GET')await this.get(request,response);
   else if(plan.route==='DELETE')this.remove(request,response);
   else this.sendPlan(response,this.call('options',{headers:request.headers}));
  }catch(error){
   this.observability.onEvent?.({type:'request.error',requestId,method:request.method??'',durationMs:Date.now()-start,error,sessionId});
   if(!response.headersSent)this.respond(response,500);else if(!response.writableEnded)response.end();
  }finally{
   this.observability.onEvent?.({type:'request.end',requestId,method:request.method??'',statusCode:response.statusCode,durationMs:Date.now()-start,sessionId,...(response.statusCode<200||response.statusCode>=300?{reason:this.responses.get(response)?.reason??'http_error'}:{})});
  }
 }
 *storedSessions(){if(this.store.entries!==undefined)yield* this.store.entries();else for(const id of this.sessions.keys()){const session=this.store.get(id);if(session!==undefined)yield session;}}
 purgeExpired(){for(const session of [...this.storedSessions()])if(this.call('expired',{now:Date.now(),lastSeenAt:session.lastSeenAt.getTime()}))this.deleteSession(session.id,'expired');}
 activeSession(id,request){
  const session=this.store.get(id),action=this.call('active',{exists:session!==undefined,now:Date.now(),lastSeenAt:session?.lastSeenAt.getTime(),subject:session?.authSubject,requestSubject:this.subject(request)});
  if(action==='expired')this.deleteSession(id,'expired');return action==='use'?session:undefined;
 }
 touch(id){if(this.store.touch!==undefined)this.store.touch(id);else {const session=this.store.get(id);if(session!==undefined)session.lastSeenAt=new Date();}}
 localSession(id){const session=this.server.createMessageSession(notification=>this.notify(id,notification));this.sessions.set(id,session);return session;}
 async ensureSession(id,state){
  const existing=this.sessions.get(id);if(existing!==undefined)return existing;
  const local=this.localSession(id);if(state.protocolVersion!==undefined){await local.handleMessage('initialize',{protocolVersion:state.protocolVersion});if(state.initialized)await local.handleMessage('notifications/initialized');}return local;
 }
 deleteSession(id,reason){
  if(!this.store.delete(id))return false;
  this.sessions.get(id)?.close();this.sessions.delete(id);this.history.remove(id);
  for(const response of this.streams.get(id)??[]){this.clearExpiry(response);if(!response.writableEnded)response.end();}
  this.streams.delete(id);this.stopKeepAliveIfIdle();this.observability.onEvent?.({type:'session.deleted',sessionId:id,reason});return true;
 }
 async post(request,response){
  if(this.sendPlan(response,this.call('post',{headers:request.headers})))return;
  let body;
  try{body=await readAndClassifyBody(request,undefined,{maxBytes:this.settings.maxRequestBytes,maxBatchSize:this.settings.maxBatchSize});}
  catch(error){
   const message=error instanceof Error?error.message:'Invalid Request';
   this.responses.get(response).reason='json_rpc_error';
   this.respond(response,message==='Payload too large'?413:400,undefined,{'Content-Type':'application/json'},format(error instanceof JsonRpcMessageError?error.id:null,{error:{code:error instanceof JsonRpcMessageError?error.code:message==='Parse error'?-32700:-32600,message}}));return;
  }
  if(this.call('modern_detect',{headers:request.headers,messages:body.messages})){await this.modernPost(request,response,body);return;}
  let id,state;
  if(this.sessionIdGenerator!==undefined){
   const requested=first(request.headers['mcp-session-id']);
   if(requested===undefined||requested.length===0){
    this.purgeExpired();const sessions=[...this.storedSessions()],subject=this.subject(request);
    if(this.sendPlan(response,this.call('session_initial',{initialize:body.requests.some(m=>m.method==='initialize'),count:this.store.entries===undefined?this.sessions.size:sessions.length,subject,subjectCount:sessions.filter(s=>s.authSubject===subject).length})))return;
    id=this.sessionIdGenerator();let valid=id.length>0&&!this.store.has(id);try{validateHeaderValue('Mcp-Session-Id',id);}catch{valid=false;}
    if(!valid){this.respond(response,500);return;}
    state=this.store.create(id);if(subject!==undefined)state.authSubject=subject;
    this.observability.onEvent?.({type:'session.created',sessionId:id});this.localSession(id);
   }else{
    id=requested;state=this.activeSession(id,request);
    if(state===undefined){this.sendPlan(response,this.call('session_failure'));return;}
    this.touch(id);if(this.sendPlan(response,this.call('protocol',{headers:request.headers,version:state.protocolVersion})))return;
    await this.ensureSession(id,state);
   }
  }
  const formatted=await this.runWithRequestContext(request,async()=>{
   const out=[];
   for(const message of body.entries){
    if(message===null){out.push(format(null,{error:{code:-32600,message:'Invalid Request'}}));continue;}
    if(!Object.hasOwn(message,'method'))continue;
    const isRequest=Object.hasOwn(message,'id'),error=this.call('message',{method:message.method,stateful:this.sessionIdGenerator!==undefined,initialized:state?.initialized,active:this.activeTools});
    if(error!==null){if(isRequest)out.push(format(message.id,{error}));continue;}
    const tool=message.method==='tools/call',started=Date.now(),requestId=this.responses.get(response)?.requestId??'',toolName=typeof message.params?.name==='string'?message.params.name:undefined;
    if(tool){this.activeTools++;this.observability.onEvent?.({type:'tool.start',requestId,sessionId:id,toolName});}
    let handled;
    try{handled=await (id===undefined?this.server:this.sessions.get(id)??this.server).handleMessage(message.method,message.params);}
    finally{if(tool)this.activeTools--;}
    if(handled.error===undefined&&message.method==='initialize'&&handled.result!==undefined&&this.sessionIdGenerator===undefined)handled={...handled,result:this.call('stateless_initialize',handled.result)};
    if(tool)this.observability.onEvent?.({type:'tool.end',requestId,sessionId:id,toolName,ok:this.call('tool_ok',{hasError:handled.error!==undefined,result:handled.result}),durationMs:Date.now()-started});
    if(state!==undefined){const update=this.call('session_update',{hasError:handled.error!==undefined,method:message.method,request:isRequest,version:state.protocolVersion,result:handled.result});if(update!==null)Object.assign(state,update);}
    if(isRequest&&(handled.error!==undefined||handled.result!==undefined))out.push(format(message.id,handled.error!==undefined?{error:handled.error}:{result:handled.result}));
   }return out;
  });
  if(formatted.length===0){this.respond(response,202,id);return;}
  if(this.settings.enableJsonResponse){this.respond(response,200,id,{'Content-Type':'application/json'},formatted.length===1?formatted[0]:`[${formatted.join(',')}]`);return;}
  const frames=formatted.map(data=>formatSseEvent({data}));if(frames.some(frame=>this.call('write',{bytes:Buffer.byteLength(frame),buffered:0})==='destroy')){response.destroy();return;}
  response.writeHead(200,this.headers(response,SSE_HEADERS,id));for(const frame of frames)this.write(response,frame);response.end();
 }
 async modernPost(request,response,body){
  const message=body.messages[0],id=message!==undefined&&Object.hasOwn(message,'id')?message.id:null;
  if(this.sendPlan(response,this.call('modern',{headers:request.headers,isBatch:body.isBatch,messages:body.messages}),id))return;
  const controller=new AbortController(),cancel=()=>controller.abort();request.once('aborted',cancel);response.once('close',cancel);this.modern.set(response,controller);
  let streaming=false;
  const write=data=>{
   if(controller.signal.aborted||response.destroyed||response.writableEnded)return;
   const frame=formatSseEvent({data}),action=this.call('write',{bytes:Buffer.byteLength(frame),buffered:response.writableLength??0});
   if(action!=='write'){controller.abort(new Error(action==='destroy'?'Modern SSE response size limit exceeded':'Modern SSE output buffer limit exceeded'));response.destroy();return;}
   if(!streaming){response.writeHead(200,this.headers(response,{...SSE_HEADERS,'X-Accel-Buffering':'no'}));streaming=true;response.flushHeaders();this.modernStreams.add(response);this.startKeepAlive();}response.write(frame);
  };
  const session=this.server.createMessageSession(notification=>write(JSON.stringify(notification)));
  try{
   if(this.sendPlan(response,this.call('modern_id',message)))return;
   const handled=await this.runWithRequestContext(request,()=>session.handleMessage(message.method,message.params,{...(Object.hasOwn(message,'id')?{requestId:message.id}:{}),signal:controller.signal,parameterHeaders:request.headers}));
   if(controller.signal.aborted||response.destroyed||response.writableEnded)return;
   if(!Object.hasOwn(message,'id')||handled.result===undefined&&handled.error===undefined){if(streaming)response.end();else this.respond(response,202);return;}
   const data=format(message.id,handled.error===undefined?{result:handled.result}:{error:handled.error}),status=this.call('modern_status',{code:handled.error?.code});
   if(streaming||!this.settings.enableJsonResponse&&status===200){write(data);if(!response.destroyed)response.end();}else this.respond(response,status,undefined,{'Content-Type':'application/json'},data);
  }finally{session.close();request.off('aborted',cancel);response.off('close',cancel);this.modern.delete(response);this.modernStreams.delete(response);this.stopKeepAliveIfIdle();}
 }
 requireSession(request,response){
  const id=first(request.headers['mcp-session-id']);if(id===undefined||id.length===0){this.sendPlan(response,this.call('session_failure',{missing:true}));return;}
  const state=this.activeSession(id,request);if(state===undefined){this.sendPlan(response,this.call('session_failure'));return;}return {id,state};
 }
 async get(request,response){
  if(this.sendPlan(response,this.call('get',{headers:request.headers,stateful:this.sessionIdGenerator!==undefined})))return;
  const active=this.requireSession(request,response);if(active===undefined)return;const {id,state}=active;this.touch(id);
  if(state.initialized&&this.sendPlan(response,this.call('protocol',{headers:request.headers,version:state.protocolVersion})))return;
  await this.ensureSession(id,state);
  if(this.sendPlan(response,this.call('stream',{count:this.streams.get(id)?.size??0})))return;
  let streams=this.streams.get(id);if(streams===undefined){streams=new Set();this.streams.set(id,streams);}streams.add(response);this.startKeepAlive();
  this.observability.onEvent?.({type:'stream.opened',sessionId:id,streamCount:streams.size});
  const cleanup=()=>{
   this.clearExpiry(response);const streams=this.streams.get(id);if(streams===undefined)return;
   if(streams.delete(response))this.observability.onEvent?.({type:'stream.closed',sessionId:id,streamCount:streams.size});if(streams.size===0)this.streams.delete(id);this.stopKeepAliveIfIdle();
   request.off('close',cleanup);response.off('close',cleanup);response.off('finish',cleanup);
  };
  request.on('close',cleanup);response.on('close',cleanup);response.on('finish',cleanup);
  if(request.auth?.expiresAt!==undefined){const timer=setTimeout(()=>{this.expiryTimers.delete(response);if(!response.writableEnded)response.end();},Math.max(0,request.auth.expiresAt*1000-Date.now()));timer.unref();this.expiryTimers.set(response,timer);}
  response.writeHead(200,this.headers(response,SSE_HEADERS,id));
  const raw=first(request.headers['last-event-id']);
  if(raw!==undefined)for(const frame of this.history.replay(id,Number(raw)))if(!response.writableEnded)this.write(response,frame);response.flushHeaders();
 }
 remove(request,response){
  if(this.sessionIdGenerator===undefined){this.respond(response,405,undefined,{Allow:'POST, GET, DELETE, OPTIONS'});return;}
  const active=this.requireSession(request,response);if(active===undefined)return;
  if(this.sendPlan(response,this.call('protocol',{headers:request.headers,version:active.state.protocolVersion})))return;
  if(!this.deleteSession(active.id,'client')){this.sendPlan(response,this.call('session_failure'));return;}this.respond(response,204);
 }
 clearExpiry(response){const timer=this.expiryTimers.get(response);if(timer!==undefined){clearTimeout(timer);this.expiryTimers.delete(response);}}
 write(response,data){if(response.destroyed||response.writableEnded)return;const action=this.call('write',{bytes:Buffer.byteLength(data),buffered:response.writableLength??0});if(action==='destroy')response.destroy();else if(action==='end')response.end();else response.write(data);}
 notify(id,notification){
  if(!this.store.get(id)?.initialized)return;
  const plan=this.history.record(id,JSON.stringify(notification)),streams=this.streams.get(id);
  if(plan.destroy){for(const response of streams??[])response.destroy();return;}
  let latest;for(const response of streams??[])if(!response.writableEnded)latest=response;if(latest!==undefined)this.write(latest,plan.frame);
 }
 startKeepAlive(){if(this.settings.sseKeepAliveMs===0||this.keepAlive!==undefined)return;this.keepAlive=setInterval(()=>{for(const response of this.modernStreams)if(!response.writableEnded)this.write(response,': keepalive\n\n');for(const streams of this.streams.values())for(const response of streams)if(!response.writableEnded)this.write(response,': keepalive\n\n');},this.settings.sseKeepAliveMs);this.keepAlive.unref();}
 stopKeepAliveIfIdle(){if(this.modernStreams.size===0&&![...this.streams.values()].some(streams=>streams.size>0)&&this.keepAlive!==undefined){clearInterval(this.keepAlive);this.keepAlive=undefined;}}
 async close(){
  this.closed=true;for(const [response,controller]of this.modern){controller.abort();response.end();}this.modern.clear();this.modernStreams.clear();
  clearInterval(this.expiry);this.expiry=undefined;clearInterval(this.keepAlive);this.keepAlive=undefined;
  for(const timer of this.expiryTimers.values())clearTimeout(timer);this.expiryTimers.clear();
  for(const streams of this.streams.values())for(const response of streams)if(!response.writableEnded)response.end();this.streams.clear();
  for(const id of [...this.sessions.keys()])this.deleteSession(id,'closed');this.sessions.clear();this.history.clear();
 }
}
