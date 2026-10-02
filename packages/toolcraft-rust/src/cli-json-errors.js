import {createRequire} from "node:module";
import {getErrorMessage} from "./cli-values.js";
import {renderSourceSnippet} from "./source-snippet.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliJsonErrorsPolicy,operation,args,host);}finally{depth--;}}
const operations={
  null:()=>null,isNull:value=>value===null,truthy:value=>!!value,
  isObject:value=>typeof value==="object",isNumber:value=>typeof value==="number",
  own:(value,name)=>Object.prototype.hasOwnProperty.call(value,name),property:(value,key)=>value[key],finite:propertyValue=>Number.isFinite(propertyValue),
  location:(line,column)=>({line,column}),errorMessage:getErrorMessage,
  findMarker:(message,marker)=>message.indexOf(marker),minusOne:markerIndex=>markerIndex===-1,
  startIndex:(markerIndex,marker)=>markerIndex+marker.length,
  messageMore:(endIndex,message)=>endIndex<message.length,at:(value,index)=>value[index],
  digitLower:value=>value>="0",digitUpper:value=>value<="9",false:()=>false,
  increment:value=>value+1,parsePosition:(message,startIndex,endIndex)=>Number.parseInt(message.slice(startIndex,endIndex),10),
  one:()=>1,zero:()=>0,bounded:offset=>Math.max(0,Math.floor(offset)),
  beforeBound:(index,boundedOffset)=>index<boundedOffset,sourceMore:(index,source)=>index<source.length,
  suffix:location=>` (line ${location.line} column ${location.column})`,
  endsWith:(message,nativeSuffix)=>message.endsWith(nativeSuffix),
  removeSuffix:(message,nativeSuffix)=>message.slice(0,-nativeSuffix.length),
  positionText:location=>` at line ${location.line} column ${location.column}`,
  quotedPath:filePath=>`"${filePath}"`,
  snippet:(source,location,filePath)=>`\n${renderSourceSnippet({source,line:location.line,column:location.column,filePath})}`,
  formatted:(label,formattedPath,message,positionText,snippet)=>`${label} ${formattedPath} is not valid JSON: ${message}${positionText}.${snippet}`,
  invalidOperation(){throw new TypeError("Invalid CLI JSON error operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function formatJsonParseUserErrorMessage(label,filePath,source,error,options){return invoke("format",[label,filePath,source,error,options]);}
export function removeNativeJsonParseLocation(message,location){return invoke("remove",[message,location]);}
export function getJsonParseErrorLocation(error,source){return invoke("errorLocation",[error,source]);}
export function getJsonParseCauseLocation(error){return invoke("causeLocation",[error]);}
export function getNumericProperty(value,key){return invoke("numeric",[value,key]);}
export function getJsonParseMessagePosition(message){return invoke("messagePosition",[message]);}
export function getSourceOffsetLocation(source,offset){return invoke("offsetLocation",[source,offset]);}
export function isAsciiDigit(value){return invoke("digit",[value]);}
