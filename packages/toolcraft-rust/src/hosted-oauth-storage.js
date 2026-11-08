import {createHmac,generateKeyPairSync,randomBytes} from "node:crypto";
import {createRequire} from "node:module";
import {createInMemoryAuthorizationServerStore} from "mcp-oauth-server-rust";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.hostedOauthStoragePolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,true:()=>true,
  error:message=>{throw new Error(message);},
  state:()=>({credentials:new Map(),interactions:new Map(),updates:new Map(),subjectSalt:randomBytes(32),signingKeyPromise:undefined}),
  get:(map,key)=>map.get(key),set:(map,key,value)=>map.set(key,value),delete:(map,key)=>map.delete(key),clone:value=>structuredClone(value),
  resolved:()=>Promise.resolve(),keepKey:(state,key)=>{state.signingKeyPromise=key;},
  async createKey(){const {privateKey,publicKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});return {algorithm:"ES256",keyId:randomBytes(16).toString("base64url"),privateKey,publicJwk:await publicKey.export({format:"jwk"})};},
  subject:(state,providerName,accountId)=>createHmac("sha256",state.subjectSalt).update(providerName).update("\0").update(accountId).digest("base64url"),
  expose:state=>({
    authorizationServer:createInMemoryAuthorizationServerStore(),
    interactions:{async set(transaction){invoke("setInteraction",[state,transaction]);},async get(id){return invoke("getInteraction",[state,id]);},async delete(id){invoke("deleteInteraction",[state,id]);}},
    capabilities:{durable:false,encryptedCredentials:false,stableKeys:false,shared:false},
    credentials:{
      async get(subject){return invoke("getCredential",[state,subject]);},
      async set(subject,credential){invoke("setCredential",[state,subject,credential]);},
      async delete(subject){invoke("deleteCredential",[state,subject]);},
      async update(subject,update){const previous=invoke("previous",[state,subject]);const next=previous.then(async()=>{const current=invoke("current",[state,subject]);const replacement=await update(current);invoke("setCredential",[state,subject,replacement]);return replacement;});invoke("queue",[state,subject,next]);try{return await next;}finally{invoke("release",[state,subject,next]);}}
    },
    async signingKey(){return await invoke("key",[state]);},
    async resolveSubject(providerName,accountId){return invoke("subject",[state,providerName,accountId]);}
  }),
  invalidOperation(){throw new TypeError("Invalid hosted OAuth storage operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function createInMemoryHostedOAuthStorage(options){return invoke("create",[options]);}
