import {createRequire} from "node:module";
import {createOAuthAuthorizationServer,createAuthorizationInteractionSecurity,verifyAuthorizationInteractionCsrf} from "mcp-oauth-server-rust";
import {callNative,protect} from "./host-errors.js";
import {loginField} from "./hosted-oauth-config.js";
import {renderLogin,renderExpiredConnection,interactionCookieName} from "./hosted-oauth-login.js";
import {readBody,toWebRequest,writeWebResponse,credentialsFor} from "./hosted-oauth-http.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
const apply=Reflect.apply;
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.hostedOauthRuntimePolicy,operation,args,host);}finally{depth--;}}

export class HostedOAuthLoginError extends Error {constructor(message){super(message);this.name="HostedOAuthLoginError";}}

const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,array:()=>[],push:(array,value)=>array.push(value),
  error:message=>{throw new Error(message);},
  fields:fields=>fields.map(loginField),
  state:(config,prepared,fields,customInteraction,displayName)=>{
    const state={config,prepared,fields,customInteraction,displayName};
    state.interaction={async start({request,transaction}){await config.storage.interactions.set(transaction);return invoke("start",[state,request,transaction]);}};
    return state;
  },
  customStart:(custom,request,transaction)=>custom.start({request,transaction}),
  security:transaction=>createAuthorizationInteractionSecurity({cookieName:interactionCookieName(transaction.id)}),
  render:(...args)=>renderLogin(...args),expired:()=>renderExpiredConnection(),
  loginHeaders:csp=>({"content-type":"text/html; charset=utf-8","content-security-policy":csp,"cache-control":"no-store","referrer-policy":"no-referrer","x-content-type-options":"nosniff"}),
  startHeaders:(csp,cookie)=>({"content-type":"text/html; charset=utf-8","content-security-policy":csp,"cache-control":"no-store","referrer-policy":"no-referrer","x-content-type-options":"nosniff","set-cookie":cookie}),
  healthHeaders:()=>({"content-type":"application/json","cache-control":"no-store"}),
  redirectHeaders:location=>({location,"cache-control":"no-store","content-security-policy":"default-src 'none'","referrer-policy":"no-referrer"}),
  response:(body,status,headers)=>new Response(body,{status,headers}),
  responseConstructor:()=>Response,
  redirectResponse:(Constructor,status,headers)=>new Constructor(null,{status,headers}),
  head:(method,response,status,headers)=>apply(method,response,[status,headers]),end:(response,...args)=>response.end(...args),
  prefix:(issuer,resource,scopesSupported,defaultScopes)=>({issuer,resources:[resource],scopesSupported,defaultScopes}),
  options:(prefix,signingKey,additionalPublicJwks,store,interaction,accessTokenTtlSeconds,authorizationCodeTtlSeconds,authorizationTransactionTtlSeconds,refreshTokenTtlSeconds,onGrantRevoked)=>({...prefix,signingKey,additionalPublicJwks,store,interaction,accessTokenTtlSeconds,authorizationCodeTtlSeconds,authorizationTransactionTtlSeconds,refreshTokenTtlSeconds,onGrantRevoked}),
  copy:value=>[...value],
  runtime:(state,server,mcpPath,resource,issuer,scope,scopesSupported)=>({mcpPath,oauth:{resource,authorizationServers:[issuer],requiredScopes:[scope],scopesSupported,verifier:{async verify(input){const verified=await server.verifyAccessToken(input.token,state.prepared.publicUrl.href);return invoke("verified",[server,input,verified]);}}},requestHandler:createRequestHandler(state,server),async requestServices(identity){const credentials=credentialsFor(state.config.storage,identity.subject);await credentials.read();return state.config.provider.services({credentials,identity});}}),
  verified:(token,issuer,resource,scopes,expiresAt,sub,client_id,jti,subject,clientId)=>({token,issuer,audience:[resource],scopes,expiresAt,claims:{sub,client_id,jti},subject,clientId}),
  requestUrl:(request,prepared)=>new URL(request.url??"/",prepared.issuer),
  customPath:(custom,url)=>custom?.paths.includes(url.pathname)===true,
  pathSet:paths=>new Set(paths),hasPath:(paths,url)=>!!paths.has(url.pathname),
  formValue:(body,key)=>body.get(key),
  csrf:(request,csrf,id)=>!!verifyAuthorizationInteractionCsrf({cookieHeader:request.headers.cookie??null,submittedToken:csrf,cookieName:interactionCookieName(id)}),
  expiredAt:value=>value<=Date.now(),
  values:(request,fields,body)=>{const controller=new AbortController();request.once("aborted",()=>controller.abort());const values=Object.assign(Object.create(null),{signal:controller.signal});for(const field of fields)values[field.name]=invoke("formValue",[body,field.name]);return values;},
  connect:(connect,values)=>connect(values),
  emptyAccount:value=>value.trim().length===0,
  loginError:error=>error instanceof HostedOAuthLoginError,
  invalidOperation(){throw new TypeError("Invalid hosted OAuth runtime operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};

function createRequestHandler(state,server){
  const requestHandler=async(request,response)=>{
  const {config,prepared,customInteraction}=state;
  const url=invoke("requestUrl",[state,request]);
  switch(invoke("route",[state,request,url])){
    case "health":
      try{await config.storage.healthCheck?.();invoke("health",[response,true]);}catch{invoke("health",[response,false]);}
      return true;
    case "custom":{
      const body=invoke("customBody",[request])?await readBody(request):undefined;
      const handled=await customInteraction.handle({request:toWebRequest(request,prepared.issuer,body),async complete({transactionId,accountId,credential}){
        const subject=await config.storage.resolveSubject(config.provider.name,accountId);
        await config.storage.credentials.set(subject,credential);
        const completed=await server.completeAuthorization({transactionId,subject});
        await config.storage.interactions.delete(transactionId);
        return invoke("redirectResponse",[completed]);
      }});
      await writeWebResponse(response,handled);return true;
    }
    case "form":{
      const body=new URLSearchParams((await readBody(request)).toString("utf8"));
      const transactionId=invoke("formValue",[body,"transaction"]);
      const transaction=await config.storage.interactions.get(transactionId);
      const csrf=invoke("formValue",[body,"csrf"]);
      if(!invoke("valid",[request,transaction,transactionId,csrf])){invoke("expired",[response]);return true;}
      const values=invoke("values",[state,request,body]);
      try{
        const connected=await invoke("connect",[state,values]);
        invoke("connected",[connected]);
        const subject=await config.storage.resolveSubject(config.provider.name,connected.accountId);
        await config.storage.credentials.set(subject,connected.credential);
        const completed=await server.completeAuthorization({transactionId,subject});
        await config.storage.interactions.delete(transactionId);
        invoke("redirect",[response,completed]);
      }catch(error){invoke("failure",[state,response,transaction,csrf,error,values]);}
      return true;
    }
    case "oauth":{
      const body=invoke("oauthBody",[request])?await readBody(request):undefined;
      await writeWebResponse(response,await server.handle(toWebRequest(request,prepared.issuer,body)));return true;
    }
    default:return false;
  }
  };
  return requestHandler;
}

export async function prepareHostedOAuthRuntime(config){
  const prepared=await config.prepare();
  const state=invoke("state",[config,prepared]);
  await config.storage.cleanup?.();
  const prefix=invoke("prefix",[state]);
  const key=await config.storage.signingKey();
  const options=invoke("options",[state,prefix,key]);
  const server=createOAuthAuthorizationServer(options);
  return invoke("runtime",[state,server]);
}
