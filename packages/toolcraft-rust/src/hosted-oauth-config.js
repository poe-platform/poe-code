import {createRequire} from "node:module";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.hostedOauthConfigPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,truthy:value=>!!value,
  object:value=>typeof value==="object"&&value!==null,string:value=>typeof value==="string",
  hasKind:value=>"kind" in value,url:value=>new URL(value),nonempty:value=>value.length>0,empty:value=>value.length===0,
  trim:value=>value.trim(),endsSlash:value=>!!value.endsWith("/"),startsSlash:value=>!!value.startsWith("/"),
  error:message=>{throw new Error(message);},array:()=>[],defaultScopes:()=>["mcp","offline_access"],
  push:(values,value)=>values.push(value),includes:(values,value)=>values.includes(value),
  invalidScopes:scopes=>scopes.some(scope=>invoke("invalidScope",[scope])),
  fieldNames:fields=>fields.map(field=>invoke("fieldName",[field])),
  differentSetSize:values=>new Set(values).size!==values.length,
  pathSetSize:values=>new Set(values).size,
  invalidNames:values=>values.some(value=>invoke("invalidName",[value])),
  invalidPaths:(paths,options)=>paths.some(path=>invoke("invalidPath",[path,options])),
  reservedPath:(path,publicPath)=>["/healthz","/oauth/connect","/authorize","/register","/token","/revoke","/.well-known/oauth-authorization-server","/.well-known/jwks.json",publicPath].includes(path),
  invalidConfiguration:errors=>{throw new Error(`Hosted OAuth configuration requires: ${errors.join(", ")}.`);},
  issuer:publicUrl=>new URL(publicUrl.origin),prepared:(publicUrl,issuer,scopes)=>({publicUrl,issuer,scopes}),
  fieldLabel:field=>`${field[0]?.toUpperCase()??""}${field.slice(1)}`,
  field:(name,label,type)=>({name,label,type}),
  configuration:options=>({...options,kind:"hosted",async prepare({production=process.env.NODE_ENV==="production"}={}){return invoke("prepare",[this,production]);},async assertProductionReady(){return this.prepare({production:true});}}),
  invalidOperation(){throw new TypeError("Invalid hosted OAuth configuration operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function isHostedOAuthConfiguration(value){return invoke("isHosted",[value]);}
export function normalizePublicUrl(value){return invoke("url",[value]);}
export function configurationErrors(config,production){return invoke("errors",[config,production]);}
export function hostedOAuth(options){return invoke("create",[options]);}
export function loginField(field){return invoke("loginField",[field]);}
