import {createRequire} from "node:module";
import {Option} from "commander";
import {formatOptionFlags} from "./cli-fields.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliOptionsPolicy,operation,args,host);}finally{depth--;}}
const operations={
  truthy:value=>!!value,list:(...values)=>values,
  collides:(field,globalLongOptionFlags)=>globalLongOptionFlags.has(field.optionFlag),
  optionFlags:formatOptionFlags,
  shortFlags:field=>`-${field.shortFlag}, ${field.optionFlag}`,
  groups:(first,field)=>[first,...field.longAliases],
  flatMap:(flagGroups,field,collidesWithGlobalFlag)=>flagGroups.flatMap((flags,index)=>invoke("group",[flags,index,field,collidesWithGlobalFlag])),
  newOption:(flags,description)=>new Option(flags,description),
  hasAliases:field=>field.longAliases.length>0,
  setAttribute:(option,field)=>{option.attributeName=()=>field.commanderOptionAttribute;},
  valueFlags:(flags,suffix)=>`${flags} ${suffix}`,
  preset:mainOption=>mainOption.preset(true),
  booleanParser:mainOption=>mainOption.argParser(value=>typeof value==="boolean"?value:value),
  arrayParser:option=>option.argParser((value,previous=[])=>[...previous,value]),
  zero:index=>index===0,
  negativeFlags:field=>`--no-${field.optionFlag.slice(2)}`,
  invalidOperation(){throw new TypeError("Invalid CLI option operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function createOption(field,globalLongOptionFlags){return invoke("create",[field,globalLongOptionFlags]);}
export function createCommanderOption(flags,description,field){return invoke("commander",[flags,description,field]);}
