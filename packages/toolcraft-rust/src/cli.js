import {createRequire} from "node:module";
import {Command as CommanderCommand,CommanderError} from "commander";
import {configureTheme,withOutputFormat} from "toolcraft-design-rust";
import {ApprovalDeclinedError,UserError,hasMcpProxyConfig} from "./index.js";
import {resolveCLIControls,getGlobalLongOptionFlags} from "./cli-policy.js";
import {normalizeRoots,isNodeVisibleInScope} from "./cli-snapshot.js";
import {inferProgramName,renderGeneratedHelp} from "./cli-generated-help.js";
import {assertHumanInLoopWired,mergeApprovalsRoot} from "./approval-wiring.js";
import {findEntrypointPackageMetadata} from "./package-metadata.js";
import {validateServices} from "./runtime-io.js";
import {createNodeCommand,addCommanderChild,addGlobalOptions,getNodeCommandNames} from "./cli-commands.js";
import {prepareCliArguments} from "./cli-prepare.js";
import {executeCommand,getResolvedFlags} from "./cli-execution.js";
import {configureCommanderSuggestionOutput,formatCliCommandPath,findUnknownCommanderCommand,formatUnknownCommandMessage,renderCliErrorPattern,handleRunError} from "./cli-errors.js";
import {resolveOutput,resolveOutputFromArgv,toDesignSystemOutput,resolveDebugStackMode,getDebugStackModeFromArgv} from "./cli-argv.js";
import {writeErrorReport} from "./error-report.js";
import {enableSourceMaps} from "./stack-trim.js";
import {callNative,protect} from "./host-errors.js";
export {configureTheme};
export {formatCLIName} from "./cli-policy.js";
export {createCLICommandTreeSnapshot} from "./cli-snapshot.js";
export {renderErrorReport} from "./error-report.js";
configureTheme({brand:"blue",label:"Toolcraft"});
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
// Keep optional discovery out of basic CLI bundles, matching the JS entrypoint.
const optionalModulePaths={mcpProxy:"./mcp-proxy.js"};
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliRuntimePolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,truthy:value=>!!value,
  controls:resolveCLIControls,argv:options=>[...(options.argv??process.argv)],inferName:inferProgramName,
  state:(roots,options,invocation,controls,argv,rootUsageName)=>({roots,options,invocation,controls,argv,rootUsageName,lastActionCommand:undefined,resolvedCommandPath:"",program:undefined,version:undefined,proxyCleanup:undefined,userErrorPattern:"definition",errorReportContext:undefined}),
  keep:(state,key,value)=>{state[key]=value;},normalize:normalizeRoots,merge:mergeApprovalsRoot,assertWired:assertHumanInLoopWired,hasProxy:hasMcpProxyConfig,
  embeddedProxy(){throw new UserError("MCP proxy discovery requires the standalone CLI; native library plugins support in-process handlers only.");},
  proxyCleanup:(state,proxyRuntime)=>{state.proxyCleanup={dispose:proxyRuntime.disposeMcpProxies,root:state.root};},
  services:options=>options.services??{},runtimeFetch:options=>options.fetch??globalThis.fetch,
  metadata:state=>findEntrypointPackageMetadata(state.argv[1])?.version,
  builtIns:state=>({...state.services,humanInLoop:state.humanInLoop,root:state.root}),requirements:options=>({apiVersion:options.apiVersion,env:options.env}),validateServices,
  noArgs:argv=>argv.length<=2,defaultCli:root=>root.default?.scope.includes("cli")===true,
  help:(state,argv)=>renderGeneratedHelp(state.root,argv,{...state.options,version:state.version},state.invocation),
  program:()=>new CommanderCommand(),name:(program,root)=>program.name(root.name),exitOverride:program=>program.exitOverride(),showHelp:program=>program.showHelpAfterError(),noHelpCommand:program=>program.addHelpCommand(false),
  globals:getGlobalLongOptionFlags,loaders:()=>new Map(),addGlobals:addGlobalOptions,version:(program,version)=>program.version(version,"--version"),
  reserved:(program,root)=>Reflect.set(program,"_toolcraftReservedChildNames",root.children.filter(child=>!isNodeVisibleInScope(child,"cli")).flatMap(child=>getNodeCommandNames(child))),
  action:state=>async execution=>{
    state.lastActionCommand=execution.actionCommand;state.resolvedCommandPath=formatCliCommandPath(execution.commandPath);
    await executeCommand(execution,state.rootUsageName,state.servicesWithBuiltIns,state.requirementOptions,state.runtimeFetch,state.humanInLoop,state.options.env,state.options.fs,state.options.outputEmitter,state.controls.outputFormats,{input:state.options.promptInput,output:state.options.promptOutput},{logLevel:state.options.logLevel,logger:state.options.logger,verboseControlEnabled:state.controls.verbose},context=>{state.errorReportContext=context;},state.invocation);
  },
  childNames:root=>new Set(root.children.filter(candidate=>isNodeVisibleInScope(candidate,"cli")).map(candidate=>candidate.name)),
  children(state){for(const child of state.root.children)invoke("child",[state,child]);},
  createChild:(state,child)=>createNodeCommand(child,state.casing,state.globalLongOptionFlags,state.execute,state.presetsEnabled,state.controls,state.fieldLoaders),
  isNull:value=>value===null,defaultScope:root=>root.default.scope.includes("cli"),commandName:command=>command.name(),aliases:command=>command.aliases(),includes:(values,value)=>values.includes(value),
  addChild:(state,command,isDefault)=>addCommanderChild(state.program,command,isDefault,state.rootChildNames),configure:configureCommanderSuggestionOutput,
  configureInvocation(program,invocation){const configure=command=>{command.configureOutput({writeOut:chunk=>invocation.write(chunk),writeErr:chunk=>invocation.write(chunk,"stderr")});command.commands.forEach(configure);};configure(program);},
  prepare:state=>prepareCliArguments(state.program,state.argv,state.fieldLoaders,state.casing,state.controls),
  loadFields(state){for(const loadFields of state.fieldLoaders.values())loadFields();},unknown:state=>findUnknownCommanderCommand(state.program,state.argv),
  unknownError(unknown){throw new UserError(formatUnknownCommandMessage(unknown.input,unknown.currentCommand));},
  unknownOutput:state=>toDesignSystemOutput(resolveOutputFromArgv(state.argv,state.controls.outputFormats)),
  unknownRender:(state,unknown)=>renderCliErrorPattern({kind:"usage",message:formatUnknownCommandMessage(unknown.input,unknown.currentCommand),rootUsageName:state.rootUsageName,commandPath:unknown.commandPath},state.options.outputEmitter),
  parse:state=>state.program.parseAsync(state.argv),
  aborted:invocation=>invocation.signal.aborted,abortReason(invocation){throw invocation.signal.reason;},isCommander:error=>error instanceof CommanderError,
  invocationExit:(invocation,code)=>{invocation.exitCode=code;},one:()=>1,zero:value=>value===0,
  invocationError:(invocation,error)=>invocation.write(`${error instanceof Error?error.message:String(error)}\n`,"stderr"),
  flags:getResolvedFlags,isDeclined:error=>error instanceof ApprovalDeclinedError,
  flagsOutput:state=>resolveOutput(state.resolvedFlags),argvOutput:state=>resolveOutputFromArgv(state.argv,state.controls.outputFormats),designOutput:toDesignSystemOutput,
  declinedRender:(state,error)=>renderCliErrorPattern({kind:"runtime-user",message:error.message},state.options.outputEmitter),
  report:(state,error)=>writeErrorReport({argv:state.argv,command:state.errorReportContext?.command,commandPath:state.errorReportContext?.commandPath??state.resolvedCommandPath,env:process.env,error,errorReports:state.options.errorReports,params:state.errorReportContext?.params,projectRoot:state.options.projectRoot,secrets:state.errorReportContext?.secrets,version:state.version}),
  savedReport:report=>process.stderr.write(`Saved error report to ${report.displayPath}\n`),
  debugFlags:state=>resolveDebugStackMode(state.resolvedFlags.debug),debugArgv:state=>getDebugStackModeFromArgv(state.argv),
  flagsVerbose:state=>Boolean(state.resolvedFlags.verbose),argvVerbose:state=>state.argv.includes("--verbose"),errorParams:state=>state.errorReportContext?.params,
  errorOptionsStart:(state,debugControlEnabled,debugStackMode,output,verbose,verboseControlEnabled)=>({debugControlEnabled,debugStackMode,output,verbose,verboseControlEnabled,program:state.program,argv:state.argv,rootUsageName:state.rootUsageName,commandPath:state.resolvedCommandPath,outputEmitter:state.options.outputEmitter}),
  errorPattern:(options,userErrorPattern)=>{options.userErrorPattern=userErrorPattern;},
  handleError:handleRunError,cleanup:state=>state.proxyCleanup.dispose(state.proxyCleanup.root),
  cleanupError:error=>{process.exitCode=1;process.stderr.write(`Failed to close MCP proxy connections: ${error instanceof Error?error.message:String(error)}\n`);},
  invalidOperation(){throw new TypeError("Invalid public CLI operation");}
};
const host={operate:protect((name,args)=>name.startsWith("step:")?{kind:name.slice(5),value:args[0]}:operations[name](...args)),get:protect((value,key)=>value[key])};
export async function runCLI(roots,options={}){enableSourceMaps();await executeCLICommand(roots,options);}
export async function executeCLICommand(roots,options,invocation){
  const state=invoke("initialize",[roots,options,invocation]);
  try{
    const startup=invoke("root",[state]);
    if(startup.kind==="proxy"){
      const proxyRuntime=await import(optionalModulePaths.mcpProxy);
      await proxyRuntime.resolveMcpProxies(state.root,{projectRoot:options.projectRoot});
      invoke("proxyReady",[state,proxyRuntime]);
    }
    const prepared=invoke("prepare",[state]);if(prepared.kind==="help"){await prepared.value;return;}
    const parsed=invoke("commands",[state]);if(parsed.kind==="help"){await parsed.value;return;}
    const unknown=invoke("unknown",[state]);if(unknown.kind==="unknown"){
      await withOutputFormat(invoke("unknownOutput",[state]),async()=>{invoke("unknownRender",[state,unknown.value]);});return;
    }
    await invoke("parse",[state]);
  }catch(error){
    const caught=invoke("caught",[state,error]);if(caught.kind==="done")return;
    if(caught.kind==="declined"){
      await withOutputFormat(invoke("declinedOutput",[state]),async()=>{invoke("declinedRender",[state,error]);});return;
    }
    const report=await invoke("report",[state,error]);invoke("reportReady",[report]);
    await invoke("handleError",[state,error]);
  }finally{
    await invocation?.flush();
    if(invoke("hasCleanup",[state])){try{await invoke("cleanup",[state]);}catch(error){invoke("cleanupError",[error]);}}
  }
}
