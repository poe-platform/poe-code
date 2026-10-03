import {createRequire} from "node:module";
import {createServer} from "tiny-stdio-mcp-server-rust";
import {UserError,createRuntimeLogger} from "./index.js";
import {normalizeRoots} from "./mcp-metadata.js";
import {enumerateTools} from "./mcp-tools.js";
import {createMCPToolHandler} from "./mcp-handler.js";
import {registerMCPStreams} from "./mcp-streams.js";
import {validateServices} from "./runtime-io.js";
import {assertHumanInLoopWired,mergeApprovalsRoot} from "./approval-wiring.js";
import {hasMcpProxyGroups,resolveMcpProxies} from "./mcp-proxy.js";
import {findEntrypointPackageMetadata} from "./package-metadata.js";
import {enableSourceMaps} from "./stack-trim.js";
import {callNative,protect} from "./host-errors.js";
export {MCP_STREAM_METHODS} from "./mcp-streams.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.mcpServerPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,object:()=>({}),false:()=>false,true:()=>true,truthy:value=>!!value,
  state:(root,options,runtime)=>({root,options,runtime}),keep:(state,key,value)=>{state[key]=value;},
  normalize:normalizeRoots,merge:mergeApprovalsRoot,wired:assertHumanInLoopWired,proxies:hasMcpProxyGroups,
  globalFetch:()=>globalThis.fetch,diagnostics:options=>createRuntimeLogger({level:options.logLevel,logger:options.logger}),validateServices,
  enumerate:state=>enumerateTools(state.root,state.casing,state.options.tools,state.options.omitRootToolNamePrefix??false),
  streamTools:tools=>tools.filter(tool=>invoke("isStream",[tool])),hasItems:tools=>tools.length>0,
  unsupported(tools){throw new UserError("MCP streams require a transport with session-scoped notifications. "+`Unsupported streams: ${tools.map(tool=>JSON.stringify(tool.name)).join(", ")}. `+"Use stateful HTTP or stdio, or exclude these streams with the tools option.");},
  entryVersion:()=>findEntrypointPackageMetadata(process.argv[1])?.version,
  missingVersion(){throw new Error('MCP server version is required. Pass version: "x.y.z" to createMCPServer / runMCP, or run toolcraft from a project whose package.json defines "version".');},
  customServer:(state,version)=>state.runtime.createServer?.({name:state.options.name,version,validateToolArguments:false}),
  defaultServer:(state,version)=>createServer({name:state.options.name,version,validateToolArguments:false}),
  streams:state=>registerMCPStreams(state.server,state.streamTools,state),
  tools(state){for(const tool of state.tools.filter(candidate=>!invoke("isStream",[candidate])))state.server.registerTool({name:tool.name,...(tool.title===undefined?{}:{title:tool.title}),description:tool.description,inputSchema:tool.inputSchema,...(tool.outputSchema===undefined?{}:{outputSchema:tool.outputSchema}),...(tool.annotations===undefined?{}:{annotations:tool.annotations})},createMCPToolHandler(tool,state));},
  exposed:state=>{const server=state.server;return {...server,connect(transport){return server.connectSDK(transport);}};},
  resolved:(root,options)=>invoke("resolved",[root,options,{}]),
  deferred(root,options){
    let serverPromise;
    const resolveServer=()=>{serverPromise??=(async()=>{await resolveMcpProxies(root,{projectRoot:options.projectRoot});return invoke("resolved",[root,options,{}]);})().catch(error=>{serverPromise=undefined;throw error;});return serverPromise;};
    return new Proxy({listen(){return resolveServer().then(server=>server.listen());},connect(transport){return resolveServer().then(server=>server.connect(transport));}},{get(target,property,receiver){if(property==="then")return resolveServer().then.bind(resolveServer());return Reflect.get(target,property,receiver);}});
  },
  invalidOperation(){throw new TypeError("Invalid MCP server operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function createMCPServer(roots,options){return invoke("create",[roots,options]);}
export async function createMCPServerForTransport(roots,options,runtime){const root=invoke("prepare",[roots,options]);await resolveMcpProxies(root,{projectRoot:options.projectRoot});invoke("resolved",[root,options,runtime]);}
export async function runMCP(roots,options){enableSourceMaps();const root=invoke("prepare",[roots,options]);await resolveMcpProxies(root,{projectRoot:options.projectRoot});const server=invoke("resolved",[root,options,{}]);await server.listen();}
