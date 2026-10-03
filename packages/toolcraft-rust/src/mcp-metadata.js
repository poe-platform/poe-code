import {createRequire} from "node:module";
import {formatMCPName as formatSegment} from "./cli-policy.js";
import {callNative,protect} from "./host-errors.js";
export {formatSegment};
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){
  if(depth>=128)throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try{return callNative(native.mcpMetadataPolicy,operation,args,host);}
  finally{depth--;}
}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,truthy:value=>!!value,
  array:()=>[],isArray:Array.isArray,isString:value=>typeof value==="string",
  root:roots=>({kind:"group",name:"",aliases:[],secrets:{},children:roots}),
  unwrap:schema=>invoke("unwrap",[schema]),
  summaries:collectParamSummaries,
  members(shape,casing,path,optional,summaries){
    for(const [key,raw] of Object.entries(shape))invoke("member",[key,raw,casing,path,optional,summaries]);
  },
  path:(path,key,casing)=>[...path,formatSegment(key,casing)],
  append:(summaries,nested)=>summaries.push(...nested),
  summary:(summaries,path,suffix)=>summaries.push(`${path.join(".")}${suffix}`),
  empty:value=>value.length===0,
  parameterText:summary=>`Parameters: ${summary.join(", ")}.`,
  exampleText:(examples,commandName)=>`\n\nExamples:\n${examples.map(example=>`- ${example.title}: ${commandName} ${Object.entries(example.params).map(([key,value])=>`${key}=${invoke("exampleValue",[value])}`).join(" ")}`).join("\n")}`,
  concat:(left,right)=>`${left}${right}`,
  descriptionText:(description,parameter,example)=>`${description} ${parameter}${example}`,
  json:value=>JSON.stringify(value),
  candidates(toolName){const segments=toolName.split("__");return segments.map((_segment,index)=>segments.slice(0,index+1).join("__"));},
  matches:(candidates,allowlist)=>candidates.some(candidate=>allowlist.includes(candidate)),
  invalidOperation(){throw new TypeError("Invalid MCP metadata operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function normalizeRoots(roots){return invoke("roots",[roots]);}
export function collectParamSummaries(schema,casing,path=[],inheritedOptional=false){return invoke("summaries",[schema,casing,path,inheritedOptional]);}
export function buildToolDescription(description,params,examples,commandName,casing){return invoke("description",[description,params,examples,commandName,casing]);}
export function matchesAllowlist(toolName,allowlist){return invoke("allowlist",[toolName,allowlist]);}
export function formatToolName(path){return path.map(segment=>formatSegment(segment,"snake")).join("__");}
