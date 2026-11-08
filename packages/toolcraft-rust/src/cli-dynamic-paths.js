import {createRequire} from "node:module";
import {UserError} from "./index.js";
import {formatCLIName} from "./cli-policy.js";
import {formatAvailableList} from "./cli-values.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliDynamicPathsPolicy,operation,args,host);}finally{depth--;}}
function toDisplayPath(path){return path.join(".");}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,truthy:value=>!!value,
  empty:value=>value.length===0,unwrap:schema=>invoke("unwrap",[schema]),
  joinPath:toDisplayPath,qualify:(prefix,path)=>`${prefix}.${path}`,
  unsupported:(kind,displayPath)=>`Unsupported CLI argument shape for "${displayPath}" (type "${kind}").`,
  fail(message){throw new UserError(message);},
  leaf:(displayPath,path,schema)=>({displayPath,path,schema}),
  split(rawSegments){const [head,...rest]=rawSegments;return {head,rest};},
  appendOutput:(outputPath,key)=>[...outputPath,key],appendDisplay:(displayPath,key)=>[...displayPath,key],name:formatCLIName,
  recurse:(...args)=>invoke("leaf",args),
  objectChild(unwrappedSchema,head,rest,casing,outputPath,displayPath,prefix){for(const [key,childSchema] of Object.entries(unwrappedSchema.shape)){const selected=invoke("objectChild",[key,childSchema,head,rest,casing,outputPath,displayPath,prefix]);if(selected.done)return selected;}return {done:false};},
  selected:value=>({done:true,value}),unselected:()=>({done:false}),
  unknownObject(unwrappedSchema,head,casing,displayPath,displayPathPrefix){throw new UserError(`Unknown parameter "${invoke("qualify",[displayPathPrefix,[...displayPath,head].join(".")])}". ${formatAvailableList(Object.keys(unwrappedSchema.shape).map(key=>invoke("qualify",[displayPathPrefix,toDisplayPath([...displayPath,formatCLIName(key,casing)])])))}`);},
  arrayObjectError(displayPath,prefix){throw new UserError(`Array parameter "${invoke("qualify",[prefix,toDisplayPath(displayPath)])}" must use object items.`);},
  arrayIndexError(displayPath,prefix){throw new UserError(`Array parameter "${invoke("qualify",[prefix,toDisplayPath(displayPath)])}" must use numeric indices.`);},
  unknownLeaf(rawSegments,displayPath,displayPathPrefix){throw new UserError(`Unknown parameter "${invoke("qualify",[displayPathPrefix,[...displayPath,...rawSegments].join(".")])}". ${formatAvailableList(invoke("availablePaths",[displayPath,displayPathPrefix]))}`);},
  availablePaths:(displayPath,prefix)=>[invoke("qualify",[prefix,toDisplayPath(displayPath)])],list:()=>[],
  digits(value){for(const char of value){if(invoke("badDigit",[char]))return false;}return true;},
  below:char=>char<"0",above:char=>char>"9",
  flagPath:flagName=>flagName.split("."),
  sorted:dynamicFields=>[...dynamicFields].sort((left,right)=>right.optionPath.length-left.optionPath.length),
  find:(candidates,flagPath,casing)=>candidates.find(field=>invoke("matches",[field,flagPath,casing])),
  optionPath:(field,casing)=>field.optionPath.map(segment=>formatCLIName(segment,casing)),
  moreSegments:(flagPath,optionPath)=>flagPath.length>optionPath.length,
  every:(optionPath,flagPath)=>optionPath.every((segment,index)=>flagPath[index]===segment),
  match:(match,flagPath,casing)=>({match,leaf:invoke("leaf",[match.schema,flagPath.slice(match.optionPath.length),casing,[],[],match.displayPath])}),
  invalidOperation(){throw new TypeError("Invalid CLI dynamic-path operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function resolveDynamicLeaf(schema,rawSegments,casing,outputPath=[],displayPath=[],displayPathPrefix=""){return invoke("leaf",[schema,rawSegments,casing,outputPath,displayPath,displayPathPrefix]);}
export function resolveDynamicOption(dynamicFields,flagName,casing){return invoke("option",[dynamicFields,flagName,casing]);}
export function isNumericFixtureSelector(value){return invoke("numeric",[value]);}
export function formatCliSchemaKind(kind){return invoke("kind",[kind]);}
export function formatUnsupportedDynamicSchemaMessage(kind,displayPath){return invoke("unsupported",[kind,displayPath]);}
export function qualifyDisplayPath(prefix,displayPath){return invoke("qualify",[prefix,displayPath]);}
