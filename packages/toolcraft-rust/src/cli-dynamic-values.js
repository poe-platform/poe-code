import {createRequire} from "node:module";
import {cloneDefaultValue,validate} from "toolcraft-schema-rust";
import {describeReceived} from "./cli-values.js";
import {formatCliSchemaKind,formatUnsupportedDynamicSchemaMessage} from "./cli-dynamic-paths.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliDynamicValuesPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,truthy:value=>!!value,
  isNull:value=>value===null,isObject:value=>typeof value==="object",isArray:value=>Array.isArray(value),
  unwrap:schema=>invoke("unwrap",[schema]),validate,
  issuePath:(issue,displayPath)=>[displayPath,...issue.path].filter(part=>invoke("nonemptyPart",[part])).join("."),
  issue:(path,issue)=>({path,message:`Invalid value for "${path}". ${issue.message}`}),
  pushIssues:(errors,validation,displayPath)=>errors.push(...validation.issues.map(issue=>invoke("issue",[issue,displayPath]))),
  indexedError(errors,value,displayPath){errors.push({path:displayPath,message:`Invalid value for "${displayPath}". Expected indexed object entries, got ${describeReceived(value)}.`});},
  objectError(errors,value,displayPath){errors.push({path:displayPath,message:`Invalid value for "${displayPath}". Expected an object, got ${describeReceived(value)}.`});},
  numericError(errors,displayPath){errors.push({path:displayPath,message:`Array parameter "${displayPath}" must use numeric indices.`});},
  contiguousError(errors,displayPath){errors.push({path:displayPath,message:`Array parameter "${displayPath}" must use contiguous indices starting at 0.`});},
  entries:value=>Object.entries(value),indices:entries=>entries.map(([key])=>Number(key)).sort((left,right)=>left-right),
  invalidIndices:indices=>indices.some(index=>invoke("invalidIndex",[index])),integer:index=>Number.isInteger(index),negative:index=>index<0,
  zero:()=>0,increment:index=>index+1,more:(index,indices)=>index<indices.length,at:(indices,index)=>indices[index],
  arrayValues:(indices,unwrappedSchema,value,displayPath,errors)=>indices.map(index=>invoke("finalize",[unwrappedSchema.item,value[String(index)],`${displayPath}.${index}`,errors])),
  object:()=>({}),
  eachObject(unwrappedSchema,value,displayPath,errors,result){for(const [key,rawChildSchema] of Object.entries(unwrappedSchema.shape))invoke("objectChild",[key,rawChildSchema,value,displayPath,errors,result]);},
  property:(value,key)=>value[key],empty:displayPath=>displayPath.length===0,childPath:(displayPath,key)=>`${displayPath}.${key}`,
  setDefault:(result,key,childSchema)=>{result[key]=cloneDefaultValue(childSchema.default);},
  setValue:(result,key,rawChildSchema,childValue,childDisplayPath,errors)=>{result[key]=invoke("finalize",[rawChildSchema,childValue,childDisplayPath,errors]);},
  missing:(errors,childDisplayPath)=>errors.push({path:childDisplayPath,message:`Missing required parameter "${childDisplayPath}".`}),
  record:(unwrappedSchema,value,displayPath,errors)=>Object.fromEntries(Object.entries(value).map(([key,entryValue])=>[key,invoke("recordChild",[unwrappedSchema,key,entryValue,displayPath,errors])])),
  recurse:(...args)=>invoke("finalize",args),
  unsupported(errors,unwrappedSchema,displayPath){errors.push({path:displayPath,message:formatUnsupportedDynamicSchemaMessage(formatCliSchemaKind(unwrappedSchema.kind),displayPath)});},
  invalidOperation(){throw new TypeError("Invalid CLI dynamic-value operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function finalizeDynamicValue(schema,value,displayPath,errors){return invoke("finalize",[schema,value,displayPath,errors]);}
export function formatFieldValidationIssue(issue,displayPath){return invoke("issue",[issue,displayPath]);}
