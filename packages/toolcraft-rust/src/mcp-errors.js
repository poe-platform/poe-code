import {createRequire} from "node:module";
import {ToolError,JSON_RPC_ERROR_CODES} from "tiny-stdio-mcp-server-rust";
import {UserError} from "./index.js";
import {isHttpErrorLike,createHttpErrorEnvelope} from "./api-error-summary.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.mcpErrorsPolicy,operation,args,host);}finally{depth--;}}
const operations={
  true:()=>true,false:()=>false,isObject:value=>typeof value==="object",isNull:value=>value===null,isString:value=>typeof value==="string",
  isToolError:error=>error instanceof ToolError,isUserError:error=>error instanceof UserError,isError:error=>error instanceof Error,isHttp:isHttpErrorLike,
  statusAtLeast400:error=>error.response.status>=400,statusBelow500:error=>error.response.status<500,
  invalidParams:()=>JSON_RPC_ERROR_CODES.INVALID_PARAMS,internalError:()=>JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
  envelope:createHttpErrorEnvelope,error:(code,message)=>new ToolError(code,message),errorWithData:(code,message,data)=>new ToolError(code,message,data),
  string:value=>String(value),json:value=>JSON.stringify(value),
  pendingText:pending=>`Queued for human approval (id: ${pending.approvalId}). Track with \`toolcraft approvals show --approval-id ${pending.approvalId}\`.`,
  declinedText:()=>"Declined.",declinedReason:error=>`Declined: ${error.reason}`,
  declinedJson:error=>JSON.stringify({outcome:"declined",reason:error.reason,commandPath:error.commandPath}),
  approvalContent:(isError,text,json)=>({isError,content:[{type:"text",text},{type:"text",text:json}]}),
  invalidOperation(){throw new TypeError("Invalid MCP error operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function isHumanInLoopPending(value){return invoke("pending",[value]);}
export function renderPendingApproval(pending){return invoke("renderPending",[pending]);}
export function renderDeclinedApproval(error){return invoke("renderDeclined",[error]);}
export function toToolError(error,reportPath){return invoke("toolError",[error,reportPath]);}
export function withToolErrorMapping(handler){return async(params,session)=>{try{return await handler(params,session);}catch(error){throw toToolError(error);}};}
