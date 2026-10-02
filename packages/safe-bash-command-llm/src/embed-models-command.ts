import type {CommandContext} from 'safe-bash-contracts';
import type {LlmService} from './service.js';
import {createLlmConfiguration} from './configuration.js';

const groupHelp='Usage: llm embed-models [OPTIONS] COMMAND [ARGS]...\n\n  Manage available embedding models\n\nOptions:\n  -h, --help  Show this message and exit.\n\nCommands:\n  list*    List available embedding models\n  default  Show or set the default embedding model\n';

/** Manage embedding discovery and its separate default in canonical caller config. */
export async function embeddingModelsCommand(
 context:CommandContext,service:LlmService,tokens:readonly string[],
 emit:(text:string)=>Promise<void>,diagnostic:(text:string)=>Promise<void>,step:()=>Promise<void>,maxConfigurationBytes=Infinity,
):Promise<number>{
 if(tokens[0]==='--'&&['list','default'].includes(tokens[1]??''))tokens=tokens.slice(1);
 const defaults=tokens[0]==='default',explicit=tokens[0]==='list'||defaults;
 const command=defaults?'default':'list';
 const usage=`Usage: llm embed-models ${command} [OPTIONS]${defaults?' [MODEL]':''}\n`;
 const fail=async(message:string,withUsage=true):Promise<number>=>{
  await diagnostic((withUsage?usage+`Try 'llm embed-models ${command} -h' for help.\n\n`:'')+`Error: ${message}\n`);return 2;
 };
 const terminator=tokens.indexOf('--');
 const groupFlags=terminator<0?tokens:tokens.slice(0,terminator);
 if(!explicit&&groupFlags.some(token=>token==='--help'||token.startsWith('-')&&!token.startsWith('--')&&token.slice(1).includes('h'))){await emit(groupHelp);return 0;}
 const args=explicit?tokens.slice(1):tokens.filter((_,index)=>index!==terminator);
 const queries:string[]=[],operands:string[]=[];
 let ended=false,help=false,remove=false;
 for(let index=0;index<args.length;index++){
  await step();const token=args[index]!;
  if(!ended&&token==='--'){ended=true;continue;}
  if(ended||!token.startsWith('-')||token==='-'){operands.push(token);continue;}
  if(token==='--help'||token==='-h'){help=true;continue;}
  if(defaults&&token==='--remove-default'){remove=true;continue;}
  if(!token.startsWith('--')){
   for(let cursor=1;cursor<token.length;cursor++){
    const flag='-'+token[cursor];
    if(flag==='-h'){help=true;continue;}
    if(defaults||flag!=='-q')return fail(`No such option: ${flag}`);
    const value=token.slice(cursor+1)||args[++index];
    if(value===undefined)return fail(`Option '${flag}' requires an argument.`,false);
    queries.push(value.toLowerCase());break;
   }
   continue;
  }
  const equals=token.indexOf('=');
  const flag=token.slice(0,equals<0?undefined:equals);
  if(equals>=0&&(flag==='--help'||defaults&&flag==='--remove-default'))return fail(`Option '${flag}' does not take a value.`,false);
  if(defaults||flag!=='--query')return fail(`No such option: ${flag}`);
  const attached=equals<0?undefined:token.slice(equals+1);
  const value=attached??args[++index];
  if(value===undefined)return fail(`Option '${flag}' requires an argument.`,false);
  queries.push(value.toLowerCase());
 }
 if(help){
  await emit(usage+(defaults?'\n  Show or set the default embedding model\n\nOptions:\n  --remove-default  Reset to specifying no default model\n  -h, --help        Show this message and exit.\n':'\n  List available embedding models\n\nOptions:\n  -q, --query TEXT  Search for embedding models matching these strings\n  -h, --help        Show this message and exit.\n'));return 0;
 }
 const extra=operands.slice(defaults?1:0);
 if(extra.length)return fail(`Got unexpected extra argument${extra.length===1?'':'s'} (${extra.join(' ')})`);
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
   if(!entry?.model.capabilities?.includes('embed')||!entry.provider.embed){await diagnostic(`Error: Unknown embedding model: ${selected}\n`);return 1;}
   await configuration.setDefaultModel(entry.model.id,'default_embedding_model.txt');
  }
  return 0;
 }
 const configured=await configuration.aliases();let emitted=false;
 for(const entry of service.models){
  await step();
  if(!entry.model.capabilities?.includes('embed')||!entry.provider.embed)continue;
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
