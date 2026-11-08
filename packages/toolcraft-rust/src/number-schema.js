import {createRequire} from "node:module";
import {callNative,protect} from "./host-errors.js";

const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){
  if(depth>=128)throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try{return callNative(native.numberSchemaPolicy,operation,args,host);}
  finally{depth--;}
}
const operations={
  true:()=>true,false:()=>false,
  isNumber:value=>typeof value==="number",
  finite:value=>Number.isFinite(value),integer:value=>Number.isInteger(value),
  truthy:value=>!!value,gte:(value,bound)=>value>=bound,lte:(value,bound)=>value<=bound,
  interpolate:(prefix,bound)=>`${prefix}${bound}`,
  bounds:(minimum,maximum)=>[minimum,maximum].filter(bound=>invoke("bound",[bound])),
  zero:length=>length===0,join:(bounds,separator)=>bounds.join(separator),
  description:(kind,bounds)=>`${kind} ${bounds}`,
  invalidOperation(){throw new TypeError("Invalid numeric schema operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};

export function isValidNumberSchemaValue(value,schema){return invoke("valid",[value,schema]);}
export function getExpectedNumberDescription(schema){return invoke("describe",[schema]);}
