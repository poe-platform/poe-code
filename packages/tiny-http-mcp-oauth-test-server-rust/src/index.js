import http from 'node:http';
import {native,encoded,unwrap,urlInfo} from './native.js';
import {createJwksTokenVerifier} from './http/jwks.js';
import {TokenVerificationError} from './http/auth.js';
import {createTestMcpServer,nodeFetch} from './http/test-support.js';
import {createOAuthTestServer} from './oauth/index.js';
function hostForListen(host){return host.startsWith('[')&&host.endsWith(']')?host.slice(1,-1):host;}
function buildUrl(host,port,path){const url=new URL('http://127.0.0.1');url.hostname=host.includes(':')&&!host.startsWith('[')?`[${host}]`:host;url.port=String(port);url.pathname=path;return url.href;}
function closeServer(server){return new Promise((resolve,reject)=>{server.close(error=>error!==undefined?reject(error):resolve());server.closeIdleConnections?.();server.closeAllConnections?.();});}
async function reservePort(host){const server=http.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,host,resolve);});const address=server.address();if(address===null||typeof address==='string'){await closeServer(server);throw new Error('Expected temporary port reservation to bind to a TCP port');}const port=address.port;await closeServer(server);return port;}
export function createMcpOAuthTestServer(options={}){
 const configuration=unwrap(native.mcpOAuthFixtureOptions(encoded({...options,issuerInfo:urlInfo(options.issuer),resourceInfo:urlInfo(options.resource)}))),core=new native.NativeMcpOAuthFixture(),call=(name,value={})=>unwrap(core.call(name,encoded(value)));
 const configuredIssuer=configuration.issuer===undefined?undefined:new URL(configuration.issuer);
 async function firstFailure(operations){const results=await Promise.allSettled(operations),index=call('first_rejection',results.map(result=>({status:result.status})));if(index!==null)throw results[index].reason;}
 async function listenOnce(hostname,requestedPort){
  const oauthHostname=configuredIssuer===undefined?hostname:hostForListen(configuredIssuer.hostname),oauthPort=configuredIssuer===undefined?await reservePort(oauthHostname):Number(configuredIssuer.port||80),issuer=configuredIssuer?.href??buildUrl(oauthHostname,oauthPort,'/oauth'),sameHost=hostForListen(hostname)===oauthHostname;
  let fixedPort=requestedPort;
  call('ports',{port:fixedPort,oauthPort,sameHost});
  if(fixedPort===0&&configuration.resource===undefined){do{fixedPort=await reservePort(hostname);}while(!call('ports',{port:fixedPort,oauthPort,sameHost,reserved:true}));}
  const oauth=createOAuthTestServer({issuer,defaultTokenTtlSeconds:configuration.ttlSeconds,staticClients:options.staticClients,defaultAuthorization:{autoApprove:configuration.autoApprove,scopes:configuration.scopes}});
  let oauthHandle,mcpHandle;
  try{
   oauthHandle=await oauth.listen({port:oauthPort,hostname:oauthHostname});
   const resource=configuration.resource??buildUrl(hostname,fixedPort,configuration.mcpPath),jwksVerifier=createJwksTokenVerifier({jwksUrl:`${oauth.issuer}/.well-known/jwks.json`,fetch:(input,init)=>nodeFetch(input instanceof Request?input.url:input,init)});
   const verifier={async verify(input){try{call('revoked',oauth.isTokenRevoked?.(input.token)??false);}catch(error){throw new TokenVerificationError({error:'invalid_token',errorDescription:error.message});}return jwksVerifier.verify(input);}};
   mcpHandle=await createTestMcpServer({enableJsonResponse:true,oauth:{resource,authorizationServers:[oauth.issuer],bearerMethodsSupported:['header'],scopesSupported:configuration.scopes,requiredScopes:configuration.scopes,verifier}}).listenHttp({port:fixedPort,hostname,path:configuration.mcpPath});
   const prmUrl=new URL(native.httpMetadataPath(new URL(mcpHandle.url).pathname),mcpHandle.url).href,generation=call('bound');
   return {url:mcpHandle.url,mcpUrl:mcpHandle.url,prmUrl,resource,oauth,close:async()=>{if(!call('close_needed',generation))return;await firstFailure([mcpHandle?.close(),oauthHandle?.close()]);call('closed',generation);}};
  }catch(error){const operations=oauthHandle===undefined?[]:[oauthHandle.close()];if(mcpHandle!==undefined)operations.unshift(mcpHandle.close());await firstFailure(operations);throw error;}
 }
 return {async listen(listenOptions={}){
  const port=call('start',{port:listenOptions.port}),hostname=listenOptions.hostname??'127.0.0.1';
  for(let attempt=0;attempt<10;attempt++){
   try{return await listenOnce(hostname,port);}catch(error){const ownCode=typeof error==='object'&&error!==null&&Object.hasOwn(error,'code')?error.code:undefined;if(!call('retry',{port,attempt,ownCode})){call('failed');throw error;}}
  }
 }};
}
