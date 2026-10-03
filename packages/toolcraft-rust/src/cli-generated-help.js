import {createRequire} from "node:module";
import path from "node:path";
import {text,formatCommandList,formatOptionList,helpFormatterPlain,renderHelpTokens,withOutputFormat} from "toolcraft-design-rust";
import {UserError,suggest} from "./index.js";
import {collectFields,assignPositionals} from "./cli-fields.js";
import {formatHelpFieldFlags,formatHelpFieldDescription,formatCommandParameterFieldFlags,formatDynamicHelpFields,formatCLIEnumChoices,formatJsonHelpSchemaType,tokenizeHelpFlags} from "./cli-help-fields.js";
import {resolveCLIControls,getGlobalLongOptionFlags,outputFormatNames} from "./cli-policy.js";
import {isNodeVisibleInScope} from "./cli-snapshot.js";
import {toDesignSystemOutput} from "./cli-argv.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliGeneratedHelpPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,zero:()=>0,list:(...values)=>values,object:()=>({}),truthy:value=>!!value,
  nonempty:value=>value.length>0,empty:value=>value.length===0,isString:value=>typeof value==="string",isBoolean:value=>typeof value==="boolean",
  next:index=>index+1,more:(list,index)=>index<list.length,at:(list,index)=>list[index],token:(argv,index)=>argv[index]??"",
  startsOutput:token=>token.startsWith("--output="),outputValue:token=>token.slice("--output=".length),startsFlag:token=>token.startsWith("-"),
  visible:(group,scope)=>group.children.filter(child=>isNodeVisibleInScope(child,scope)),
  helpChildren:(group,scope)=>operations.visible(group,scope).filter(child=>invoke("helpChild",[child])),
  findChild:(group,token,scope)=>operations.visible(group,scope).find(child=>child.name===token||child.aliases.includes(token)),
  target(root,argv,scope,usage,display){const breadcrumb=[display??root.name];let current=root;for(const token of argv.slice(2)){const step=invoke("targetToken",[current,token,scope,usage,breadcrumb]);if(step.done)break;breadcrumb.push(step.value.name);current=step.value;}return {breadcrumb,node:current};},
  stop:()=>({done:true}),child:value=>({done:false,value}),
  suggestions:(group,input,scope)=>suggest(input,operations.helpChildren(group,scope).map(child=>child.name)),
  commandPath:breadcrumb=>breadcrumb.slice(1).join(" "),helpTarget:(usage,commandPath)=>`${usage} ${commandPath}`,
  unknown:(input,suggestions,target)=>`Unknown command "${input}".${invoke("suggestions",[suggestions])}\nRun ${target} --help for usage.`,
  suggestionsText:suggestions=>`\nDid you mean: ${suggestions.join(", ")}?`,
  userError(message){throw new UserError(message);},
  row:(flags,description)=>({flags,flagTokens:tokenizeHelpFlags(flags),description}),
  secretRows:secrets=>Object.values(secrets).map(secret=>operations.row(secret.env,invoke("secretDescription",[secret]))),
  includesSpace:value=>value.includes(" "),json:value=>JSON.stringify(value),
  exampleFlags:params=>Object.entries(params).map(([key,value])=>invoke("exampleFlag",[key,value])),
  flag:key=>`--${key}`,negativeFlag:key=>`--no-${key}`,flagValue:(flag,value)=>`${flag} ${value}`,
  exampleCommand:(command,flags)=>[command,...flags].filter(token=>token.length>0).join(" "),
  exampleRows:(examples,breadcrumb,usage)=>examples.map(example=>`${example.title}\n  ${invoke("exampleCommand",[breadcrumb,usage,example.params])}`),
  tokenize:tokenizeHelpFlags,wrap:tokens=>[{text:"[",role:"dim"},...tokens,{text:"]",role:"dim"}],
  bracket:value=>`[${value}]`,parameterToken:(text,optional,tokens)=>({text,optional,tokens}),
  dynamicTokens:(field,casing,optional)=>formatDynamicHelpFields(field,casing).map(row=>invoke("parameterToken",[row.flags,optional])),
  collect:collectFields,assign:assignPositionals,
  parameterFields:(fields,globals)=>fields.filter(field=>field.global!==true).map(field=>invoke("fieldParameter",[field,globals])),
  dynamicParameters:(collected,casing)=>collected.dynamicFields.flatMap(field=>invoke("dynamicTokens",[field,casing])),
  concat:(left,right)=>left.concat(right),parameterFlags:formatCommandParameterFieldFlags,
  optionalCount:tokens=>tokens.filter(token=>token.optional).length,
  inlineWidth:tokens=>tokens.reduce((total,token)=>total+token.text.length+1,0),zeroValue:value=>value===0,
  countFits:count=>count<=8,widthFits:(width,budget)=>width<=budget,
  requiredParameters:tokens=>tokens.filter(token=>!token.optional),collapsedText:count=>`+${count} options`,
  collapsed:(required,value)=>[...required,{text:`[${value}]`,optional:true,tokens:[{text:"[",role:"dim"},{text:value,role:"dim"},{text:"]",role:"dim"}]}],
  aliasName:node=>`${node.name} (${node.aliases.join(", ")})`,nameTokens:name=>[{text:name,role:"command"}],
  inlineBudget:name=>Math.max(0,(process.stdout.columns??100)-2-name.length),
  appendTokens(tokens,parameters){for(const parameter of parameters)tokens.push({text:" ",role:"literal"},...parameter.tokens);},
  parameterName:(name,parameters)=>`${name} ${parameters.map(token=>token.text).join(" ")}`,
  nameResult:(name,nameTokens)=>({name,nameTokens}),
  normalizeDescription:value=>{let normalized="";for(const character of value.trim().toLowerCase())normalized=invoke("normalizeCharacter",[normalized,character]);return normalized;},
  append:(text,character)=>text+character,
  description:node=>node.description??"",
  rowResult:(name,nameTokens,description,kind,depth)=>({name,nameTokens,description,kind,depth}),
  conciseRows:(group,scope,casing,globals)=>operations.helpChildren(group,scope).map(child=>invoke("commandRow",[child,casing,globals,0])),
  visitRows(group,scope,casing,globals,rows,depth){for(const child of operations.helpChildren(group,scope)){rows.push(invoke("commandRow",[child,casing,globals,depth]));invoke("visitGroup",[child,scope,casing,globals,rows,depth]);}},
  push:(list,value)=>list.push(value),globalOutput:controls=>`--output <${outputFormatNames(controls).join("|")}>`,
  globalLine:flags=>`${text.section("Global Options:")} ${flags.join("  ")}`,leafGlobals:()=>`${text.section("Global Options:")} -v, --verbose`,
  seen:()=>new Map(),has:(seen,key)=>seen.has(key),values:seen=>[...seen.values()],dedupeKey:field=>`${field.optionFlag}|${field.shortFlag??""}`,
  globalFields(fields,globals,seen){for(const field of fields)invoke("globalField",[field,globals,seen]);},
  globalChildren(node,scope,casing,globals,seen){for(const child of operations.helpChildren(node,scope))invoke("globalVisit",[child,scope,casing,globals,seen]);},
  saveGlobal:(seen,key,field,globals)=>seen.set(key,operations.row(formatHelpFieldFlags(field,globals),formatHelpFieldDescription(field))),
  sections:sections=>sections.filter(section=>section.length>0).join("\n\n"),tty:()=>process.stdout.isTTY===true,
  plainCommands:rows=>helpFormatterPlain.formatCommandList(rows),richCommands:formatCommandList,plainOptions:rows=>helpFormatterPlain.formatOptionList(rows),richOptions:formatOptionList,
  sortFields(fields){const required=[],optional=[];for(const field of fields)invoke("sortField",[field,required,optional]);return [...required,...optional];},
  usageVisible:breadcrumb=>breadcrumb.filter(segment=>segment.length>0),first:values=>values[0],prepend:(usage,visible)=>[usage,...visible],
  usage:(usage,breadcrumb,suffix)=>[usage,breadcrumb.slice(1).join(" "),suffix].filter(segment=>segment.length>0).join(" "),
  includes:(values,value)=>values.includes(value),infinity:()=>Number.POSITIVE_INFINITY,
  groupSuffix:parameters=>["[command]","[OPTIONS]",...parameters.map(token=>token.text)].join(" "),
  footer:usage=>text.muted(`Run ${usage} <command> --help for full options.`),
  usageParts:usage=>usage.split(" ").filter(part=>part.length>0),
  commandEnd:parts=>parts.findIndex(part=>part.startsWith("-")||part.startsWith("[")||part.startsWith("<")),
  minusOne:value=>value===-1,slice:(values,start,end)=>values.slice(start,end),tail:(values,start)=>values.slice(start),join:parts=>parts.join(" "),
  styleUsage:usage=>text.usageCommand(usage),styledUsage:(command,args)=>`${text.usageCommand(command)} ${renderHelpTokens(args.flatMap((part,index)=>[...(index===0?[]:[{text:" ",role:"literal"}]),...tokenizeHelpFlags(part)]))}`,
  globalFlags:getGlobalLongOptionFlags,section:(label,rows)=>`${text.section(label)}\n${invoke("optionList",[rows])}`,
  commandSection:rows=>`${text.section("Commands:")}\n${invoke("commandList",[rows])}`,
  globalSection:(rows,line)=>`${text.section("Options:")}\n${invoke("optionList",[rows])}\n${line}`,
  localFields:fields=>fields.filter(field=>field.global!==true),positionals:fields=>fields.filter(field=>field.positionalIndex!==undefined),options:fields=>fields.filter(field=>field.positionalIndex===undefined),
  fieldRows:(fields,globals)=>fields.map(field=>operations.row(formatHelpFieldFlags(field,globals),formatHelpFieldDescription(field))),
  dynamicRows:(collected,casing)=>collected.dynamicFields.flatMap(field=>formatDynamicHelpFields(field,casing)),
  exampleSection:rows=>`${text.section("Examples:")}\n${rows.join("\n")}`,
  positionalText:(field,open,close)=>`${open}${field.displayPath}${close}`,usagePositionals:fields=>`[OPTIONS] ${fields.map(field=>invoke("positional",[field])).join(" ")}`,
  auth:node=>node.requires?.auth===true,
  documentInput:(breadcrumb,rootUsageName,usageLine,description,requiresAuth,sections)=>({breadcrumb,rootUsageName,usageLine,description,requiresAuth,sections}),
  title:input=>input.breadcrumb.filter(segment=>segment.length>0).join(" ")||input.rootUsageName,
  documentDescription:input=>input.description??"",sentenceEnd:description=>description.indexOf(". "),
  headingDescription:(description,index)=>description.slice(0,index+1),remainingDescription:(description,index)=>description.slice(index+2),
  heading:(title,description)=>`${title} — ${description}`,headingLines:heading=>[text.heading(heading),""],
  descriptionLines:(lines,remaining)=>lines.push(remaining,""),usageLines:(lines,usage)=>lines.push(`Usage: ${invoke("styledUsage",[usage])}`,""),
  endDocument:lines=>`${lines.join("\n").trimEnd()}\n`,
  jsonDescription:node=>node.description===undefined?{}:{description:node.description},
  jsonPath:target=>target.breadcrumb.filter(segment=>segment.length>0),jsonName:(target,usage)=>target.breadcrumb.at(-1)??usage,
  jsonCommands:rows=>rows.map(row=>({name:row.name,description:row.description,kind:row.kind,depth:row.depth})),
  jsonGlobals:rows=>rows.map(row=>({name:invoke("jsonGlobalName",[row.flags]),flags:row.flags.split(", "),type:"unknown",description:row.description,required:false})),
  globalName:flags=>flags.split(/[ ,]+/)[0]?.replace(/^--/,"")??flags,
  jsonGroup:(name,path,usage,description,commands,options)=>JSON.stringify({schemaVersion:1,kind:"group",name,path,usage,...description,commands,options},null,2)+"\n",
  jsonLeaf:(node,name,path,usage,description,fields,globals)=>JSON.stringify({schemaVersion:1,kind:"command",name,path,usage,...description,options:fields.filter(field=>field.global!==true).map(field=>invoke("jsonOption",[field,globals])),secrets:Object.entries(node.secrets).map(([name,secret])=>({name,env:secret.env,required:secret.optional!==true,...(secret.description===undefined?{}:{description:secret.description})})),examples:node.examples},null,2)+"\n",
  jsonFlags:(field,globals)=>formatHelpFieldFlags(field,globals).split(", "),schemaType:formatJsonHelpSchemaType,choices:field=>({choices:formatCLIEnumChoices(field.schema)}),
  fieldDescription:field=>({description:field.description}),defaultValue:field=>({default:field.defaultValue}),positional:()=>({positional:true}),
  jsonOption:(name,flags,type,choices,description,required,defaults,positional)=>({name,flags,type,...choices,...description,required,...defaults,...positional}),
  init:(root,argv,options,invocation)=>({root,argv,options,invocation}),keep:(state,key,value)=>{state[key]=value;},
  writer:invocation=>invocation?.write??(chunk=>{process.stdout.write(chunk);}),
  entrypoint:argv=>argv[1],parsePath:entry=>path.parse(entry),
  controls:resolveCLIControls,globalOptions:state=>({controls:state.controls,showVersion:state.options.version!==undefined,presetsEnabled:state.options.presets===true}),
  designOutput:state=>toDesignSystemOutput(state.output),write:(state,rendered)=>{const write=state.write;write(rendered);},
  invalidOperation(){throw new TypeError("Invalid generated CLI help operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function resolveHelpOutput(argv){return invoke("output",[argv]);}
export function resolveHelpTarget(root,argv,scope,rootUsageName,rootDisplayName){return invoke("target",[root,argv,scope,rootUsageName,rootDisplayName]);}
export function formatCommandRows(group,scope,casing,globals,help){return invoke("commandRows",[group,scope,casing,globals,help]);}
export function renderGroupHelp(group,breadcrumb,scope,casing,globals,usage,isRoot){return invoke("group",[group,breadcrumb,scope,casing,globals,usage,isRoot]);}
export function renderLeafHelp(command,breadcrumb,casing,globals,usage){return invoke("leaf",[command,breadcrumb,casing,globals,usage]);}
export function renderJsonHelp(target,root,casing,globals,usage){return invoke("jsonHelp",[target,root,casing,globals,usage]);}
export async function renderGeneratedHelp(root,argv,options,invocation){
  const state=invoke("initialize",[root,argv,options,invocation]);
  if(invoke("json",[state])){invoke("writeJson",[state]);return;}
  await withOutputFormat(invoke("designOutput",[state]),async()=>{invoke("writeDocument",[state]);});
}
