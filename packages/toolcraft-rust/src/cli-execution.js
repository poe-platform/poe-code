import {createRequire} from "node:module";
import {validate as validateSchema,nativeJsonSchema} from "toolcraft-schema-rust";
import {createLogger,renderTable,getTheme,note,confirm,isCancel,withOutputFormat} from "toolcraft-design-rust";
import {UserError,createRuntimeLogger,assertCommandRequirements,resolveCommandSecrets,createManagedStream} from "./index.js";
import {resolveFixtureRuntime} from "./cli-fixtures.js";
import {resolveParams,throwValidationErrors} from "./cli-params.js";
import {resolveOutput,toDesignSystemOutput} from "./cli-argv.js";
import {formatFieldValidationIssue} from "./cli-dynamic-values.js";
import {formatResolvedValue} from "./cli-prompts.js";
import {renderResult} from "./renderer.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliExecutionPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,truthy:value=>!!value,isNull:value=>value===null,isObject:value=>typeof value==="object",isString:value=>typeof value==="string",
  object:()=>({}),list:()=>[],unshift:(commands,current)=>commands.unshift(current),
  assignFlags(flags,commands){for(const current of commands)Object.assign(flags,current.opts());},
  state:(execution,rootUsageName,services,requirementOptions,runtimeFetch,humanInLoop,runtimeEnv,runtimeFs,outputEmitter,outputFormats,promptStreams,diagnosticsOptions,onErrorReportContext,invocation)=>({execution,rootUsageName,services,requirementOptions,runtimeFetch,humanInLoop,runtimeEnv,runtimeFs,outputEmitter,outputFormats,promptStreams,diagnosticsOptions,onErrorReportContext,invocation}),
  keep:(state,key,value)=>{state[key]=value;},logger:createLogger,resolveOutput,
  standardNote:()=>note,invocationNote:invocation=>(message,title)=>note(message,title,invocation.write),
  primitives:(logger,note,output)=>({logger,renderTable,getTheme,note,outputFormat:output}),
  diagnosticSink:()=>writeCLIDiagnosticEvent,invocationSink:invocation=>event=>invocation.write(`${event.message}\n`,"stderr"),
  diagnostics:(level,logger)=>createRuntimeLogger({level,logger}),
  input:(streams,invocation)=>streams.input??(invocation?{isTTY:false}:process.stdin),
  output:(streams,invocation)=>streams.output??(invocation?{isTTY:false}:process.stdout),tty:stream=>Boolean(stream.isTTY),
  missingContext:(state,stdinTTY,stdoutTTY)=>({commandPath:state.execution.commandPath,params:{},output:"rich",stdinTTY,stdoutTTY}),
  runtime:state=>resolveFixtureRuntime(state.execution.command,state.services,state.requirementOptions,state.runtimeFetch,state.runtimeEnv,state.runtimeFs,state.invocation!==undefined),
  preflight(state,runtime){
    state.runtime=runtime;const invocation=state.invocation,diagnostics=state.diagnostics,logger=state.logger;
    state.preflightContext={...runtime.services,...invocation?.capabilities,...(invocation?{signal:invocation.signal}:{}),secrets:runtime.secrets,fetch:runtime.fetch,fs:runtime.fs,env:runtime.env,diagnostics,progress(message){diagnostics.emit({level:"info",message,category:"progress"});logger.info(message);}};
    state.runtimeSecrets=undefined;state.resolvedParams=undefined;
  },
  designOutput:state=>toDesignSystemOutput(state.output),
  requirements:state=>assertCommandRequirements(state.execution.command,state.preflightContext,state.runtime.requirementOptions),
  params:state=>resolveParams(state.execution.fields,state.execution.dynamicFields,state.execution.variants,state.execution.positionalValues,state.optionValues,state.execution.rawArgv,state.execution.casing,state.execution.presetsEnabled?state.optionValues.preset:undefined,state.shouldPrompt,state.missingParameterContext,state.promptStreams,state.invocation?.defaults?.[state.execution.declarationPath.join("/")]),
  schemaMarker:schema=>schema[nativeJsonSchema],validate:validateSchema,
  validationErrors:validation=>throwValidationErrors(validation.issues.map(issue=>formatFieldValidationIssue(issue,""))),
  assignParams:(params,validation)=>Object.assign(params,validation.value),
  abort:state=>state.invocation.signal.throwIfAborted(),optionalAbort:state=>state.invocation?.signal.throwIfAborted(),
  invocationRequirements:(state,params)=>assertCommandRequirements(state.execution.command,{...state.preflightContext,params},state.runtime.requirementOptions),
  confirmationRequired(){throw new UserError("Confirmation required; supply --yes to authorize this command.");},
  context(state,params){state.resolvedParams=params;state.runtimeSecrets=state.runtime.secrets;state.context={...state.preflightContext,params};},
  managed:state=>createManagedStream({
    eventSchema:state.execution.command.stream.event,signal:state.invocation?.signal,
    onStatus(event){invoke("streamStatus",[state,event]);},
    async create(signal,status){return await state.execution.command.handler({...state.context,signal,status,async refreshSecrets(){return resolveCommandSecrets(state.execution.command,state.runtimeEnv);}});}
  }),
  statusDiagnostic:(state,event)=>state.diagnostics.emit({level:"info",message:event.message??event.type,category:"runtime"}),
  statusInfo:(state,event)=>state.logger.info(event.message),
  listen:interrupt=>process.once("SIGINT",interrupt),unlisten:interrupt=>process.removeListener("SIGINT",interrupt),
  json:event=>JSON.stringify(event),stdoutLine:line=>process.stdout.write(`${line}\n`),
  emitLine:(outputEmitter,line)=>outputEmitter(line),
  renderStream:(state,event)=>renderCLIResult(state.execution.command,state.execution.commandPath,event,state.output,state.primitives,state.outputFormats,state.invocation?.write??(state.outputEmitter===undefined?undefined:chunk=>state.outputEmitter(chunk.endsWith("\n")?chunk.slice(0,-1):chunk)),state.outputEmitter),
  logResolved(state){for(const field of state.execution.fields)invoke("confirmationField",[state,field]);},
  fieldValue:(state,field)=>field.path.reduce((current,segment)=>current&&typeof current==="object"?current[segment]:undefined,state.resolvedParams),
  resolvedLog:(state,field,value)=>state.logger.resolved(field.displayPath,formatResolvedValue(value)),
  confirm:state=>confirm({message:"Proceed?",initialValue:true,...state.promptStreams}),isCancel,
  cancelled(){throw new UserError("Operation cancelled.");},
  handler:state=>state.execution.command.handler(state.context),
  approval:state=>state.humanInLoop.invoke(state.execution.command,state.context,state.execution.commandPath),
  fixtureHeader:state=>writeRichHeader(`${state.execution.command.name} (fixture)`),
  pendingOutput:(state,result)=>renderHumanInLoopPending(result,state.rootUsageName,state.outputEmitter),
  renderHandler:(state,result,pending)=>renderCLIResult(pending?{...state.execution.command,render:undefined}:state.execution.command,state.execution.commandPath,result,state.output,state.primitives,state.outputFormats,state.invocation?.write??(state.outputEmitter===undefined?undefined:chunk=>state.outputEmitter(chunk.endsWith("\n")?chunk.slice(0,-1):chunk)),state.outputEmitter),
  invocationError:state=>{state.invocation.exitCode=1;},processError:()=>{process.exitCode=1;},
  errorContext(state){const onErrorReportContext=state.onErrorReportContext;onErrorReportContext?.({command:state.execution.command,commandPath:state.execution.commandPath,params:state.resolvedParams,secrets:state.runtimeSecrets??state.runtime.secrets});},
  transcript:event=>event.data?.transcript,stderr:transcript=>process.stderr.write(transcript),diagnostic:event=>process.stderr.write(`${event.message}\n`),
  padding:title=>Math.max(12,34-title.length),header:(title,padding)=>process.stdout.write(`── ${title} ${"─".repeat(padding)}\n`),
  pendingMessage:(pending,rootUsageName)=>`✓ Queued for human approval (id: ${pending.approvalId})\n`+`  Message: ${pending.message}\n`+`  Track:   ${rootUsageName} approvals show --approval-id ${pending.approvalId}`,
  customRenderer:(formats,output)=>formats[output],
  defaultRender:(command,result,output,primitives,write)=>renderResult(command,result,output,primitives,write),
  customRender:(customRenderer,command,commandPath,primitives,result)=>customRenderer({command,commandPath,primitives,result}),
  positiveLength:payload=>payload.length>0,
  exact:(emitExact,payload)=>emitExact(payload),stdout:payload=>process.stdout.write(payload),write:(write,payload)=>write(payload),
  status:()=>({mcpError:false}),
  invalidOperation(){throw new TypeError("Invalid CLI execution operation");}
};
const host={operate:protect((name,args)=>name.startsWith("step:")?{kind:name.slice(5),value:args[0]}:operations[name](...args)),get:protect((value,key)=>value[key])};
export function getResolvedFlags(command){return invoke("flags",[command]);}
export function writeCLIDiagnosticEvent(event){invoke("diagnostic",[event]);}
export function writeRichHeader(title){invoke("header",[title]);}
export function isHumanInLoopPending(result){return invoke("pending",[result]);}
export function renderHumanInLoopPending(pending,rootUsageName,outputEmitter){invoke("pendingOutput",[pending,rootUsageName,outputEmitter]);}
export function renderCLIResult(command,commandPath,result,output,primitives,outputFormats,write,emitExact){return invoke("render",[command,commandPath,result,output,primitives,outputFormats,write,emitExact]);}
export async function executeCommand(execution,rootUsageName,services,requirementOptions,runtimeFetch,humanInLoop,runtimeEnv,runtimeFs,outputEmitter,outputFormats,promptStreams,diagnosticsOptions,onErrorReportContext,invocation){
  const state=invoke("initialize",[execution,rootUsageName,services,requirementOptions,runtimeFetch,humanInLoop,runtimeEnv,runtimeFs,outputEmitter,outputFormats,promptStreams,diagnosticsOptions,onErrorReportContext,invocation]);
  const runtime=await invoke("runtime",[state]);invoke("preflight",[state,runtime]);
  try{
    await withOutputFormat(invoke("designOutput",[state]),async()=>{
      const preflight=invoke("beforeParams",[state]);if(preflight.kind==="await")await preflight.value;
      const params=await invoke("params",[state]);
      const validation=invoke("afterParams",[state,params]);if(validation.kind==="return")return;if(validation.kind==="await")await validation.value;
      invoke("context",[state,params]);
      const streaming=invoke("stream",[state]);
      if(streaming.kind==="stream"){
        const stream=streaming.value;
        const interrupt=()=>{void stream.cancel(new UserError("Operation cancelled.")).catch(()=>undefined);};
        invoke("listen",[state,interrupt]);
        try{for await(const event of stream){invoke("event",[state,event]);await invocation?.flush();}invoke("afterStream",[state]);}
        finally{invoke("unlisten",[state,interrupt]);await stream.cancel();}
        return;
      }
      const confirmation=invoke("confirmation",[state]);if(confirmation.kind==="confirm")invoke("confirmed",[await confirmation.value]);
      const result=await invoke("handler",[state]);invoke("afterHandler",[state,result]);
    });
  }catch(error){invoke("errorContext",[state]);throw error;}
}
