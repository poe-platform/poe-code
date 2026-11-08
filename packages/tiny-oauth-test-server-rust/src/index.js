import http from'node:http';import{randomBytes}from'node:crypto';import{native}from'./native.js';import{createSigningState,signJwt}from'./signing.js';
class OAuthRequestError extends Error{constructor(shape){super(shape.message);this.name='OAuthRequestError';this.status=shape.status;this.error=shape.error;}}
function unwrap(text){const result=JSON.parse(text);if(Object.hasOwn(result,'fault')){if(Object.hasOwn(result.fault,'error'))throw new OAuthRequestError(result.fault);throw result.fault.name==='TypeError'?new TypeError(result.fault.message):new Error(result.fault.message);}return result.value;}
function urlInfo(value){try{const url=new URL(value),portless=new URL(url.href);portless.port='';return{href:url.href,portless:portless.href,hash:url.hash,protocol:url.protocol,hostname:url.hostname,pathname:url.pathname,search:url.search,origin:url.origin};}catch{return{};}}
function encoded(value){return JSON.stringify(value,(_key,value)=>typeof value==='number'&&!Number.isFinite(value)?{nativeNonFinite:true}:value);}
function random(){return randomBytes(24).toString('base64url');}
function now(){return Math.floor(Date.now()/1000);}
function sendJson(response,status,payload,extra={}){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',Pragma:'no-cache',...extra});response.end(JSON.stringify(payload));}
function redirect(response,location){response.writeHead(302,{Location:location,'Cache-Control':'no-store',Pragma:'no-cache'});response.end();}
function endpoints(issuer,call){const paths=call('endpoints',{pathname:new URL(issuer).pathname});return{paths,urls:Object.fromEntries(Object.entries(paths).map(([key,value])=>[key,new URL(value,issuer).href]))};}
async function body(request){const chunks=[];for await(const chunk of request)chunks.push(typeof chunk==='string'?Buffer.from(chunk):chunk);return Buffer.concat(chunks).toString('utf8');}
export function createOAuthTestServer(options={}){
 let core;try{core=new native.NativeOAuthFixture(encoded(options));}catch(error){throw new Error(error.message);}
 const call=(command,input={})=>unwrap(core.call(command,encoded(input))),signing=createSigningState(options),log=[];
 for(const payload of options.staticClients??[])call('static',{payload,redirects:Array.isArray(payload.redirectUris)?payload.redirectUris.map(urlInfo):[]});
 function normalizeIssuer(value){call('issuer',{info:urlInfo(value)});const url=new URL(value);if(url.pathname.length>1&&url.pathname.endsWith('/'))url.pathname=url.pathname.slice(0,-1);url.hash='';return url.pathname==='/'&&url.search.length===0?url.origin:url.href;}
 let issuer=options.issuer?normalizeIssuer(options.issuer):null,server=null,handle=null;const defaultScopes=options.defaultAuthorization?.scopes;
 function getIssuer(){if(issuer===null)throw new Error('issuer is not available until the server starts listening');return issuer;}
 function requestFacts(params){const first=name=>params.find(([key])=>key===name)?.[1];return{params,redirect:urlInfo(first('redirect_uri')),resource:urlInfo(first('resource')),now:now()};}
 async function token(plan){const reply=call('token_plan',{...plan,issuer:getIssuer(),now:now(),random:random(),alg:signing.alg,kid:signing.kid,modulusLength:signing.privateKey.asymmetricKeyDetails?.modulusLength});return signJwt(signing,reply.header,reply.payload);}
 async function tokenResponse(plan){const access=await token(plan),refresh=plan.issueRefreshToken?random():undefined;if(refresh!==undefined)call('remember_refresh',{...plan,token:refresh,now:now()});return call('token_response',{plan,token:access,refresh});}
 async function serve(request,response){try{
  const issuer=getIssuer(),url=new URL(request.url??'/',handle?.url??'http://127.0.0.1'),{paths,urls}=endpoints(issuer,call),method=request.method??'GET',headers=Object.fromEntries(Object.entries(request.headers).flatMap(([name,value])=>typeof value==='string'?[[name,value]]:Array.isArray(value)?[[name,value.join(', ')]]:[]));
  function append(data){let sanitized=data;if(data!==undefined&&headers['content-type']?.split(';')[0]?.trim().toLowerCase()==='application/x-www-form-urlencoded'){const params=new URLSearchParams(data);sanitized=new URLSearchParams(call('log_params',{params:[...params]})).toString();}log.push({method,url:url.href,headers,...(data===undefined?{}:{body:sanitized})});}
  if(method==='GET'&&url.pathname===paths.metadata){append();sendJson(response,200,call('metadata',{issuer,urls}));return;}
  if(method==='GET'&&url.pathname===paths.jwks){append();sendJson(response,200,{keys:[signing.publicJwk]});return;}
  if(method==='POST'&&url.pathname===paths.register){const data=await body(request);append(data);call('content_type',{kind:'json',value:headers['content-type']});const payload=call('json',{body:data});sendJson(response,201,call('register',{payload,redirects:Array.isArray(payload.redirect_uris)?payload.redirect_uris.map(urlInfo):[],now:now()}),{Location:urls.register});return;}
  if(method==='GET'&&url.pathname===paths.authorize){append();call('default_scopes',{scopes:defaultScopes});const decision=call('authorize',{...requestFacts([...url.searchParams]),random:random()});if(decision.kind==='redirect'){const callback=new URL(decision.redirect);callback.searchParams.set('code',decision.code);if(decision.state!==undefined)callback.searchParams.set('state',decision.state);callback.searchParams.set('iss',issuer);redirect(response,callback.href);return;}
   const approval=new URL(url.href);approval.searchParams.set('approval_token',decision.approval);const html=call('consent',{decision,approval:approval.href});response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',Pragma:'no-cache'});response.end(html);return;
  }
  if(method==='POST'&&url.pathname===paths.token){const data=await body(request);append(data);call('content_type',{kind:'form',value:headers['content-type']});const facts=requestFacts([...new URLSearchParams(data)]),grant=call('grant_type',facts),plan=call(grant==='authorization_code'?'exchange':'refresh',facts);sendJson(response,200,await tokenResponse(plan));return;}
  if(method==='POST'&&(url.pathname===paths.issue||url.pathname==='/testing/issue-token')){const data=await body(request);append(data);const payload=call('json',{body:data}),plan=call('direct',{payload,http:true,resource:urlInfo(payload.resource)});sendJson(response,200,await tokenResponse(plan));return;}
  append();sendJson(response,404,{error:'not_found',error_description:'endpoint not found'});
 }catch(error){sendJson(response,error instanceof OAuthRequestError?error.status:500,{error:error instanceof OAuthRequestError?error.error:'server_error',error_description:error instanceof Error?error.message:String(error)});}}
 return{get issuer(){if(issuer===null)throw new Error('issuer is not available until the server starts listening');return issuer;},get requestLog(){return log.map(entry=>({...entry,headers:{...entry.headers}}));},
  async listen(listenOptions={}){call('listen_start');const hostname=listenOptions.hostname??'127.0.0.1',requestedPort=listenOptions.port??0,sockets=new Set(),httpServer=http.createServer((request,response)=>{void serve(request,response);});httpServer.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
   try{await new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(requestedPort,hostname,resolve);});}catch(error){call('listen_fail');throw error;}const address=httpServer.address();if(address===null||typeof address==='string')throw new Error('Expected OAuth test server to bind to a TCP port');const port=address.port,url=`http://${hostname.includes(':')&&!hostname.startsWith('[')?'['+hostname+']':hostname}:${port}`;server=httpServer;call('listen_bound');if(options.issuer===undefined)issuer=normalizeIssuer(url);
   handle={url,port,close:async()=>{if(!call('close_needed'))return;const active=server;await new Promise((resolve,reject)=>{active.close(error=>error!==undefined?reject(error):resolve());for(const socket of sockets)socket.destroy();active.closeIdleConnections?.();active.closeAllConnections?.();});server=null;handle=null;call('closed');if(options.issuer===undefined)issuer=null;}};return handle;
  },
  async issueTokenFor(input){getIssuer();return token(call('direct',{payload:input,http:false,resource:urlInfo(input.resource)}));},
  setNextAuthorization(input){call('next',input);},isTokenRevoked(token){return call('revoked',{token});},revoke(token){call('revoke',{token});}
 };
}
