import {createRequire} from 'node:module';
import {TokenVerificationError} from './auth.js';
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
