import {native} from './native.js';
import {createServer,ToolError} from './stdio-server.js';
import {createTerminalPilotGroup,createTerminalPilotRuntime} from './commands.js';

export function createTerminalPilotMCPGroup(){
 const commands=createTerminalPilotGroup().children,metadata=native.terminalCommandDefinitions();
 const children=[...commands,...commands].map((command,index)=>({
  ...command,name:index<commands.length?command.name:'terminal-'+command.name,
  positional:[],scope:['mcp'],result:metadata[index%commands.length].mcpResultSchema,
  async handler(context){const value=await command.handler(context);return value===undefined?{}:value;}
 }));
 return{kind:'group',name:'',aliases:[],scope:['mcp'],secrets:{},children};
}
export function createTerminalPilotMcpServer({terminalPilotRuntime=createTerminalPilotRuntime(),env,...options}={}){
 const server=createServer({...options,name:'terminal-pilot',version:'0.0.1',validateToolArguments:false});
 const tools=native.terminalPilotMcpTools(),commands=createTerminalPilotMCPGroup().children;
 let closePromise;
 const admission=new native.NativeTerminalMcpAdmission();
 const close=()=>{
  admission.shutdown();
  return closePromise??=(Promise.resolve().then(()=>terminalPilotRuntime.close?.()).catch(error=>{closePromise=undefined;throw error;}));
 };
 for(let index=0;index<tools.length;index++){
  const tool=tools[index],command=commands[index];
  server.registerTool(tool,async(params)=>{
   try{
    admission.assertOpen();
    const value=await command.handler({params,terminalPilotRuntime,env});
    const result=native.terminalPilotMcpResult(tool.name,value);
    if(result.fault!==undefined)throw new ToolError(result.code,result.fault);
    return{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};
   }catch(error){
    if(error instanceof ToolError)throw error;
    throw new ToolError(error?.rpcCode??(error?.name==='UserError'?-32602:-32603),error instanceof Error?error.message:String(error));
   }
  });
 }
 const connect=server.connect,connectSDK=server.connectSDK;
 return{...server,close,
  async connect(transport){try{await(transport.readable===undefined?connectSDK(transport):connect(transport));}finally{await close();}},
  async connectSDK(transport){try{await connectSDK(transport);}finally{await close();}},
  async listen(){try{await connect({readable:process.stdin,writable:process.stdout});}finally{await close();}}
 };
}
export async function main(){
 const server=createTerminalPilotMcpServer();
 try{await server.listen();}finally{await server.close();}
}
