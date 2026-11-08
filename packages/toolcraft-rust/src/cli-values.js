import {createRequire} from "node:module";
import {unicodeLength} from "toolcraft-schema-rust";
import {UserError,suggest} from "./index.js";
import {isValidNumberSchemaValue,getExpectedNumberDescription} from "./number-schema.js";
import {splitArrayInput} from "./cli-argv.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliValuesPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,null:()=>null,true:()=>true,false:()=>false,truthy:value=>!!value,
  list:(...values)=>values,isNull:value=>value===null,isArray:value=>Array.isArray(value),
  isObject:value=>typeof value==="object",isString:value=>typeof value==="string",isError:error=>error instanceof Error,
  string:value=>String(value),json:value=>JSON.stringify(value),arrayDescription:value=>`array(${value.length})`,
  longString:value=>value.length>40,truncate:value=>`${value.slice(0,40)}…`,quoted:value=>`${JSON.stringify(value)}`,
  booleanText:value=>value.trim().toLowerCase(),
  booleanError(value,label){throw new UserError(`Invalid value for "${label}". Expected true or false, got ${invoke("received",[value])}.`);},
  findEnum:(values,value)=>values.find(candidate=>invoke("enumMatch",[candidate,value])),
  suggestions:(value,values)=>suggest(value,values.map(candidate=>String(candidate))),
  positive:value=>value>0,suggestionLine:suggestions=>` Did you mean: ${suggestions.join(", ")}?\n`,
  enumError(value,values,label,suggestionLine){throw new UserError(`Invalid value for "${label}".${suggestionLine}Expected one of: ${values.map(candidate=>String(candidate)).join(", ")}, got ${invoke("received",[value])}.`);},
  unicodeLength,stringMin:(length,schema)=>length<schema.minLength,stringMax:(length,schema)=>length>schema.maxLength,
  minString(schema,label,length){throw new UserError(`Invalid value for "${label}". Expected a string with length at least ${schema.minLength}, got string with length ${length}.`);},
  maxString(schema,label,length){throw new UserError(`Invalid value for "${label}". Expected a string with length at most ${schema.maxLength}, got string with length ${length}.`);},
  pattern:(value,pattern)=>new RegExp(pattern).test(value),
  patternError(value,schema,label){throw new UserError(`Invalid value for "${label}": "${value}" does not match pattern "${schema.pattern}".`);},
  jsonResult(value){try{return {value:JSON.parse(value),failed:false};}catch(error){return {error,failed:true};}},
  jsonError(value,label,error){throw new UserError(`Invalid value for "${label}". Expected valid JSON, got ${invoke("received",[value])} (parser: ${invoke("errorMessage",[error])}).`);},
  number:value=>Number(value),blank:value=>value.trim().length===0,validNumber:isValidNumberSchemaValue,
  numberError(value,schema,label){throw new UserError(`Invalid value for "${label}". Expected ${getExpectedNumberDescription(schema)}, got ${invoke("received",[value])}.`);},
  available:values=>`Available: ${[...values].sort().join(", ")}.`,
  unsupported(kinds){throw new UserError(`Unsupported CLI schema kind. ${invoke("available",[kinds])}`);},
  unwrap:schema=>invoke("unwrap",[schema]),
  arrayItems:(value,itemSchema,label)=>splitArrayInput(value).map(item=>invoke("scalar",[item,itemSchema,label])),
  nonscalarArray(label){throw new UserError(`Array parameter "${label}" must use scalar items.`);},
  arrayMin:(value,schema)=>value.length<schema.minItems,arrayMax:(value,schema)=>value.length>schema.maxItems,
  minArray(value,schema,label){throw new UserError(`Invalid value for "${label}". Expected an array with at least ${schema.minItems} items, got array(${value.length}).`);},
  maxArray(value,schema,label){throw new UserError(`Invalid value for "${label}". Expected an array with at most ${schema.maxItems} items, got array(${value.length}).`);},
  missingBase:field=>`Missing required parameter "${field.displayPath}".`,
  missingEnum:(field,message)=>`${message} Expected one of: ${field.schema.values.map(value=>String(value)).join(", ")}.`,
  invalidOperation(){throw new TypeError("Invalid CLI value operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function parseBooleanText(value,label){return invoke("boolean",[value,label]);}
export function parseEnumValue(value,values,label){return invoke("enum",[value,values,label]);}
export function validateStringPattern(value,schema,label){return invoke("string",[value,schema,label]);}
export function matchesStringPattern(value,pattern){return invoke("pattern",[value,pattern]);}
export function parseJsonText(value,label){return invoke("json",[value,label]);}
export function describeReceived(value){return invoke("received",[value]);}
export function getErrorMessage(error){return invoke("errorMessage",[error]);}
export function formatAvailableList(values){return invoke("available",[values]);}
export function parseScalarValue(value,schema,label){return invoke("scalar",[value,schema,label]);}
export function parseArrayValue(value,schema,label){return invoke("array",[value,schema,label]);}
export function validateArrayBounds(value,schema,label){return invoke("arrayBounds",[value,schema,label]);}
export function formatMissingParameterMessage(field){return invoke("missing",[field]);}
