import {createRequire} from "node:module";
import {cloneDefaultValue,nativeJsonSchema,toJsonSchema,validate} from "toolcraft-schema-rust";
import {formatSegment} from "./mcp-metadata.js";
import {serializeResultValue} from "./mcp-validation.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.mcpSchemaPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,array:()=>[],values:value=>Object.values(value),
  overflow(){throw new RangeError("Maximum call stack size exceeded");},
  nativeSchema:schema=>schema[nativeJsonSchema],property:(object,key)=>object[key],spread:schema=>({...schema}),
  hasOwn:(object,key)=>Object.prototype.hasOwnProperty.call(object,key),directOwn:(object,key)=>Object.hasOwn(object,key),
  format:formatSegment,clone:cloneDefaultValue,apply:applySchemaCasing,
  serialize:(schema,value,casing)=>serializeResultValue(schema,value,casing,"default",[]),
  setDefault:(schema,value)=>{schema.default=value;},validDefault:schema=>!!validate({kind:"json"},schema.default).ok,deleteDefault:schema=>delete schema.default,
  oneOf:(schema,canonical,branches,casing,direction)=>schema.oneOf?.map((child,index)=>invoke("branch",[canonical,branches,index,child,casing,direction])),
  properties:(schema,canonical,casing,direction)=>Object.fromEntries(Object.entries(schema.properties??{}).map(([key,value])=>invoke("property",[canonical,casing,direction,key,value]))),
  required:(schema,canonical,casing,direction)=>schema.required?.filter(key=>invoke("required",[canonical,direction,key])).map(key=>formatSegment(key,casing)),
  aliases:(shape,casing)=>Object.entries(shape).flatMap(([key,child])=>invoke("alias",[key,child,casing])),
  aliasCondition:(key,caller)=>[{anyOf:[{not:{required:[key]}},{required:[caller]}]}],pair:(key,value)=>[key,value],
  withAdditional:(metadata,additionalProperties)=>({...metadata,...(additionalProperties===undefined?{}:{additionalProperties})}),
  arraySchema:(metadata,items,oneOf)=>({...metadata,items,...(oneOf===undefined?{}:{oneOf})}),
  leafSchema:(metadata,additionalProperties,oneOf)=>({...metadata,...(additionalProperties===undefined?{}:{additionalProperties}),...(oneOf===undefined?{}:{oneOf})}),
  objectSchema:(metadata,additionalProperties,properties,aliasConditions,required,oneOf,schema)=>({...metadata,...(additionalProperties===undefined?{}:{additionalProperties}),properties,...(aliasConditions.length===0?{}:{allOf:[...(schema.allOf??[]),...aliasConditions]}),...(required===undefined?{}:{required}),...(oneOf===undefined?{}:{oneOf})}),
  invalidOperation(){throw new TypeError("Invalid MCP schema operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function applySchemaCasing(source,casing,direction="output",schema=toJsonSchema(source)){return invoke("casing",[source,casing,direction,schema]);}
