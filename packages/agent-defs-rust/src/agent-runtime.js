import {createRequire} from 'node:module';
const native=createRequire(import.meta.url)('./agent-defs-rust.node');
const policy=native.catalogSpecifierPolicy();
export const allAgents=Object.freeze(native.catalogDefinitions().map(({definition,hasArgumentTemplates})=>{
 if(hasArgumentTemplates)Object.assign(definition.otelCapture,{args:(endpoint,content)=>native.catalogTelemetryArguments(definition.id,endpoint,content)});
 for(const value of [definition.aliases,definition.apiShapes,definition.capabilities,definition.otelCapture?.env,definition.otelCapture,definition.branding.colors,definition.branding])if(value!==undefined)Object.freeze(value);
 return Object.freeze(definition);
}));
const lookup=new Map(native.catalogLookupKeys());
const capabilities=new Map(native.catalogCapabilities());
const aliasesById=new Map(allAgents.map(agent=>[agent.id,agent.aliases??[]]));
export function resolveAgentId(input){return lookup.get(input.trim().toLowerCase());}
export function listAgentsWithCapability(capability,options){
 const ids=capabilities.get(capability)??[];if(options===undefined)return [...ids];
 const names=[];for(const id of ids){names.push(id);if(options?.includeAliases)names.push(...aliasesById.get(id));}return names;
}
export function agentSupportsCapability(input,capability){const id=resolveAgentId(input);return id!==undefined&&(capabilities.get(capability)?.includes(id)??false);}
export function formatAgentCapabilityError({agent,capability}){return native.catalogCapabilityError(agent,agent.trim().toLowerCase(),capability);}
function nonBlankAgent(value){const agent=value.trim();if(agent.length===0)throw new TypeError(policy.emptyAgentError);return agent;}
export function parseAgentSpecifier(input){
 const colon=input.indexOf(policy.delimiter),agent=nonBlankAgent(input.slice(0,colon<0?input.length:colon));
 const model=colon<0?undefined:input.slice(colon+policy.delimiter.length).trim();
 return model?{agent,model}:{agent};
}
export function formatAgentSpecifier(specifier){
 const agent=nonBlankAgent(specifier.agent);
 const model=Object.hasOwn(specifier,'model')?specifier.model:undefined;
 const normalizedModel=model?.trim();return normalizedModel?`${agent}${policy.delimiter}${normalizedModel}`:agent;
}
export function normalizeAgentId(input){
 const specifier=parseAgentSpecifier(input.trim()),agent=resolveAgentId(specifier.agent)??specifier.agent;
 return formatAgentSpecifier({agent,model:Object.hasOwn(specifier,'model')?specifier.model:undefined});
}
