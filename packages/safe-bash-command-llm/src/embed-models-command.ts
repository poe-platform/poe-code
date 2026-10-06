import {commandArguments} from './command-arguments.js';
import type {CommandContext} from 'safe-bash-contracts';
import type {LlmService} from './service.js';
import {createLlmConfiguration} from './configuration.js';



/** Manage embedding discovery and its separate default in canonical caller config. */
export async function embeddingModelsCommand(
 context:CommandContext,service:LlmService,tokens:readonly string[],
 emit:(text:string)=>Promise<void>,diagnostic:(text:string)=>Promise<void>,step:()=>Promise<void>,maxConfigurationBytes=Infinity,
):Promise<number>{
 const parsed=await commandArguments('embed-models',tokens,['list','default'],emit,diagnostic,step);
 if(typeof parsed==='number')return parsed;
 const {command,operands,values}=parsed,defaults=command==='default';
 const queries=(values.get('--query')??[]).map(value=>value.toLowerCase()),remove=values.has('--remove-default');
 const configuration=createLlmConfiguration(context,maxConfigurationBytes);
 if(defaults){
  const selected=operands[0];
  if(!selected&&!remove){
   const model=await configuration.defaultModel('default_embedding_model.txt');
   if(model===undefined)await diagnostic('<No default embedding model set>\n');else await emit(model+'\n');
  }else if(remove)await configuration.setDefaultModel(null,'default_embedding_model.txt');
  else{
   const resolved=await configuration.resolveAlias(selected!);
   let entry;
   try{entry=service.resolve(resolved);}catch{ /* Report the reference embedding-specific error below. */ }
   if(!entry?.model.capabilities?.includes('embed')||!entry.provider.embed&&!entry.provider.embedSources){await diagnostic(`Error: Unknown embedding model: ${selected}\n`);return 1;}
   await configuration.setDefaultModel(entry.model.id,'default_embedding_model.txt');
  }
  return 0;
 }
 const configured=await configuration.aliases();let emitted=false;
 for(const entry of service.models){
  await step();
  if(!entry.model.capabilities?.includes('embed')||!entry.provider.embed&&!entry.provider.embedSources)continue;
  const aliases=[...entry.model.aliases??[]];
  for(const [alias,target]of Object.entries(configured)){await step();if(target===entry.model.id)aliases.push(alias);}
  const description=`${entry.provider.name}: ${entry.model.id}`;
  const terms=[description,...aliases].map(value=>value.toLowerCase());
  if(!queries.every(query=>terms.some(term=>term.includes(query))))continue;
  await emit(description+(aliases.length?` (aliases: ${aliases.join(', ')})`:'')+'\n');emitted=true;
 }
 if(!emitted)await emit('\n');
 return 0;
}
