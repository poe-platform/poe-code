import {createRequire} from "node:module";
import {ToolcraftBugError} from "./index.js";
import {callNative,protect} from "./host-errors.js";

const native=createRequire(import.meta.url)("./toolcraft-rust.node");
const BUILT_IN_OUTPUT_FORMATS=["rich","md","markdown","json"];
let depth=0;
function invoke(operation,args){
  if(depth>=128)throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try{return callNative(native.cliPolicy,operation,args,host);}
  finally{depth--;}
}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,zero:()=>0,
  list:(...values)=>values,object:()=>({}),
  pushWord:(words,word)=>words.push(word),pushFlag:(flags,flag)=>flags.push(flag),
  pushOption:(options,option)=>options.push(option),
  boolean:value=>value===true,truthy:value=>!!value,
  isObject:value=>typeof value==="object",isFunction:value=>typeof value==="function",
  moreCharacters:(value,index)=>index<value.length,
  character:(value,index)=>value[index]??"",
  previous:(value,index)=>value[index-1],next:(value,index)=>value[index+1],
  charLower:char=>char.toLowerCase(),charUpper:char=>char.toUpperCase(),
  previousLower:previous=>previous.toLowerCase(),previousUpper:previous=>previous.toUpperCase(),
  nextLower:next=>next.toLowerCase(),nextUpper:next=>next.toUpperCase(),
  currentNonempty:current=>current.length>0,currentLower:current=>current.toLowerCase(),
  append:(current,char)=>current+char,increment:index=>index+1,
  joinWords:(words,separator)=>words.join(separator),
  camelWords:words=>words.map((word,index)=>index===0?word:`${word[0]?.toUpperCase()??""}${word.slice(1)}`).join(""),
  optionalOutput:controls=>controls?.output,optionalDebug:controls=>controls?.debug,
  optionalHelp:controls=>controls?.help,optionalLogLevel:controls=>controls?.logLevel,
  optionalVerbose:controls=>controls?.verbose,optionalYes:controls=>controls?.yes,
  controlFormats:controls=>controls.output.formats??{},
  controls:(debug,help,logLevel,output,outputFormats,verbose,yes)=>({debug,help,logLevel,output,outputFormats,verbose,yes}),
  validateFormats(formats){for(const [name,renderer] of Object.entries(formats))invoke("validateFormat",[name,renderer]);},
  hasWhitespace:name=>name.split("").some(character=>invoke("whitespace",[character])),
  characterWhitespace:character=>character.trim()==="",
  emptyName:name=>name.length===0,trimName:name=>name.trim(),
  builtInIncludes:name=>BUILT_IN_OUTPUT_FORMATS.includes(name),
  invalidFormatName(name){throw new ToolcraftBugError(`Custom output format names must be non-empty and contain no whitespace: ${JSON.stringify(name)}.`);},
  builtInFormat(name){throw new ToolcraftBugError(`Custom output format "${name}" conflicts with a built-in format.`);},
  invalidRenderer(name){throw new ToolcraftBugError(`Custom output format "${name}" must define a renderer function.`);},
  set:flags=>new Set(flags),
  outputFormatNames,
  logLevels:()=>[...LOG_LEVELS],
  option:(name,flags,type,hidden,description)=>({name,flags,type,required:false,hidden,description}),
  optionChoices:(name,flags,type,hidden,description,choices)=>({name,flags,type,required:false,hidden,description,choices}),
  invalidOperation(){throw new TypeError("Invalid CLI policy operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
const LOG_LEVELS=Object.freeze(invoke("logLevels",[]));

export function formatCLIName(segment,casing){return invoke("name",[segment,casing]);}
export function formatMCPName(segment,casing){return invoke("mcpName",[segment,casing]);}
export function outputFormatNames(controls){return [...BUILT_IN_OUTPUT_FORMATS,...Object.keys(controls.outputFormats)];}
export function resolveCLIControls(controls){return invoke("controls",[controls]);}
export function getGlobalLongOptionFlags(presetsEnabled,versionEnabled,controls){return invoke("flags",[presetsEnabled,versionEnabled,controls]);}
export function createGlobalSnapshotOptions(presetsEnabled,versionEnabled,controls){return invoke("snapshotOptions",[presetsEnabled,versionEnabled,controls]);}
