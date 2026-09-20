import {createRequire} from 'node:module';
import {TokenVerificationError} from './auth.js';
import {McpClient,HttpTransport} from './client/index.js';
import {installInMemoryHttp,nodeFetch} from './test-support.js';
const native=createRequire(import.meta.url)('./tiny-http-mcp-server-rust.node');
export {createTestMcpServer,installInMemoryHttp,nodeFetch} from './test-support.js';

export function createInMemoryTokenVerifier(options={}){
 const state=new native.NativeHttpTestTokens(),snapshots=[];
 const now=options.now??(()=>Math.floor(Date.now()/1000));
 return {
  issueToken(input){
   const prepared=state.prepare(input.token);
   if(prepared.duplicate!==undefined)throw new Error(`Token has already been issued: ${prepared.duplicate}`);
   const issuer=input.issuer,audience=[...input.audience],scopes=[...input.scopes],expiresAt=input.expiresAt;
   const subject=input.subject,clientId=input.clientId;
   const claims={...(input.claims??{}),iss:issuer,aud:audience.length===1?audience[0]:audience,exp:expiresAt,scope:scopes.join(' '),...(subject===undefined?{}:{sub:subject}),...(clientId===undefined?{}:{client_id:clientId})};
   const plan=state.issue(prepared.token,issuer,audience,scopes,expiresAt);
   if(plan.duplicate!==undefined)throw new Error(`Token has already been issued: ${plan.duplicate}`);
   snapshots[plan.slot]={token:plan.token,issuer,audience,scopes,expiresAt,claims,...(subject===undefined?{}:{subject}),...(clientId===undefined?{}:{clientId})};
   return plan.token;
  },
  verifier:{async verify(input){
   const lookup=state.lookup(input.token,input.resource,input.authorizationServers);
   if(lookup.error!==undefined)throw new TokenVerificationError(lookup);
   const plan=state.admit(lookup.slot,input.requiredScopes,now());
   if(plan.error!==undefined)throw new TokenVerificationError({...plan,...(plan.error==='insufficient_scope'?{scope:input.requiredScopes}:{})});
   const token=snapshots[lookup.slot];
   return {...token,audience:[...token.audience],scopes:[...token.scopes],claims:structuredClone(token.claims)};
  }}
 };
}

export async function createHttpTestPairWithTinyClient(server,clientOptions={}){
 installInMemoryHttp();
 const handle=await server.listenHttp({port:0}),requests=[];
 let client,transport;
 try{
  client=new McpClient({clientInfo:{name:'tiny-http-test-client',version:'1.0.0'},...clientOptions});
  transport=new HttpTransport({url:handle.url,fetch:async(input,init={})=>{
   let jsonRpcMethod;
   if(typeof init.body==='string'&&init.body.length>0){try{const parsed=JSON.parse(init.body);if(typeof parsed.method==='string')jsonRpcMethod=parsed.method;}catch{}}
   const response=await nodeFetch(input,init);
   requests.push({method:init.method??'GET',sessionId:new Headers(init.headers).get('mcp-session-id'),jsonRpcMethod,responseContentType:response.headers.get('content-type')});
   return response;
  }});
  await client.connect(transport);
 }catch(error){
  await Promise.allSettled([Promise.resolve().then(()=>client?.close()),Promise.resolve().then(()=>handle.close())]);
  throw error;
 }
 return {client,transport,handle,url:handle.url,requests,async cleanup(){
  const results=await Promise.allSettled([Promise.resolve().then(()=>client.close()),Promise.resolve().then(()=>handle.close())]);
  const failure=results.find(result=>result.status==='rejected');if(failure!==undefined)throw failure.reason;
 }};
}

// An explicitly requested development oracle; the native pair above needs no SDK.
export async function createHttpTestPair(server){
 let sdkClient,sdkTransport;
 try{[sdkClient,sdkTransport]=await Promise.all([import('@modelcontextprotocol/sdk/client/index.js'),import('@modelcontextprotocol/sdk/client/streamableHttp.js')]);}
 catch(error){throw new Error('createHttpTestPair requires @modelcontextprotocol/sdk; install it as a devDependency or use createHttpTestPairWithTinyClient',{cause:error});}
 installInMemoryHttp();
 const handle=await server.listenHttp({port:0});let client,transport;
 try{
  client=new sdkClient.Client({name:'sdk-test-client',version:'1.0.0'});
  transport=new sdkTransport.StreamableHTTPClientTransport(new URL(handle.url),{fetch:nodeFetch});
  await client.connect(transport);
 }catch(error){
  await Promise.allSettled([Promise.resolve().then(()=>client?.close()),Promise.resolve().then(()=>handle.close())]);
  throw error;
 }
 return {client,transport,handle,url:handle.url,async cleanup(){
  const results=await Promise.allSettled([Promise.resolve().then(()=>client.close()),Promise.resolve().then(()=>handle.close())]);
  const failure=results.find(result=>result.status==='rejected');if(failure!==undefined)throw failure.reason;
 }};
}
