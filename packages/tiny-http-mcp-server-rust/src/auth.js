import {createRequire} from 'node:module';
const native=createRequire(import.meta.url)('./tiny-http-mcp-server-rust.node');
export const PROTECTED_RESOURCE_METADATA_PATH='/.well-known/oauth-protected-resource';
export const PROTECTED_RESOURCE_METADATA_CACHE_CONTROL='public, max-age=300';
export class TokenVerificationError extends Error{
 constructor({error,errorDescription,scope}){super(errorDescription??error);this.name='TokenVerificationError';this.error=error;this.errorDescription=errorDescription;this.scope=scope;}
}
export function getProtectedResourceMetadataUrl(request,path,trustedProxy=false){
 const info=native.httpRequestOrigin(JSON.stringify(request.headers),'encrypted' in request.socket&&Boolean(request.socket.encrypted),trustedProxy);
 const metadataPath=native.httpMetadataPath(path);
 try{return new URL(metadataPath,`${info.protocol}://${info.host}`).toString();}catch{return new URL(metadataPath,`${info.protocol}://127.0.0.1`).toString();}
}
export function createBearerChallenge(request,options={},path,trustedProxy=false){return native.httpBearerChallenge(getProtectedResourceMetadataUrl(request,path,trustedProxy),JSON.stringify(options));}
export async function authorizeBearerRequest(request,options){
 const value=request.headers.authorization;
 const authorization=native.httpBearerToken(Array.isArray(value)?value[0]:value);
 const challenge=value=>createBearerChallenge(request,value,options.protectedResourcePath,options.trustedProxy);
 if(authorization.kind==='missing')return {ok:false,statusCode:401,challenge:challenge({})};
 if(authorization.kind==='malformed')return {ok:false,statusCode:401,challenge:challenge({error:'invalid_token',errorDescription:authorization.errorDescription})};
 const required=options.requiredScopes??[],resource=options.resource instanceof URL?options.resource.toString():options.resource;
 try{
  const verified=await options.verifier.verify({token:authorization.token,resource,authorizationServers:options.authorizationServers.map(value=>value instanceof URL?value.toString():value),requiredScopes:required});
  if(!native.httpScopeAdmission(JSON.stringify(required),JSON.stringify(verified.scopes)))return {ok:false,statusCode:403,challenge:challenge({error:'insufficient_scope',errorDescription:'insufficient scope',scope:required})};
  const audience=[...verified.audience],scopes=[...verified.scopes],claims={...verified.claims};
  const auth={...verified,audience,clientId:verified.clientId??'',scopes,claims,resource:new URL(resource),extra:{issuer:verified.issuer,audience,claims,...(verified.subject===undefined?{}:{subject:verified.subject})}};
  request.auth=auth;return {ok:true,auth};
 }catch(error){
  const plan=native.httpVerifierError(error,JSON.stringify(required));
  return {ok:false,statusCode:plan.statusCode,...(plan.options===undefined?{}:{challenge:challenge(plan.options)})};
 }
}
