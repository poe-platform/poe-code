import {createRequire} from "node:module";
import {cloneDefaultValue,formatIssues,isPlainRecord,nativeJsonSchema,unicodeLength,validate} from "toolcraft-schema-rust";
import {ToolError,JSON_RPC_ERROR_CODES} from "tiny-stdio-mcp-server-rust";
import {UserError,suggest} from "./index.js";
import {validateAppliedDefault} from "./applied-default.js";
import {resolveDiscriminatedBranch,validateUnionSchema} from "./branch-validation.js";
import {getExpectedNumberDescription,isValidNumberSchemaValue} from "./number-schema.js";
import {formatSegment} from "./mcp-metadata.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");

// Each traversal keeps its casing and host callbacks local, including reentrant
// validation from getters. SDK and MCP share the Rust structural policy.
function validator(casing){
  let depth=0;
  function invoke(operation,args){
    if(depth>=128)throw new RangeError("Maximum call stack size exceeded");
    depth++;
    try{return callNative(operation.startsWith("result")?native.mcpOutputPolicy:native.sdkValidate,operation,args,host);}
    finally{depth--;}
  }
  const received=value=>invoke("mcpReceived",[value]);
  const operations={
    undefined:()=>undefined,object:()=>({}),array:()=>[],emptyString:()=>"",space:()=>" ",
    overflow(){throw new RangeError("Maximum call stack size exceeded");},
    invalidOperation(){throw new TypeError("Invalid MCP validation operation");},
    isPlain:isPlainRecord,isNull:value=>value===null,isString:value=>typeof value==="string",
    isObject:value=>typeof value==="object",isBoolean:value=>typeof value==="boolean",isArray:Array.isArray,
    validNumber:isValidNumberSchemaValue,lt:(left,right)=>left<right,gt:(left,right)=>left>right,
    empty:value=>value.length===0,fieldLabel:(label,key)=>`${label}.${key}`,
    hasOwn:(value,key)=>Object.prototype.hasOwnProperty.call(value,key),
    aliasOwn:(value,key)=>Object.hasOwn(value,key),
    property:(value,key)=>value[key],mapHas:(map,key)=>map.has(key),includes:(values,value)=>!!values.includes(value),
    define:(output,key,value)=>Object.defineProperty(output,key,{value,enumerable:true,configurable:true,writable:true}),
    nativeSchema:schema=>schema[nativeJsonSchema],format:key=>formatSegment(key,casing),
    default:validateAppliedDefault,validate,unicodeLength,matches:(pattern,value)=>!!new RegExp(pattern).test(value),
    fields(shape){const fields=new Map();for(const [key,schema] of Object.entries(shape))fields.set(formatSegment(key,casing),[key,schema]);return fields;},
    extras(schema,input,label,errors,output,fields){for(const key of Object.keys(input))invoke("extra",[schema,input,label,errors,output,fields,key]);},
    members(input,label,errors,output,fields){for(const [key,[original,schema]] of fields.entries())invoke("field",[input,label,errors,output,key,original,schema]);},
    value:(...args)=>invoke("value",args),validateObject:(...args)=>invoke("object",args),native:(...args)=>invoke("mcpNative",args),
    clone:cloneDefaultValue,resultValue:(...args)=>invoke("resultValue",args),resultObject:(...args)=>invoke("resultObject",args),
    resultArray:(schema,value,label,errors)=>value.map((item,index)=>invoke("resultValue",[schema.item,item,`${label}[${index}]`,errors])),
    resultRecord:(schema,value,label,errors)=>Object.fromEntries(Object.entries(value).map(([key,item])=>[key,invoke("resultValue",[schema.value,item,`${label}.${key}`,errors])])),
    resultDiscriminated:(value,schema,resolved)=>({...value,[formatSegment(schema.discriminator,casing)]:resolved.discriminator}),
    resultUnion:(schema,value,label,errors)=>validateUnionSchema(schema,value,label,errors,(branch,branchErrors)=>invoke("resultObject",[branch,value,label,branchErrors])),
    expectedKeys:shape=>new Set(Object.keys(shape)),setHas:(set,key)=>set.has(key),wireKeys:expected=>new Set([...expected].map(key=>formatSegment(key,casing))),
    resultExtras(schema,value,label,errors,expected){for(const key of Object.keys(value))invoke("resultExtra",[schema,label,errors,expected,key]);},
    resultMembers(shape,value,label,errors,output){for(const [key,raw] of Object.entries(shape))invoke("resultField",[value,label,errors,output,key,raw]);},
    resultCarry(value,expected,wire,output){for(const key of Object.keys(value))invoke("resultCarryField",[value,expected,wire,output,key]);},
    unexpectedResult:(errors,field,expected,label)=>errors.push({path:field,message:`Unexpected result field "${field}". Available: ${[...expected].map(key=>label.length===0?key:`${label}.${key}`).sort().join(", ")}.`}),
    missingResult:(errors,field)=>errors.push({path:field,message:`Missing required result field "${field}".`}),
    singleResultError(errors){throw new ToolError(JSON_RPC_ERROR_CODES.INTERNAL_ERROR,errors[0]?.message??"Invalid command result.");},
    multipleResultErrors(errors){const rendered=errors.slice(0,10).map(error=>`  - ${error.path}: ${error.message}`);const remaining=errors.length-rendered.length;if(remaining>0)rendered.push(`  ... and ${remaining} more`);throw new ToolError(JSON_RPC_ERROR_CODES.INTERNAL_ERROR,`${errors.length} result errors:\n${rendered.join("\n")}`);},
    arrayValues:(schema,value,label,errors)=>value.map((item,index)=>invoke("value",[schema.item,item,`${label}[${index}]`,errors])),
    recordValues:(schema,value,label,errors)=>Object.fromEntries(Object.entries(value).map(([key,item])=>[key,invoke("value",[schema.value,item,`${label}.${key}`,errors])])),
    discriminator:resolveDiscriminatedBranch,
    discriminatedValue:(value,schema,resolved)=>({...value,[schema.discriminator]:resolved.discriminator}),
    union:(schema,value,label,errors)=>validateUnionSchema(schema,value,label,errors,(branch,branchErrors)=>invoke("object",[branch,value,label,branchErrors])),
    invalidObject:(errors,label,value)=>errors.push({path:label,message:`Invalid value for "${label}". Expected an object, got ${received(value)}.`}),
    invalidString:(errors,label,value)=>errors.push({path:label,message:`Invalid value for "${label}". Expected a string, got ${received(value)}.`}),
    invalidBoolean:(errors,label,value)=>errors.push({path:label,message:`Invalid value for "${label}". Expected a boolean, got ${received(value)}.`}),
    invalidArray:(errors,label,value)=>errors.push({path:label,message:`Invalid value for "${label}". Expected an array, got ${received(value)}.`}),
    invalidNumber:(errors,label,value,schema)=>errors.push({path:label,message:`Invalid value for "${label}". Expected ${getExpectedNumberDescription(schema)}, got ${received(value)}.`}),
    invalidEnum:(errors,label,value,schema)=>errors.push({path:label,message:invoke("mcpEnumError",[value,schema,label])}),
    patternError:(errors,label,value,schema)=>errors.push({path:label,message:`Invalid value for "${label}": "${value}" does not match pattern "${schema.pattern}".`}),
    shortString:(errors,label,schema,length)=>errors.push({path:label,message:`Invalid value for "${label}". Expected a string with length at least ${schema.minLength}, got string with length ${length}.`}),
    longString:(errors,label,schema,length)=>errors.push({path:label,message:`Invalid value for "${label}". Expected a string with length at most ${schema.maxLength}, got string with length ${length}.`}),
    shortArray:(errors,label,schema,value)=>errors.push({path:label,message:`Invalid value for "${label}". Expected an array with at least ${schema.minItems} items, got array(${value.length}).`}),
    longArray:(errors,label,schema,value)=>errors.push({path:label,message:`Invalid value for "${label}". Expected an array with at most ${schema.maxItems} items, got array(${value.length}).`}),
    unexpected:(errors,field,fields,label)=>errors.push({path:field,message:`Unexpected parameter "${field}". Available: ${[...fields.keys()].map(key=>label.length===0?key:`${label}.${key}`).sort().join(", ")}.`}),
    missing:(errors,field)=>errors.push({path:field,message:`Missing required parameter "${field}".`}),
    alias:(errors,alias,field)=>errors.push({path:alias,message:`Unexpected parameter "${alias}". Use "${field}" for this declared parameter.`}),
    nativeIssues:(errors,label,issues)=>errors.push(...issues.map(issue=>({path:[label,...issue.path].filter(part=>part!=="").join("."),message:formatIssues([issue])}))),
    jsonIssues:(errors,label,issues)=>errors.push(...issues.map(issue=>({path:label,message:issue.message}))),
    receivedNull:()=>"null",receivedMissing:()=>"missing",receivedArray:value=>`array(${value.length})`,receivedObject:()=>"object",receivedNonPlain:()=>"non-plain object",
    longReceived:value=>value.length>40,truncateReceived:value=>`${value.slice(0,40)}…`,quotedReceived:value=>`${JSON.stringify(value)}`,json:value=>JSON.stringify(value),
    suggestions:(value,schema)=>suggest(value,schema.values.map(candidate=>String(candidate))),positiveLength:value=>value.length>0,
    suggestionLine:suggestions=>` Did you mean: ${suggestions.join(", ")}?\n`,
    enumMessage:(value,schema,label,suggestion)=>`Invalid value for "${label}".${suggestion}Expected one of: ${schema.values.map(candidate=>String(candidate)).join(", ")}, got ${received(value)}.`,
    single:errors=>errors.length===1,
    singleError(errors){throw new UserError(errors[0]?.message??"Invalid parameters.");},
    multipleErrors(errors){const rendered=errors.slice(0,10).map(error=>`  - ${error.path}: ${error.message}`);const remaining=errors.length-rendered.length;if(remaining>0)rendered.push(`  … and ${remaining} more`);throw new UserError(`${errors.length} parameter errors:\n${rendered.join("\n")}`);}
  };
  const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
  return invoke;
}
export function validateSchemaValue(schema,value,casing,label,errors){return validator(casing)("value",[schema,value,label,errors]);}
export function validateObjectSchema(schema,value,casing,label,errors){return validator(casing)("object",[schema,value,label,errors]);}
export function validateToolArguments(schema,value,casing){return validator(casing)("mcpArguments",[schema,value]);}
export function serializeResultValue(schema,value,casing,label,errors){return validator(casing)("resultValue",[schema,value,label,errors]);}
export function serializeResultObject(schema,value,casing,label,errors){return validator(casing)("resultObject",[schema,value,label,errors]);}
export function validateCommandResult(schema,value,casing){return validator(casing)("resultCommand",[schema,value]);}
export function throwResultValidationErrors(errors){return validator(undefined)("resultErrors",[errors]);}
