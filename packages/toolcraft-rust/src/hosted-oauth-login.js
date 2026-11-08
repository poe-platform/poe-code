import {createHash,randomBytes} from "node:crypto";
import {createRequire} from "node:module";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.hostedOauthLoginPolicy,operation,args,host);}finally{depth--;}}
const operations={
  template:value=>`${value}`,
  replace:(value,search,replacement)=>value.replaceAll(search,replacement),
  nonce:()=>randomBytes(18).toString("base64"),
  controls:(fields,values)=>fields.map(field=>invoke("control",[field,values])).join(""),
  value:(values,name)=>values[name],empty:value=>value.length===0,
  origin:transaction=>new URL(transaction.redirectUri).origin,
  cookieSuffix:id=>createHash("sha256").update(id).digest("base64url").slice(0,22),
  result:(contentSecurityPolicy,html)=>({contentSecurityPolicy,html}),
  invalidOperation(){throw new TypeError("Invalid hosted OAuth login operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function escapeHtml(value){return invoke("escape",[value]);}
export function renderLogin(providerName,fields,transaction,csrfToken,error,submittedValues={}){return invoke("render",[providerName,fields,transaction,csrfToken,error,submittedValues]);}
export function loginContentSecurityPolicy(transaction,scriptNonce){return invoke("csp",[transaction,scriptNonce]);}
export function renderExpiredConnection(){return invoke("expired",[]);}
export function interactionCookieName(transactionId){return invoke("cookie",[transactionId]);}
