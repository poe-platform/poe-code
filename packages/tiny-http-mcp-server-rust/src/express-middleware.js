import {createRequire} from 'node:module';
import {authorizeBearerRequest,PROTECTED_RESOURCE_METADATA_PATH,PROTECTED_RESOURCE_METADATA_CACHE_CONTROL} from './auth.js';
import {createProtectedResourceMetadataDocument} from './http-server.js';
const native=createRequire(import.meta.url)('./tiny-http-mcp-server-rust.node');
export function createExpressMiddleware(server){return async(request,response,next)=>{try{await server.handleRequest(request,response);}catch(error){next(error);}};}
export function createProtectedResourceMetadataRouter(options){
 const document=createProtectedResourceMetadataDocument(options),path=native.normalizeHttpPath(options.path??'/',true),paths=path==='/'?[PROTECTED_RESOURCE_METADATA_PATH]:[PROTECTED_RESOURCE_METADATA_PATH,`${PROTECTED_RESOURCE_METADATA_PATH}${path}`];
 return(request,response,next)=>{
  if(request.method!=='GET'||!paths.includes(request.path)){next();return;}
  response.set('X-Content-Type-Options','nosniff');response.set('Referrer-Policy','no-referrer');response.set('Cache-Control',PROTECTED_RESOURCE_METADATA_CACHE_CONTROL);response.status(200).json(document);
 };
}
export function createExpressOAuthHandlers(options){
 const middleware=createExpressMiddleware(options.server),path=native.normalizeHttpPath(options.path,true);
 return {metadataMiddleware:createProtectedResourceMetadataRouter({...options.oauth,path}),mcpMiddleware:async(request,response,next)=>{
  if(request.method==='OPTIONS'){await middleware(request,response,next);return;}
  const authorization=await authorizeBearerRequest(request,{...options.oauth,protectedResourcePath:path,trustedProxy:options.trustedProxy});
  if(authorization.ok){await middleware(request,response,next);return;}
  const value=request.headers['mcp-session-id'],sessionId=Array.isArray(value)?value[0]:value;
  options.observability?.onEvent?.({type:'auth.failure',statusCode:authorization.statusCode,...(authorization.statusCode===503?{}:{challenge:authorization.challenge}),sessionId:sessionId!==undefined&&sessionId.length>0?sessionId:undefined});
  if(authorization.statusCode!==503)response.set('WWW-Authenticate',authorization.challenge);
  response.set('X-Content-Type-Options','nosniff');response.set('Referrer-Policy','no-referrer');response.status(authorization.statusCode).end();
 }};
}
