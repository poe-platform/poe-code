import {native} from './native.js';
const catalog=native.agentMcpCatalog(),lookup=new Map(catalog.lookup),registry=Object.fromEntries(catalog.configs);
for(const config of Object.values(registry))if(typeof config.configFile==='object'){
 const paths=config.configFile;
 config.configFile=platform=>typeof platform==='string'&&Object.hasOwn(paths,platform)?paths[platform]:paths.default;
}
export const supportedAgents=Object.keys(registry);
export function resolveAgentSupport(input,configs=registry){
 const id=lookup.get(input.trim().toLowerCase());
 if(!id)return {status:'unknown',input};
 const config=configs[id];
 if(!config)return {status:'unsupported',input,id};
 return {status:'supported',input,id,config:{...config}};
}
export function isSupported(agentId){return resolveAgentSupport(agentId).status==='supported';}
export function getAgentConfig(agentId){const result=resolveAgentSupport(agentId);return result.status==='supported'?result.config:undefined;}
export function resolveConfigPath(config,platform){return typeof config.configFile==='function'?config.configFile(platform):config.configFile;}
