import {createRequire} from "node:module";
import {InvalidArgumentError} from "commander";
import {isUserError} from "./index.js";
import {parseScalarValue,parseArrayValue,parseJsonText,validateArrayBounds} from "./cli-values.js";
import {isNextArrayOptionToken} from "./cli-argv.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliConsumePolicy,operation,args,host);}finally{depth--;}}
const operations={
  null:()=>null,true:()=>true,truthy:value=>!!value,list:()=>[],
  isNull:value=>value===null,isString:value=>typeof value==="string",isArray:value=>Array.isArray(value),
  scalar:parseScalarValue,array:parseArrayValue,json:parseJsonText,bounds:validateArrayBounds,
  nextOption:isNextArrayOptionToken,string:item=>String(item),
  attempt(field,value){try{return {failed:false,value:invoke("optionBody",[field,value])};}catch(error){return {failed:true,error};}},
  userError:isUserError,argumentError:error=>error instanceof InvalidArgumentError,
  rethrow(error){throw error;},
  pushError:(errors,field,error)=>errors.push({path:field.displayPath,message:error.message}),
  failed:()=>({ok:false}),success:value=>({ok:true,value}),
  eachItem(value,field,parsedValues){for(const item of value){const state=invoke("optionItem",[item,field,parsedValues]);if(state.done)return state;}return {done:false};},
  done:()=>({done:true}),notDone:()=>({done:false}),
  append:(values,parsed)=>values.push(...parsed),
  next:(args,index)=>args[index+1],increment:index=>index+1,
  more:(cursor,args)=>cursor<args.length,at:(args,cursor)=>args[cursor],
  empty:values=>values.length===0,
  missing(label){throw new InvalidArgumentError(`option '${label}' argument missing`);},
  consumed:(nextIndex,value)=>({nextIndex,value}),
  invalidOperation(){throw new TypeError("Invalid CLI value-consumption operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function parseFieldInputValue(value,schema,label){return invoke("input",[value,schema,label]);}
export function parseOptionFieldValue(field,value,errors){return invoke("option",[field,value,errors]);}
export function consumeFieldValue(args,index,schema,label,inlineValue){return invoke("consume",[args,index,schema,label,inlineValue]);}
