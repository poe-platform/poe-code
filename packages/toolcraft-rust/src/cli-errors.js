import {createRequire} from "node:module";
import {CommanderError} from "commander";
import {createLogger,text,withOutputFormat} from "toolcraft-design-rust";
import {isUserError,suggest} from "./index.js";
import {isHttpErrorLike,summarizeHttpError} from "./api-error-summary.js";
import {redactHttpBody,redactHttpHeaderValue} from "./redaction.js";
import {formatDebugStack} from "./stack-trim.js";
import {toDesignSystemOutput} from "./cli-argv.js";
import {getToolcraftHiddenDefaultNames,getToolcraftReservedChildNames,isToolcraftHiddenCommander} from "./cli-commands.js";
import {getDefaultCommanderCommandName} from "./cli-prepare.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliErrorsPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,truthy:value=>!!value,list:(...values)=>values,zero:()=>0,next:index=>index+1,
  isError:value=>value instanceof Error,isCommander:value=>value instanceof CommanderError,isUserError,isHttpErrorLike,
  logger:createLogger,log:(logger,message)=>logger.error(message),exit:value=>{process.exitCode=value;},failed:()=>{process.exitCode=1;},
  stderr:value=>process.stderr.write(`${value}\n`),stack:formatDebugStack,
  append:(prefix,hint)=>prefix+hint,
  definitionMessage:pattern=>`Command definition error: ${pattern.error.message}\nThis is a bug in the generated command definition, not in your command arguments.`,
  bugMessage:pattern=>`toolcraft hit an internal invariant: ${pattern.error.message}\nThis is a bug in toolcraft or in the command definition; it cannot be worked around by changing argv.`,
  unexpectedMessage:pattern=>`${pattern.message} Use --debug for a stack trace.`,
  patternUsage:pattern=>invoke("usagePointer",[pattern.message,{rootUsageName:pattern.rootUsageName,commandPath:pattern.commandPath}]),
  definitionPattern:(error,options)=>({kind:"definition",error,debugControlEnabled:options.debugControlEnabled,debugStackMode:options.debugStackMode}),
  usagePattern:(error,options)=>({kind:"usage",message:error.message,rootUsageName:options.rootUsageName,commandPath:options.commandPath}),
  runtimePattern:error=>({kind:"runtime-user",message:error.message}),
  bugPattern:(error,options)=>({kind:"toolcraft-bug",error,debugControlEnabled:options.debugControlEnabled,debugStackMode:options.debugStackMode}),
  unexpectedPattern:(message,stack,options)=>({kind:"unexpected",message,stack,debugControlEnabled:options.debugControlEnabled,debugStackMode:options.debugStackMode}),
  string:value=>String(value),argv:options=>options.argv??process.argv,
  unknownCommandUsage:(error,options)=>invoke("usagePointer",[invoke("unknownCommand",[error,options.program,options.argv??process.argv]),{rootUsageName:options.rootUsageName,commandPath:options.commandPath}]),
  optionUsage:(message,options,argv)=>invoke("usagePointer",[message,{rootUsageName:options.rootUsageName,commandPath:invoke("errorPath",[options,argv])}]),
  otherUsage:(message,options)=>invoke("usagePointer",[message,{rootUsageName:options.rootUsageName,commandPath:invoke("otherErrorPath",[options])}]),
  helpIncluded:message=>message.includes("--help"),empty:value=>value.length===0,nonempty:value=>value.length>0,
  usageTarget:options=>`${options.rootUsageName} ${options.commandPath}`,usageMessage:(message,target)=>`${message}\nRun ${target} --help for usage.`,
  errorPrefix:error=>error.message.startsWith("error:"),commanderMessage:error=>`error: ${error.message}`,
  cliPath:path=>path.split(".").filter(segment=>segment.length>0).join(" "),
  commandNames:command=>command.commands.map(child=>child.name()),optionNames:command=>command.options.map(option=>option.long).filter(flag=>flag!==undefined),suggest,
  unknownCommandMessage:input=>`Unknown command "${input}".`,unknownOptionMessage:input=>`Unknown option "${input}".`,
  suggestionMessage:(message,suggestions)=>`${message}\nDid you mean: ${suggestions.join(", ")}?`,
  quoteIndex:(message,quote)=>message.indexOf(quote),quoteEnd:(message,quote,start)=>message.indexOf(quote,start+1),minusOne:value=>value===-1,quoteSlice:(message,start,end)=>message.slice(start+1,end),
  tail:argv=>argv.slice(2),more:(tokens,index)=>index<tokens.length,at:(tokens,index)=>tokens[index],hyphen:token=>token.startsWith("-"),attached:token=>token.includes("="),
  option:(current,token)=>current.options.find(candidate=>candidate.long===token||candidate.short===token),required:option=>option?.required===true,
  child:(current,token)=>current.commands.find(command=>command.name()===token||command.aliases().includes(token)),
  name:command=>command.name(),push:(list,value)=>list.push(value),joinPath:path=>path.join(" "),
  hiddenIncludes:(current,token)=>getToolcraftHiddenDefaultNames(current).includes(token),reservedIncludes:(current,token)=>getToolcraftReservedChildNames(current).includes(token),
  unknown:(input,currentCommand,path)=>({input,currentCommand,commandPath:path.join(" ")}),defaultName:getDefaultCommanderCommandName,
  somePublic:(command,defaultName)=>command.commands.some(child=>invoke("publicChild",[child,command,defaultName])),hidden:isToolcraftHiddenCommander,
  bareCharacters(token){for(const character of token){if(!invoke("nameCharacter",[character]))return false;}return true;},
  code:character=>character.codePointAt(0),lower:code=>code>=97&&code<=122,upper:code=>code>=65&&code<=90,digit:code=>code>=48&&code<=57,
  exitOverride:command=>command.exitOverride(),positionalOptions:command=>command.enablePositionalOptions(),noHelp:command=>command.helpOption(false),
  versionOption:command=>command.options.some(option=>option.long==="--version"),version:(command,version)=>command.version(version,"--version"),
  configureOutput:command=>command.configureOutput({outputError:()=>{}}),configureChildren:(command,version)=>command.commands.forEach(child=>invoke("configure",[child,version])),
  object:value=>typeof value==="object"&&value!==null&&!Array.isArray(value),own:(value,key)=>Object.prototype.hasOwnProperty.call(value,key),member:(value,key)=>value[key],
  type:(value,type)=>typeof value===type,isString:value=>typeof value==="string",isArray:Array.isArray,nonblank:value=>value.trim().length>0,
  graphErrors:body=>body.errors.every(error=>invoke("graphError",[error])),graphPath:path=>path.every(entry=>typeof entry==="string"||typeof entry==="number"),
  graphBodies:body=>body.errors.map(error=>invoke("graphBody",[error])).join("\n\n"),
  graphMessage:error=>`GraphQL error: ${error.message}`,graphPathLine:error=>`  at path: ${error.path.join(".")}`,graphCodeLine:error=>`  code:    ${error.extensions.code}`,
  problemTitle:body=>`Problem: ${body.title}`,problemDetail:body=>`Detail:  ${body.detail}`,problemType:body=>`Type:    ${body.type}`,problemInstance:body=>`Instance: ${body.instance}`,problemStatus:body=>`Status:  ${body.status}`,
  lines:lines=>lines.join("\n"),redact:redactHttpBody,json:value=>JSON.stringify(value,null,2),
  headers:headers=>Object.entries(headers).map(([name,value])=>`  ${name}: ${redactHttpHeaderValue(name,value)}`),
  indent:value=>value.split("\n").map(line=>`  ${line}`).join("\n"),snippet:body=>invoke("httpBody",[body]).replace(/\s+/g," ").trim().slice(0,200),
  tty:()=>process.stdout.isTTY===true,style:(style,value)=>style(value),muted:()=>text.muted,errorStyle:()=>text.error,
  summary:summarizeHttpError,requestLine:error=>`Request:  ${error.request.method} ${error.request.url}`,statusLine:error=>`Status:   ${error.response.status} ${error.response.statusText}`,
  requestHeaders:(lines,error)=>lines.push("","Request headers:",...operations.headers(error.request.headers),""),
  requestBody:(lines,error)=>lines.push("Request body:",operations.indent(invoke("httpBody",[error.request.body])),""),
  responseDetails:(lines,error)=>lines.push("","Response headers:",...operations.headers(error.response.headers),"","Response body:",operations.indent(invoke("httpBody",[error.response.body]))),
  summaryLines:summary=>[
    summary.code===undefined?undefined:`Code:     ${summary.code}`,
    summary.message===undefined?undefined:`Message:  ${summary.message}`,
    summary.requestId===undefined?undefined:`Request id: ${summary.requestId}`,
    summary.retryAfter===undefined?undefined:`Retry after: ${summary.retryAfter}`,
    summary.hint===undefined?undefined:`Hint:     ${summary.hint}`
  ].filter(line=>line!==undefined),
  fieldErrors:(lines,summary)=>lines.push("","Field errors:",...summary.fieldErrors.map(error=>`  ${error.path}: ${error.message}`)),
  appendLines:(lines,values)=>lines.push(...values),bodySnippet:error=>`Response body: ${operations.snippet(error.response.body)}`,
  invalidOperation(){throw new TypeError("Invalid CLI error operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function renderCliErrorPattern(pattern,outputEmitter){invoke("pattern",[pattern,outputEmitter]);}
export async function handleRunError(error,options){const logger=createLogger(options.outputEmitter);await withOutputFormat(toDesignSystemOutput(options.output),async()=>{invoke("handle",[error,options,logger]);});}
export function appendUsagePointer(message,options){return invoke("usagePointer",[message,options]);}
export function formatCliCommandPath(path){return invoke("cliPath",[path]);}
export function formatUnknownCommandMessage(input,current){return invoke("unknownMessage",[input,current]);}
export function findCurrentCommanderCommand(program,argv){return invoke("current",[program,argv]);}
export function findCurrentCommanderCommandPath(program,argv){return invoke("currentPath",[program,argv]);}
export function findUnknownCommanderCommand(program,argv){return invoke("unknown",[program,argv]);}
export function configureCommanderSuggestionOutput(command,version){invoke("configure",[command,version]);}
export function renderHttpError(error,options){invoke("http",[error,options]);}
