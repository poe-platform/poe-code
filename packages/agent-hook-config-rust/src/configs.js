import path from 'node:path';
import os from 'node:os';
import {native} from './native.js';
import {admit,checked} from './host.js';
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
