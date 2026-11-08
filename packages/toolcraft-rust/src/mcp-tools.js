import {createRequire} from "node:module";
import {UserError,ToolcraftBugError} from "./index.js";
import {filterSchemaForScope} from "./schema-scope.js";
import {validateCasedSchemaMembers} from "./schema-member-names.js";
import {buildToolDescription,formatSegment,formatToolName,matchesAllowlist} from "./mcp-metadata.js";
import {applySchemaCasing} from "./mcp-schema.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.mcpToolsPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,array:()=>[],truthy:value=>!!value,empty:value=>value.length===0,
  state:(casing,allowlist)=>({tools:[],paths:new Map(),casing,allowlist}),
  rootPath:root=>[root.name],appendName:(path,node)=>[...path,node.name],
  roots(root,path,state){for(const child of root.children)invoke("visit",[state,child,path,[]]);},
  children(node,state,toolPath,commandPath){for(const child of node.children)invoke("visit",[state,child,toolPath,commandPath]);},
  mcpScope:scope=>!!scope.includes("mcp"),toolName:(path,node)=>formatToolName([...path,node.name]),
  filter:params=>filterSchemaForScope(params,"mcp"),allow:matchesAllowlist,
  invalidParams(name){throw new ToolcraftBugError(`command "${name}" must define an object params schema for MCP.`);},
  validateMembers:(schema,casing)=>validateCasedSchemaMembers(schema,key=>formatSegment(key,casing),"MCP field"),
  commandPath:(path,node)=>[...path,node.name].join("."),getPath:(paths,name)=>paths.get(name),setPath:(paths,name,path)=>paths.set(name,path),
  conflict(existing,path,name){throw new UserError(`MCP commands "${existing}" and "${path}" use conflicting tool name "${name}".`);},
  definition(tools,node,commandPath,name,params,casing){
    tools.push({
      ...(node.annotations===undefined?{}:{annotations:{...node.annotations}}),command:node,commandPath,name,
      ...(node.title===undefined?{}:{title:node.title}),
      description:buildToolDescription(node.description,params,node.examples,node.name,casing),
      inputSchema:applySchemaCasing(params,casing,"input"),paramsSchema:params,
      ...(node.result===undefined?{}:{outputSchema:applySchemaCasing(node.result,casing),resultSchema:node.result})
    });
  },
  invalidOperation(){throw new TypeError("Invalid MCP enumeration operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function enumerateTools(root,casing,allowlist,omitRootToolNamePrefix){return invoke("enumerate",[root,casing,allowlist,omitRootToolNamePrefix]);}
