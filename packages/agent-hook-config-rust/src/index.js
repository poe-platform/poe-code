import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {native} from './native.js';
import {Snapshot} from './snapshot.js';
const {configs,lookup,agents}=native.hookRegistry();
export const supportedHookAgents=Object.freeze(agents);
function clone(config){return {...config,supportedEvents:[...config.supportedEvents],supportedHandlerTypes:[...config.supportedHandlerTypes],placeholders:{...config.placeholders}};}
export function resolveAgentSupport(input,registry=configs){
 const key=input.trim().toLowerCase(),id=Object.hasOwn(lookup,key)?lookup[key]:undefined;
 const config=id===undefined?undefined:registry[id];
 const result=native.hookSupport(input,id,Boolean(config));
 if(config)result.config=clone(config);
 return result;
}
export function getAgentConfig(input){return resolveAgentSupport(input).config;}
function admit(value){
 const snapshot=new Snapshot(),active=new Set();let nodes=0;
 function write(value,depth){
  if(depth>128||++nodes>262144)throw new RangeError('Hook metadata exceeds transfer limits');
  if(value===null){snapshot.tag(0);return;}
  if(value===undefined){snapshot.tag(1);return;}
  if(typeof value==='boolean'){snapshot.tag(value?3:2);return;}
  if(typeof value==='number'){snapshot.tag(4);snapshot.number(value);return;}
  if(typeof value==='string'){snapshot.tag(5);snapshot.text(value);return;}
  if(typeof value!=='object')throw new TypeError('Unsupported hook metadata value');
  if(active.has(value))throw new TypeError('Cyclic hook metadata');active.add(value);
  if(Array.isArray(value)){snapshot.tag(9);snapshot.count(value.length);for(const item of value)write(item,depth+1);}
  else {const keys=Object.keys(value);snapshot.tag(10);snapshot.count(keys.length);for(const key of keys){snapshot.text(key);write(value[key],depth+1);}}
  active.delete(value);
 }
 write(value,0);return snapshot.finish();
}
function checked(result){if(Object.hasOwn(result,'error'))throw new Error(result.error);return result;}
export function supportedTransformPairs(registry=configs){return native.hookTransformPairs(admit(registry));}
export function formatSupportedTransformPairs(){return supportedTransformPairs().map(pair=>`${pair.source} -> ${pair.target}`).join(', ');}
export function isTransformSupported(source,target){const a=getAgentConfig(source),b=getAgentConfig(target);return a!==undefined&&b!==undefined&&supportedTransformPairs({source:a,target:b}).some(pair=>pair.source==='source'&&pair.target==='target');}
export function getEventMappings(source,target){return checked(native.hookEventMappings(source,target));}
export function getHandlerTypeRules(target){return checked(native.hookHandlerRules(target));}
export function getPlaceholderRewrites(source,target){return checked(native.hookPlaceholderRewrites(source,target));}
export function resolveHookPath(config,scope,cwd,homeDir=os.homedir()){
 const plan=native.hookPath(config.globalHookPath,config.localHookPath,scope,cwd,homeDir);
 if(plan===null)return undefined;
 if(plan.kind==='from')return path.resolve(plan.directory,plan.path);
 return path.resolve(plan.kind==='join'?path.join(plan.directory,plan.path):plan.path);
}
function selected(entry,generated=false){
 const handler=entry.handler;
 return {event:entry.event,matcher:entry.matcher,...(generated?{generatedId:entry.generatedId}:{}),handler:{type:handler.type,command:handler.command,args:handler.args,timeout:handler.timeout,statusMessage:handler.statusMessage}};
}
export function transformHooks(source,from,to,opts){
 const result=checked(native.hookTransform(admit(source.map(entry=>selected(entry))),from,to,opts.runId));
 for(const entry of result.entries)if(entry.matcher===null)entry.matcher=undefined;
 result.drops=result.drops.map(({sourceIndex,...drop})=>({...drop,source:source[sourceIndex]}));return result;
}
function files(run){
 const errors=[];
 const callback=(operation,args)=>{
  try{
   let value;
   switch(operation){
    case 'resolve':value=path.resolve(...args);break;
    case 'join':value=path.join(...args);break;
    case 'dirname':value=path.dirname(args[0]);break;
    case 'lstat':{const stats=fs.lstatSync(args[0]);value={symbolic:stats.isSymbolicLink(),file:stats.isFile()};break;}
    case 'read':value=fs.readFileSync(args[0],'utf8');break;
    case 'mkdir':fs.mkdirSync(args[0],{recursive:true});value=null;break;
    case 'write':fs.writeFileSync(args[0],args[1],{flag:'wx'});value=null;break;
    case 'rename':fs.renameSync(...args);value=null;break;
    case 'unlink':fs.unlinkSync(args[0]);value=null;break;
    default:throw new Error(`Unknown hook filesystem operation ${operation}`);
   }
   return JSON.stringify(value);
  }catch(error){const id=errors.push(error)-1;return JSON.stringify({error:id,code:error!==null&&(typeof error==='object'||typeof error==='function')&&Object.hasOwn(error,'code')?error.code:undefined});}
 };
 const result=run(callback);
 if(Object.hasOwn(result,'foreignError'))throw errors[result.foreignError];
 if(Object.hasOwn(result,'malformedPath')){let cause;try{JSON.parse(result.content);}catch(error){cause=error;}throw new Error(`Malformed JSON in ${result.malformedPath}`,{cause});}
 return checked(result);
}
export function readClaudeHooks(cwd,homeDir,opts){
 const result=files(callback=>native.hookRead(cwd,homeDir,opts?.scope??'merged',callback));
 for(const entry of result.entries)if(!Object.hasOwn(entry,'matcher'))entry.matcher=undefined;
 return result;
}
export function writeCodexHooks(targetPath,entries,runId,opts){return files(callback=>native.hookWrite(targetPath,admit(entries.map(entry=>selected(entry,true))),runId,Boolean(opts?.preserveGenerated),callback));}
