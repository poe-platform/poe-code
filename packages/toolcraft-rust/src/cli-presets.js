import {createRequire} from "node:module";
import {readFile} from "node:fs/promises";
import {unicodeLength,validate as validateSchema} from "toolcraft-schema-rust";
import {UserError} from "./index.js";
import {getExpectedNumberDescription,isValidNumberSchemaValue} from "./number-schema.js";
import {describeReceived,matchesStringPattern} from "./cli-values.js";
import {unwrapOptional} from "./cli-argv.js";
import {formatJsonParseUserErrorMessage} from "./cli-json-errors.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliPresetsPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,truthy:value=>!!value,
  isNull:value=>value===null,isObject:value=>typeof value==="object",isArray:value=>Array.isArray(value),
  isString:value=>typeof value==="string",isBoolean:value=>typeof value==="boolean",isError:value=>value instanceof Error,
  ownCode:error=>Object.prototype.hasOwnProperty.call(error,"code"),nonempty:message=>message.length>0,
  missing(path){throw new UserError(`Preset file "${path}" was not found.`);},
  readError(path,message){throw new UserError(`Preset file "${path}" could not be read: ${message}`);},
  expectedEnum:schema=>`one of: ${schema.values.map(value=>JSON.stringify(value)).join(", ")}`,
  expectedOther:schema=>`a ${schema.kind}`,expectedNumber:getExpectedNumberDescription,
  unicodeLength,stringMin:(length,schema)=>length<schema.minLength,stringMax:(length,schema)=>length>schema.maxLength,
  minString(schema,fieldPath,presetPath,length){throw new UserError(`Preset file "${presetPath}" has an invalid value for "${fieldPath}". Expected a string with length at least ${schema.minLength}, got string with length ${length}.`);},
  maxString(schema,fieldPath,presetPath,length){throw new UserError(`Preset file "${presetPath}" has an invalid value for "${fieldPath}". Expected a string with length at most ${schema.maxLength}, got string with length ${length}.`);},
  pattern:matchesStringPattern,
  patternError(value,schema,fieldPath,presetPath){throw new UserError(`Preset file "${presetPath}" has an invalid value for "${fieldPath}": "${value}" does not match pattern "${schema.pattern}".`);},
  validNumber:isValidNumberSchemaValue,findEnum:(schema,value)=>schema.values.find(candidate=>Object.is(candidate,value)),
  invalidScalar(value,schema,fieldPath,presetPath){throw new UserError(`Preset file "${presetPath}" has an invalid value for "${fieldPath}". Expected ${invoke("expected",[schema])}, got ${describeReceived(value)}.`);},
  scalarField:(value,field,presetPath)=>invoke("scalar",[value,field.schema,field.displayPath,presetPath]),
  unwrap:unwrapOptional,
  nonscalar(field){throw new UserError(`Array parameter "${field.displayPath}" must use scalar items.`);},
  notArray(value,field,path){throw new UserError(`Preset file "${path}" has an invalid value for "${field.displayPath}". Expected an array, got ${describeReceived(value)}.`);},
  arrayMin:(value,field)=>value.length<field.schema.minItems,arrayMax:(value,field)=>value.length>field.schema.maxItems,
  minArray(value,field,path){throw new UserError(`Preset file "${path}" has an invalid value for "${field.displayPath}". Expected an array with at least ${field.schema.minItems} items, got array(${value.length}).`);},
  maxArray(value,field,path){throw new UserError(`Preset file "${path}" has an invalid value for "${field.displayPath}". Expected an array with at most ${field.schema.maxItems} items, got array(${value.length}).`);},
  mapItems:(value,itemSchema,field,path)=>value.map(item=>invoke("scalar",[item,itemSchema,field.displayPath,path])),
  nested:(fields,path)=>fields.some(field=>invoke("nestedField",[field,path])),
  shorter:(field,path)=>path.length<field.path.length,
  prefix:(field,path)=>path.every((segment,index)=>field.path[index]===segment),
  parse(raw){try{return {ok:true,value:JSON.parse(raw)};}catch(error){return {ok:false,error};}},
  jsonError(path,raw,error){throw new UserError(formatJsonParseUserErrorMessage("Preset file",path,raw,error,{quotePath:true}),{cause:error});},
  notObject(path){throw new UserError(`Preset file "${path}" must contain a JSON object.`);},
  initialize(fields,dynamicFields,presetPath){
    const fieldByPath=new Map(fields.map(field=>[field.displayPath,field]));
    const dynamicFieldByPath=new Map(dynamicFields.map(field=>[field.displayPath,field]));
    const allFields=[...fields,...dynamicFields];
    const presetValues={};
    const dynamicValues=new Map();
    return {fieldByPath,dynamicFieldByPath,allFields,presetValues,dynamicValues,presetPath};
  },
  emptyPath:()=>[],
  visit(state,current,path){for(const [key,value] of Object.entries(current)){const nextPath=[...path,key];const displayPath=nextPath.join(".");invoke("entry",[state,value,nextPath,displayPath]);}},
  field:(state,displayPath)=>state.fieldByPath.get(displayPath),dynamic:(state,displayPath)=>state.dynamicFieldByPath.get(displayPath),
  writeField:(state,field,value)=>{state.presetValues[field.optionAttribute]=invoke("field",[value,field,state.presetPath]);},
  validate:(field,value)=>validateSchema(field.schema,value,{defaults:"all"}),
  dynamicError(state,displayPath,validation){const issue=validation.issues[0];const issuePath=[displayPath,...issue.path].join(".");throw new UserError(`Preset file "${state.presetPath}" has an invalid value for "${issuePath}". ${issue.message}`);},
  writeDynamic:(state,field,validation)=>state.dynamicValues.set(field.id,validation.value),
  unknown(state,displayPath){throw new UserError(`Preset file "${state.presetPath}" contains unknown parameter "${displayPath}".`);},
  notNested(state,displayPath,value){throw new UserError(`Preset file "${state.presetPath}" has an invalid value for "${displayPath}". Expected an object, got ${describeReceived(value)}.`);},
  result:state=>({fields:state.presetValues,dynamic:state.dynamicValues}),
  invalidOperation(){throw new TypeError("Invalid CLI preset operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export async function loadPresetValues(fields,dynamicFields,presetPath){
  let rawPreset;
  try{rawPreset=await readFile(presetPath,{encoding:"utf8"});}
  catch(error){return invoke("readError",[error,presetPath]);}
  return invoke("load",[fields,dynamicFields,presetPath,rawPreset]);
}
export function validatePresetFieldValue(value,field,presetPath){return invoke("field",[value,field,presetPath]);}
export function validatePresetScalarValue(value,schema,fieldPath,presetPath){return invoke("scalar",[value,schema,fieldPath,presetPath]);}
export function describeExpectedPresetValue(schema){return invoke("expected",[schema]);}
export function hasNestedField(fields,path){return invoke("nested",[fields,path]);}
