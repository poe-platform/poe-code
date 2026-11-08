import {createRequire} from "node:module";
import {Command as CommanderCommand,Option,InvalidArgumentError} from "commander";
import {suggest} from "./index.js";
import {describeReceived} from "./cli-values.js";
import {collectFields,assignPositionals,validateUniqueOptionFlags} from "./cli-fields.js";
import {createOption} from "./cli-options.js";
import {unwrapOptional,normalizeNumericArrayOptions,isNegativeNumericToken} from "./cli-argv.js";
import {isNodeVisibleInScope} from "./cli-snapshot.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
const LOG_LEVELS=Object.freeze(["silent","error","warn","info","debug","trace"]);
const BUILT_IN_OUTPUT_FORMATS=["rich","md","markdown","json"];
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliCommandsPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,null:()=>null,true:()=>true,truthy:value=>!!value,list:()=>[],set:()=>new Set(),two:()=>2,increment:suffix=>suffix+1,
  path:(pathSegments,node)=>[...pathSegments,node.name],scope:node=>node.scope.includes("cli"),visible:node=>isNodeVisibleInScope(node,"cli"),
  command:node=>new CommanderCommand(node.name),
  state:(node,casing,globals,execute,presets,controls,loaders,path,command)=>({node,casing,globals,execute,presets,controls,loaders,path,command,unknownArgv:[],loadedFields:undefined}),
  hidden:(command,node)=>Reflect.set(command,"_toolcraftHidden",node.hidden),original:(command,node)=>Reflect.set(command,"_toolcraftOriginalName",node.name),
  description:(command,node)=>command.description(node.description),aliases:(command,node)=>node.aliases.forEach(alias=>command.alias(alias)),
  noHelp:command=>command.addHelpCommand(false),excess:command=>command.allowExcessArguments(true),
  loader:state=>state.loaders.set(state.command,()=>invoke("load",[state])),
  collect:state=>collectFields(state.node.params,state.casing,state.globals),assign:(collected,node)=>assignPositionals(collected.fields,node.positional),validate:validateUniqueOptionFlags,
  hasDynamic:collected=>collected.dynamicFields.length>0,unknown:command=>command.allowUnknownOption(true),
  fields(state,fields,numeric){for(const field of fields)invoke("field",[state,field,numeric]);},
  argument:(command,field)=>command.argument(invoke("positional",[field])),
  variadic:field=>`[${field.displayPath}...]`,positional:field=>`[${field.displayPath}]`,
  options(state,field,numeric){for(const option of createOption(field,state.globals)){state.command.addOption(option);invoke("numeric",[field,numeric,option]);}},
  unwrap:field=>unwrapOptional(field.schema.item),addNumeric:(numericArrayOptions,option)=>numericArrayOptions.add(option),
  parser(state,numericArrayOptions){const command=state.command;const parseOptions=command.parseOptions.bind(command);command.parseOptions=argv=>invoke("parsed",[state,parseOptions(normalizeNumericArrayOptions(argv,command.options,numericArrayOptions))]);},
  firstUnknown:parsed=>parsed.unknown.findIndex(token=>token.length>1&&token.startsWith("-")&&!isNegativeNumericToken(token)),
  negative:firstUnknownOption=>firstUnknownOption<0,unknownLength:parsed=>parsed.unknown.length,
  operands:(parsed,operandCount)=>parsed.operands.push(...parsed.unknown.splice(0,operandCount)),
  first:parsed=>parsed.unknown[0],tail:parsed=>parsed.operands.push(...parsed.unknown.slice(1)),clear:parsed=>{parsed.unknown.length=0;},
  keepUnknown:(state,parsed)=>{state.unknownArgv=parsed.unknown;},
  action(state,collected,fields){state.command.action(async(...args)=>{const actionCommand=args[args.length-1];const positionalValues=actionCommand.args.slice(0,actionCommand.args.length-state.unknownArgv.length);const execute=state.execute;await execute({command:state.node,commandPath:state.path.join("."),declarationPath:state.path,casing:state.casing,dynamicFields:collected.dynamicFields,fields,positionalValues,presetsEnabled:state.presets,rawArgv:state.unknownArgv,actionCommand,variants:collected.variants});});},
  loaded:(state,collected)=>{state.loadedFields=collected.dynamicFields;return state.loadedFields;},
  reserved:node=>node.children.filter(child=>!isNodeVisibleInScope(child,"cli")).flatMap(child=>invoke("names",[child])),
  children:(node,casing,globals,execute,presets,controls,loaders,path)=>node.children.map(child=>invoke("create",[child,casing,globals,execute,presets,controls,loaders,path])).filter(child=>child!==null),
  reserve:(group,reservedChildNames)=>Reflect.set(group,"_toolcraftReservedChildNames",reservedChildNames),
  childNames:visibleChildren=>new Set(visibleChildren.map(child=>child.name())),
  childrenEach(node,group,visibleChildren,childNames){for(const child of visibleChildren)invoke("child",[node,group,child,childNames]);},
  defaultScope:node=>node.default.scope.includes("cli"),defaultName:(child,node)=>child.name()===node.default.name,defaultAlias:(child,node)=>child.aliases().includes(node.default.name),
  emptyName:child=>child.name().length===0,hiddenCommander:command=>Reflect.get(command,"_toolcraftHidden")===true,
  hasName:(siblingNames,internalName)=>siblingNames.has(internalName),internalName:suffix=>`__toolcraft_default_${suffix}`,rename:(child,internalName)=>child.name(internalName),
  hiddenNames:(parent,child)=>Reflect.set(parent,"_toolcraftHiddenDefaultNames",invoke("hiddenNames",[parent]).concat([...new Set([Reflect.get(child,"_toolcraftOriginalName"),...child.aliases()].filter(name=>typeof name==="string"&&name.length>0))])),
  addHidden:(parent,child)=>parent.addCommand(child,{hidden:true,isDefault:true}),
  defaultOptions:()=>({isDefault:true}),emptyOptions:()=>({}),
  hiddenOptions:options=>({...options,hidden:true}),
  add:(parent,child,options)=>parent.addCommand(child,Object.keys(options).length>0?options:undefined),
  reflected:(command,key)=>Reflect.get(command,key),isArray:value=>Array.isArray(value),strings:value=>value.filter(item=>typeof item==="string"),
  names:node=>[node.name,...node.aliases].filter(name=>name.length>0),
  presetOption:options=>options.push(new Option("--preset <path>","Load parameter defaults from a JSON file.")),
  yesOption:options=>options.push(new Option("--yes","Accept defaults and skip prompts.")),
  formats:controls=>[...BUILT_IN_OUTPUT_FORMATS,...Object.keys(controls.outputFormats)],
  outputOption:(options,choices,controls)=>options.push(new Option("--output <format>","Output format.").choices(choices).argParser(value=>invoke("output",[value,controls,choices]))),
  debugOption:options=>options.push(new Option("--debug [mode]","Print stack traces for unexpected errors.").preset("trim").argParser(parseDebugStackMode)),
  logOption:options=>options.push(new Option("--log-level <level>","Set runtime diagnostic log level.").argParser(parseLogLevel)),
  verboseOption:options=>options.push(new Option("--verbose","Print detailed runtime diagnostics.")),
  install(command,options){for(const option of options){option.hideHelp(true);command.addOption(option);}},
  hasFormat:(controls,value)=>Object.hasOwn(controls.outputFormats,value),
  invalidOutput(value,controls,choices){throw new InvalidArgumentError(invoke("enumMessage",["--output",value,choices,{candidates:["rich","markdown","json",...Object.keys(controls.outputFormats)],threshold:3}]));},
  invalidDebug(value){throw new InvalidArgumentError(invoke("enumMessage",["--debug",String(value),["raw"],{candidates:["raw"]}]));},
  validLevel:value=>LOG_LEVELS.includes(value),
  invalidLevel(value){throw new InvalidArgumentError(invoke("enumMessage",["--log-level",value,[...LOG_LEVELS],{candidates:["warn","debug","trace"],threshold:3}]));},
  suggestions:(value,values,opts)=>suggest(value,opts.candidates??values.map(candidate=>String(candidate)),opts),
  hasSuggestions:suggestions=>suggestions.length>0,suggestionLine:suggestions=>` Did you mean: ${suggestions.join(", ")}?\n`,
  enumMessage:(label,value,values,suggestionLine)=>`Invalid value for "${label}".${suggestionLine}Expected one of: ${values.map(candidate=>String(candidate)).join(", ")}, got ${describeReceived(value)}.`,
  invalidOperation(){throw new TypeError("Invalid CLI command-construction operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function createNodeCommand(node,casing,globalLongOptionFlags,execute,presetsEnabled,controls,fieldLoaders,pathSegments=[]){return invoke("create",[node,casing,globalLongOptionFlags,execute,presetsEnabled,controls,fieldLoaders,pathSegments]);}
export function addCommanderChild(parent,child,isDefault,siblingNames){return invoke("add",[parent,child,isDefault,siblingNames]);}
export function isToolcraftHiddenCommander(command){return invoke("hidden",[command]);}
export function getToolcraftHiddenDefaultNames(command){return invoke("hiddenNames",[command]);}
export function getToolcraftReservedChildNames(command){return invoke("reservedNames",[command]);}
export function getNodeCommandNames(node){return invoke("names",[node]);}
export function addGlobalOptions(command,presetsEnabled,controls){return invoke("globals",[command,presetsEnabled,controls]);}
export function parseDebugStackMode(value){return invoke("debug",[value]);}
export function parseLogLevel(value){return invoke("logLevel",[value]);}
export function formatInvalidEnumMessage(label,value,values,opts={}){return invoke("enumMessage",[label,value,values,opts]);}
