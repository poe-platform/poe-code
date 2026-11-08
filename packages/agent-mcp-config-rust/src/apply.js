import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {runMutations,configMutation,fileMutation} from './config/execution.js';
import {native} from './native.js';
import {getAgentConfig,resolveConfigPath,isSupported} from './configs.js';
import {getShapeTransformer} from './shapes.js';
export class UnsupportedAgentError extends Error{
 constructor(agentId){super(`Unsupported agent: ${agentId}`);this.name='UnsupportedAgentError';}
}
function nonempty(value){return typeof value==='string'&&value.trim().length>0;}
const validationPool=[],decisionPool=[];
function validate(server){
 let machine=validationPool.pop();
 if(machine)machine.reset();else machine=new native.AgentMcpValidation();
 let request=machine.request(),url,parsed;
 try{
  while(true){
   let flag;
   switch(request.kind){
    case 'name':flag=nonempty(server.name);break;
    case 'transport':flag=server.config.transport==='stdio';break;
    case 'command':flag=nonempty(server.config.command);break;
    case 'url':url=server.config.url;flag=nonempty(url);break;
    case 'parseUrl':try{parsed=new URL(url);flag=true;}catch{flag=false;}break;
    case 'http':flag=parsed.protocol==='http:';break;
    case 'https':flag=parsed.protocol==='https:';break;
    case 'error':throw new Error(request.message);
    case 'done':return;
    default:throw new Error('Invalid native validation request');
   }
   request=machine.respond(flag);
  }
 }finally{machine.discard();if(validationPool.length<8)validationPool.push(machine);}
}
function transform(mode,document,key,target,server,shaped,canonical){
 let machine=decisionPool.pop();
 if(machine)machine.reset(mode,key,target);else machine=new native.AgentMcpDecision(mode,key,target);
 let request=machine.request(),servers,existing,newServers;
 try{
  while(true){
   let kind='unit',flag=false,name;
   switch(request.kind){
    case 'map':{
     servers=document[key];
     kind=servers===undefined?'missing':servers&&typeof servers==='object'&&!Array.isArray(servers)?'valid':'invalid';
     break;
    }
    case 'emptyMap':servers={};break;
    case 'existing':
     kind='flag';
     if(mode==='configure'){existing=Object.hasOwn(servers,server.name)?servers[server.name]:undefined;flag=existing!==undefined;}
     else flag=Object.hasOwn(servers,server);
     break;
    case 'equalsShaped':kind='flag';flag=isDeepStrictEqual(existing,shaped);break;
    case 'hasCanonical':kind='flag';flag=canonical!==undefined;break;
    case 'equalsCanonical':kind='flag';flag=isDeepStrictEqual(existing,canonical);break;
    case 'conflictName':kind='name';name=`${server.name}`;break;
    case 'hasExpected':kind='flag';flag=shaped!==undefined;break;
    case 'equalsExpected':kind='flag';flag=isDeepStrictEqual(servers[server],shaped);break;
    case 'delete':newServers={...servers};delete newServers[server];kind='flag';flag=Object.keys(newServers).length===0;break;
    case 'noop':return {changed:false,content:document};
    case 'upsert':newServers={...servers,[server.name]:shaped};return {changed:true,content:{...document,[key]:newServers}};
    case 'removeKey':{const next={...document};delete next[key];return {changed:true,content:next};}
    case 'updateMap':return {changed:true,content:{...document,[key]:newServers}};
    case 'error':throw new Error(request.message);
    default:throw new Error('Invalid native decision request');
   }
   request=machine.respond(kind,flag,name);
  }
 }finally{machine.discard();if(decisionPool.length<8)decisionPool.push(machine);}
}
export async function configure(agentId,server,options){
 if(!isSupported(agentId))throw new UnsupportedAgentError(agentId);
 validate(server);
 const config=getAgentConfig(agentId),target=resolveConfigPath(config,options.platform),shape=getShapeTransformer(config.shape);
 const shaped=shape(server),enabledServer={...server,enabled:true},canonical=shape(enabledServer);
 if(shaped===undefined){await unconfigure(agentId,enabledServer,options);return;}
 const directory=path.dirname(target);
 await runMutations([
  fileMutation.ensureDirectory({path:directory,label:`Ensure directory ${directory}`}),
  configMutation.transform({target,format:config.format,transform:document=>transform('configure',document,config.configKey,target,server,shaped,canonical),label:`Add ${server.name} to ${target}`}),
 ],{fs:options.fs,homeDir:options.homeDir,dryRun:options.dryRun,observers:options.observers});
}
export async function unconfigure(agentId,server,options){
 if(!isSupported(agentId))throw new UnsupportedAgentError(agentId);
 const config=getAgentConfig(agentId),target=resolveConfigPath(config,options.platform),name=typeof server==='string'?server:server.name;
 const expected=typeof server==='string'?undefined:getShapeTransformer(config.shape)(server);
 await runMutations([
  configMutation.transform({target,format:config.format,transform:document=>transform('unconfigure',document,config.configKey,target,name,expected),label:`Remove ${name} from ${target}`}),
 ],{fs:options.fs,homeDir:options.homeDir,dryRun:options.dryRun,observers:options.observers});
}
