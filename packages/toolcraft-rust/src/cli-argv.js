import {createRequire} from "node:module";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliArgvPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,null:()=>null,true:()=>true,false:()=>false,truthy:value=>!!value,
  zeroIndex:()=>0,twoIndex:()=>2,increment:index=>index+1,zero:value=>value===0,positive:value=>value>0,
  list:()=>[],more:(value,index)=>index<value.length,at:(value,index)=>value[index],
  trim:current=>current.trim(),append:(current,char)=>current+char,push:(items,value)=>items.push(value),
  unwrap:schema=>invoke("unwrap",[schema]),
  startsDash:token=>token.startsWith("-"),startsLong:token=>token.startsWith("--"),longShort:token=>token.length>2,
  everyNumber:items=>items.every(item=>Number.isFinite(Number(item))),
  split:value=>invoke("split",[value]),negative:token=>invoke("negative",[token]),
  findOption:(options,token)=>options.find(candidate=>candidate.short===token||candidate.long===token),
  findAttached:(options,token)=>options.find(candidate=>candidate.short===token.slice(0,2)),
  pushTail:(normalized,argv,index)=>normalized.push(...argv.slice(index)),
  pushNormalized:(normalized,value)=>normalized.push(value),nextStartsDash:nextToken=>nextToken.startsWith("-"),
  next:(argv,index)=>argv[index+1],nextLong:nextToken=>nextToken.length>1,
  has:(numericArrayOptions,option)=>numericArrayOptions.has(option),
  outputPrefix:token=>token.startsWith("--output="),outputValue:token=>token.slice("--output=".length),
  hasFormat:(formats,value)=>Object.hasOwn(formats,value),
  invalidOperation(){throw new TypeError("Invalid CLI argv operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function splitArrayInput(value){return invoke("split",[value]);}
export function isNegativeNumericToken(token){return invoke("negative",[token]);}
export function isNextArrayOptionToken(token,schema){return invoke("nextOption",[token,schema]);}
export function normalizeNumericArrayOptions(argv,options,numericArrayOptions){return invoke("normalize",[argv,options,numericArrayOptions]);}
export function resolveHelpOutput(argv){return invoke("helpOutput",[argv]);}
export function resolveOutput(resolvedFlags){return invoke("output",[resolvedFlags]);}
export function resolveOutputFromArgv(argv,formats={}){return invoke("argvOutput",[argv,formats]);}
export function toDesignSystemOutput(output){return invoke("designOutput",[output]);}
export function resolveDebugStackMode(value){return invoke("debugMode",[value]);}
export function getDebugStackModeFromArgv(argv){return invoke("argvDebug",[argv]);}
