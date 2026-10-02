import {createRequire} from "node:module";
import {isUserError} from "./index.js";
import {resolveDynamicOption} from "./cli-dynamic-paths.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
const HELP_FLAGS=new Set(["--help","-h"]);
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliPreparePolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,truthy:value=>!!value,list:()=>[],two:()=>2,one:()=>1,minusOne:()=>-1,
  increment:index=>index+1,decrement:index=>index-1,
  prefix:argv=>argv.slice(0,2),more:(index,argv)=>index<argv.length,at:(argv,index)=>argv[index],next:(argv,index)=>argv[index+1],
  tail:(normalized,argv,index)=>normalized.push(...argv.slice(index)),push:(normalized,token)=>normalized.push(token),pathPush:(path,token)=>path.push(token),
  help:token=>HELP_FLAGS.has(token),copy:path=>[...path],verbose:controls=>controls.verbose,output:controls=>controls.output,
  load:(fieldLoaders,current)=>fieldLoaders.get(current)?.()??[],
  long:token=>token.startsWith("--"),hyphen:token=>token.startsWith("-"),cluster:token=>token.length>2,
  equals:token=>token.indexOf("="),unattached:equalsIndex=>equalsIndex<0,attached:equalsIndex=>equalsIndex>=0,
  flag:(token,equalsIndex)=>token.slice(0,equalsIndex),
  option:(current,flag)=>current.options.find(candidate=>candidate.long===flag||candidate.short===flag),
  clusterMore:(offset,token)=>offset<token.length,clusterOption:(current,token,offset)=>current.options.find(entry=>entry.short===`-${token[offset]}`),
  clusterAttached:(offset,token)=>offset<token.length-1,
  required:option=>option.required,optional:option=>option.optional,
  outputValue:(token,equalsIndex)=>token.slice(equalsIndex+1),nextMulti:next=>next.length>1,nextHyphen:next=>next.startsWith("-"),
  child:(current,token)=>current.commands.find(command=>command.name()===token||command.aliases().includes(token)),
  defaultName:candidate=>candidate._defaultCommandName,defaultString:candidate=>typeof candidate._defaultCommandName==="string",
  defaultCommand:(current,defaultName)=>current.commands.find(command=>command.name()===defaultName),
  negated:token=>token.startsWith("--no-"),negatedFlag:token=>token.slice(5),dynamicFlag:token=>token.slice(2),
  resolve(dynamicFields,normalizedFlag,casing){try{return {ok:true,value:resolveDynamicOption(dynamicFields,normalizedFlag,casing)};}catch(error){return {ok:false,error};}},
  userError:isUserError,raise(error){throw error;},
  kind:dynamic=>dynamic.leaf.schema.kind,
  pushAttached:(normalized,token,next)=>normalized.push(`${token}=${next}`),
  hasCommands:current=>current.commands.length>0,
  result:normalized=>({argv:normalized}),
  helpResult:(normalized,argv,helpPath,output)=>({argv:normalized,helpArgv:[...argv.slice(0,2),...helpPath,...(output===undefined?[]:["--output",output])]}),
  invalidOperation(){throw new TypeError("Invalid CLI preparation operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function prepareCliArguments(program,argv,fieldLoaders,casing,controls){return invoke("prepare",[program,argv,fieldLoaders,casing,controls]);}
export function getDefaultCommanderCommandName(command){return invoke("defaultName",[command]);}
