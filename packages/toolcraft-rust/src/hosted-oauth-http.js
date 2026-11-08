import {createRequire} from "node:module";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.hostedOauthHttpPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,error:message=>{throw new Error(message);},
  isBuffer:value=>!!Buffer.isBuffer(value),buffer:value=>Buffer.from(value),
  addSize:(state,length)=>state.size+=length,exceeds:(size,limit)=>size>limit,
  retain:(state,buffer)=>state.chunks.push(buffer),concat:state=>Buffer.concat(state.chunks),
  headers:()=>new Headers(),
  eachHeader:(headers,target)=>{for(const [name,value] of Object.entries(headers))invoke("header",[target,name,value]);},
  isArray:value=>!!Array.isArray(value),join:value=>value.join(", "),setHeader:(headers,name,value)=>headers.set(name,value),
  requestConstructor:()=>Request,urlConstructor:()=>URL,
  url:(Constructor,value,issuer)=>new Constructor(value,issuer),options:(method,headers)=>({method,headers}),
  nonempty:value=>value.length>0,utf8:value=>value.toString("utf8"),body:(options,body)=>({...options,body}),
  request:(Constructor,url,options)=>new Constructor(url,options),
  responseHeaders:(headers,response)=>headers.forEach((value,name)=>response.setHeader(name,value)),
  status:(response,status)=>{response.statusCode=status;},
  responseBody:(response,webResponse)=>webResponse.arrayBuffer().then(body=>{response.end(Buffer.from(body));}),
  credentials:(storage,subject)=>({async read(){return invoke("credential",[await storage.credentials.get(subject)]);},update:update=>storage.credentials.update(subject,update),delete:()=>storage.credentials.delete(subject)}),
  invalidOperation(){throw new TypeError("Invalid hosted OAuth HTTP operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function writeWebResponse(response,webResponse){return invoke("response",[response,webResponse]);}
export async function readBody(request,maxBytes=65_536){const state={chunks:[],size:0};for await(const chunk of request)invoke("chunk",[state,chunk,maxBytes]);return invoke("body",[state]);}
export function toWebRequest(request,issuer,body){return invoke("request",[request,issuer,body]);}
export function credentialsFor(storage,subject){return invoke("credentials",[storage,subject]);}
