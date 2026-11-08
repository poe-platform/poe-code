import {createRequire} from "node:module";
import {UserError} from "./index.js";
import {isNegativeNumericToken} from "./cli-argv.js";
import {formatAvailableList} from "./cli-values.js";
import {consumeFieldValue} from "./cli-consume.js";
import {resolveDynamicOption} from "./cli-dynamic-paths.js";
import {finalizeDynamicValue} from "./cli-dynamic-values.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliDynamicArgvPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,truthy:value=>!!value,zero:()=>0,increment:index=>index+1,list:()=>[],object:()=>({}),map:()=>new Map(),set:()=>new Set(),
  more:(index,rawArgv)=>index<rawArgv.length,at:(rawArgv,index)=>rawArgv[index],
  tail:(positionals,rawArgv,index)=>positionals.push(...rawArgv.slice(index+1)),push:(positionals,token)=>positionals.push(token),
  long:token=>token.startsWith("--"),multi:token=>token.length>1,hyphen:token=>token.startsWith("-"),negative:isNegativeNumericToken,
  unknownOption(token){throw new UserError(`Unknown option "${token}".`);},
  negated:token=>token.startsWith("--no-"),normalize:token=>`--${token.slice("--no-".length)}`,
  equals:normalized=>normalized.indexOf("="),attached:equalsIndex=>equalsIndex>=0,
  flagWithValue:(normalized,equalsIndex)=>normalized.slice(2,equalsIndex),flag:normalized=>normalized.slice(2),inline:(normalized,equalsIndex)=>normalized.slice(equalsIndex+1),
  resolve:resolveDynamicOption,
  unknownParameter(flagName,dynamicFields){throw new UserError(`Unknown parameter "${flagName}". ${formatAvailableList(dynamicFields.map(field=>field.optionPathDisplay))}`);},
  raw:(rawValues,match)=>rawValues.get(match.id),
  label:(match,leaf)=>`${match.displayPath}.${leaf.displayPath}`.replace(/^\./u,""),
  negatedValue:index=>({nextIndex:index,value:false}),consume:consumeFieldValue,
  store:(rawStore,leaf,parsed)=>invoke("nested",[rawStore,leaf.path,parsed.value]),
  keep:(rawValues,match,rawStore)=>rawValues.set(match.id,rawStore),provided:(providedFieldIds,match)=>providedFieldIds.add(match.id),
  finish:(providedFieldIds,positionals,dynamicFields,rawValues,errors)=>({providedFieldIds,positionals,values:new Map(dynamicFields.filter(field=>rawValues.has(field.id)).map(field=>[field.id,invoke("finalized",[field,rawValues,errors])]))}),
  finalize:finalizeDynamicValue,
  pathMore:(index,path)=>index<path.length-1,pathAt:(path,index)=>path[index],leaf:path=>path[path.length-1],
  own:(cursor,segment)=>Object.prototype.hasOwnProperty.call(cursor,segment),existing:(cursor,segment)=>cursor[segment],
  isObject:existing=>typeof existing==="object",isNull:existing=>existing===null,
  define:(cursor,segment,value)=>Object.defineProperty(cursor,segment,{value,enumerable:true,configurable:true,writable:true}),
  invalidOperation(){throw new TypeError("Invalid CLI dynamic-argv operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function parseDynamicValues(dynamicFields,rawArgv,casing,errors){return invoke("parse",[dynamicFields,rawArgv,casing,errors]);}
export function setNestedValue(target,path,value){return invoke("nested",[target,path,value]);}
