import {createRequire} from "node:module";
import {ToolError,JSON_RPC_ERROR_CODES} from "tiny-stdio-mcp-server-rust";
import {compileJsonSchema,formatIssues} from "toolcraft-schema-rust";
import {UserError,ToolcraftBugError,resolveCommandSecrets,assertCommandRequirements,createManagedStream} from "./index.js";
import {createFs,createEnv} from "./runtime-io.js";
import {applySchemaCasing} from "./mcp-schema.js";
import {validateToolArguments,serializeResultValue,throwResultValidationErrors} from "./mcp-validation.js";
import {withToolErrorMapping} from "./mcp-errors.js";
import {callNative,protect} from "./host-errors.js";
export const MCP_STREAM_METHODS={list:"toolcraft/streams/list",subscribe:"toolcraft/streams/subscribe",unsubscribe:"toolcraft/streams/unsubscribe",notification:"notifications/toolcraft/stream"};
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.mcpStreamsPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,truthy:value=>!!value,isString:value=>typeof value==="string",isRecord:value=>typeof value==="object"&&value!==null&&!Array.isArray(value),object:()=>({}),
  keep:(state,key,value)=>{state[key]=value;},name:request=>request?.name,arguments:request=>request?.arguments,
  find:(tools,name)=>tools.find(candidate=>candidate.name===name),missing(name){throw new UserError(`Stream not found: ${name??""}`);},notStream(tool){throw new ToolcraftBugError(`Command "${tool.commandPath}" is not a stream.`);},
  schema:(definition,casing)=>applySchemaCasing(definition.event,casing),compile:compileJsonSchema,
  secrets:state=>resolveCommandSecrets(state.tool.command,state.options.env),
  services:state=>state.runtime.requestServices?.(state.runtime.getRequestContext?.()),
  context(state,requestServices){const {services,humanInLoop,root,secrets,runtimeFetch,options,diagnostics}=state;state.baseContext={...services,...requestServices,humanInLoop,root,secrets,fetch:runtimeFetch,fs:createFs(options.fs),env:createEnv(options.env),diagnostics,progress(message){diagnostics.emit({level:"info",message,category:"progress"});}};},
  requirements:state=>assertCommandRequirements(state.tool.command,{...state.baseContext,params:undefined},{apiVersion:state.options.apiVersion,env:state.options.env}),
  params:state=>validateToolArguments(state.tool.paramsSchema,state.argumentsValue,state.casing),
  next:shared=>`stream-${++shared.nextSubscriptionId}`,
  managed:state=>createManagedStream({eventSchema:state.streamDefinition.event,signal:state.session.signal,onStatus(event){void state.notify({subscriptionId:state.subscriptionId,type:"status",status:event});},async create(signal,status){return await state.tool.command.handler({...state.baseContext,params:state.params,signal,status,async refreshSecrets(){return resolveCommandSecrets(state.tool.command,state.options.env);}});}}),
  remember:state=>state.shared.subscriptions.set(state.subscriptionId,{signal:state.session.signal,stream:state.stream}),
  aborted:state=>!!state.session.signal.aborted,notify:(state,params)=>state.session.notify(MCP_STREAM_METHODS.notification,params),
  forget:state=>state.shared.subscriptions.delete(state.subscriptionId),cancelFailed:(state,error)=>{void state.stream.cancel(error).catch(()=>undefined);},
  deliveryDiagnostic:(state,params)=>state.diagnostics.emit({level:"error",category:"runtime",message:"MCP stream notification delivery failed.",data:{subscriptionId:state.subscriptionId,notificationType:params.type}}),
  errors:()=>[],serialize:(state,event,errors)=>serializeResultValue(state.streamDefinition.event,event,state.casing,"",errors),throwErrors:throwResultValidationErrors,
  validate:(state,value)=>state.eventValidator.validate(value),invalidEvent(validation){throw new ToolError(JSON_RPC_ERROR_CODES.INTERNAL_ERROR,`Invalid stream event: ${formatIssues(validation.issues)}`);},
  data:(state,event)=>({subscriptionId:state.subscriptionId,type:"data",event}),end:state=>({subscriptionId:state.subscriptionId,type:"end"}),
  isError:error=>error instanceof Error,string:value=>String(value),error:(state,error)=>({subscriptionId:state.subscriptionId,type:"error",error}),
  result:state=>({subscriptionId:state.subscriptionId,eventSchema:state.eventSchema}),
  cancel:state=>state.stream.cancel().catch(()=>undefined),
  list:(tools,casing)=>({streams:tools.map(tool=>({name:tool.name,description:tool.description,inputSchema:tool.inputSchema,eventSchema:applySchemaCasing(tool.command.stream.event,casing),bufferSize:tool.command.stream.bufferSize}))}),
  id:request=>request?.subscriptionId,subscription:(shared,id)=>shared.subscriptions.get(id),cancelSubscription:subscription=>subscription.stream.cancel(),deleteSubscription:(shared,id)=>shared.subscriptions.delete(id),
  unsubscribed:value=>({unsubscribed:value}),
  invalidOperation(){throw new TypeError("Invalid MCP stream operation");}
};
const host={operate:protect((name,args)=>name.startsWith("step:")?{kind:name.slice(5),value:args[0],id:args[1]}:operations[name](...args)),get:protect((value,key)=>value[key])};
export function registerMCPStreams(server,streamTools,environment){
  const shared={subscriptions:new Map(),nextSubscriptionId:0};
  server.method(MCP_STREAM_METHODS.list,()=>invoke("list",[streamTools,environment.casing]));
  server.method(MCP_STREAM_METHODS.subscribe,withToolErrorMapping(async(request,session)=>{
    const state={...environment,shared,streamTools,request,session};
    const requestServices=await invoke("services",[state]);
    await invoke("requirements",[state,requestServices]);
    invoke("params",[state]);
    let notificationQueue=Promise.resolve();state.notificationFailed=false;
    state.notify=params=>{notificationQueue=notificationQueue.then(async()=>{if(!invoke("canNotify",[state]))return;try{await invoke("notify",[state,params]);}catch(error){invoke("deliveryFailed",[state,params,error]);}}).catch(()=>undefined);return notificationQueue;};
    invoke("start",[state]);
    void(async()=>{try{for await(const event of state.stream)await state.notify(invoke("event",[state,event]));const end=invoke("end",[state]);if(end.kind==="notify")await state.notify(end.value);}catch(error){const action=invoke("error",[state,error]);if(action.kind==="notify")await state.notify(action.value);}finally{await invoke("cleanup",[state]);}})();
    return invoke("result",[state]);
  }));
  server.method(MCP_STREAM_METHODS.unsubscribe,async(request,session)=>{const action=invoke("unsubscribe",[shared,request,session]);if(action.kind==="return")return action.value;await action.value;return invoke("unsubscribed",[shared,action.id]);});
}
