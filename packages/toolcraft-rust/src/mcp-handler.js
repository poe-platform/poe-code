import {createRequire} from "node:module";
import {ToolError,JSON_RPC_ERROR_CODES,toContentBlocks} from "tiny-stdio-mcp-server-rust";
import {assertCommandRequirements,resolveCommandSecrets,ApprovalDeclinedError} from "./index.js";
import {createFs,createEnv} from "./runtime-io.js";
import {isMCPResult} from "./mcp-result.js";
import {validateToolArguments,validateCommandResult} from "./mcp-validation.js";
import {isHumanInLoopPending,renderPendingApproval,renderDeclinedApproval,toToolError} from "./mcp-errors.js";
import {writeErrorReport} from "./error-report.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.mcpHandlerPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,truthy:value=>!!value,keep:(state,key,value)=>{state[key]=value;},
  abort:state=>state.transportContext?.signal.throwIfAborted(),aborted:state=>state.transportContext?.signal.aborted,
  secrets:state=>resolveCommandSecrets(state.tool.command,state.options.env),
  services:state=>state.runtime.requestServices?.(state.transportContext),
  context(state,requestServices){
    const {services,humanInLoop,root,secrets,runtimeFetch,options,diagnostics,transportContext}=state;
    state.baseContext={...services,...requestServices,humanInLoop,root,secrets,fetch:runtimeFetch,fs:createFs(options.fs),env:createEnv(options.env),diagnostics,signal:transportContext?.signal,progress(message){diagnostics.emit({level:"info",message,category:"progress"});}};
  },
  requirements:state=>assertCommandRequirements(state.tool.command,{...state.baseContext,params:undefined},{apiVersion:state.options.apiVersion,env:state.options.env}),
  params:state=>validateToolArguments(state.tool.paramsSchema,state.argumentsValue,state.casing),
  handlerContext:state=>{state.handlerContext={...state.baseContext,params:state.params};},
  handler:state=>state.tool.command.handler(state.handlerContext),
  approval:state=>state.humanInLoop.invoke(state.tool.command,state.handlerContext,state.tool.commandPath),
  pending:isHumanInLoopPending,renderPending:renderPendingApproval,mcp:isMCPResult,
  project(state,result){try{return state.tool.command.mcpResult(result);}catch(error){throw new ToolError(JSON_RPC_ERROR_CODES.INTERNAL_ERROR,error instanceof Error?error.message:String(error));}},
  validate:(state,value)=>validateCommandResult(state.tool.resultSchema,value,state.casing),
  mergeResult:(result,structuredContent)=>({...result,structuredContent}),
  structured:structuredContent=>({content:[{type:"text",text:JSON.stringify(structuredContent)}],structuredContent}),
  content:toContentBlocks,declined:error=>error instanceof ApprovalDeclinedError,renderDeclined:renderDeclinedApproval,
  report:(state,error)=>writeErrorReport({command:state.tool.command,commandPath:state.tool.commandPath,env:process.env,error,errorReports:state.options.errorReports,params:state.params,projectRoot:state.options.projectRoot,secrets:state.secrets}),
  invalidOperation(){throw new TypeError("Invalid MCP handler operation");}
};
const host={operate:protect((name,args)=>name.startsWith("step:")?{kind:name.slice(5),value:args[0]}:operations[name](...args)),get:protect((value,key)=>value[key])};
export function createMCPToolHandler(tool,{options,runtime,services,humanInLoop,root,runtimeFetch,diagnostics,casing}){
  return async(argumentsValue,transportContext)=>{
    const state={tool,options,runtime,services,humanInLoop,root,runtimeFetch,diagnostics,casing,argumentsValue,transportContext,params:undefined,secrets:undefined};
    try{
      const requestServices=await invoke("services",[state]);
      await invoke("requirements",[state,requestServices]);
      const result=await invoke("handler",[state]);
      return invoke("result",[state,result]);
    }catch(error){
      const action=invoke("error",[state,error]);
      if(action.kind==="return")return action.value;
      const report=await action.value;
      throw toToolError(error,report?.displayPath);
    }
  };
}
