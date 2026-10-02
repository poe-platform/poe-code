import { FsError, type CommandContext } from 'safe-bash-contracts';
import { pathOf } from 'safe-bash-contracts/path';
import { createLlmConfiguration } from './configuration.js';
import { visitLlmStoredSchemas } from './history-schema-list.js';
import { renderSchemaJson, summarizeSchemaJson } from './schema-json.js';
import type { LlmStoredSchemaOptions } from './stored-schema.js';
export const schemasHelp = "Usage: llm schemas [OPTIONS] COMMAND [ARGS]...\n\n  Manage stored schemas\n\nOptions:\n  -h, --help  Show this message and exit.\n\nCommands:\n  list*  List stored schemas\n  dsl    Convert LLM's schema DSL to a JSON schema\n  show   Show a stored schema\n";
export const listHelp = "Usage: llm schemas list [OPTIONS]\n\n  List stored schemas\n\nOptions:\n  -d, --database FILE  Path to log database\n  -q, --query TEXT     Search for schemas matching this string\n  --full               Output full schema contents\n  --json               Output as JSON\n  --nl                 Output as newline-delimited JSON\n  -h, --help           Show this message and exit.\n";

export async function listSchemaCommand(context: Pick<CommandContext,'fs'|'cwd'|'env'|'signal'>,args:string[],emit:(text:string)=>Promise<void>,diagnostic:(text:string)=>Promise<void>,controls:LlmStoredSchemaOptions):Promise<number>{
 const usage='Usage: llm schemas list [OPTIONS]\n';
 const invalid=async(message:string):Promise<number>=>{
  await diagnostic(usage+"Try 'llm schemas list -h' for help.\n\nError: "+message+'\n');return 2;
 };
 let database:string|undefined,path:string|undefined,full=false,json=false,nl=false,help=false,ended=false;
 const queries:string[]=[],inputs:string[]=[];
 for(let index=0;index<args.length;index++){
  context.signal.throwIfAborted();const arg=args[index]!;
  if(!ended&&arg==='--'){ended=true;continue;}
  if(!ended&&arg.startsWith('-')&&arg!=='-'){
   const long=arg.startsWith('--'),equals=arg.indexOf('=');
   const flag=long?arg.slice(0,equals<0?undefined:equals):arg.slice(0,2);
   if(['--full','--json','--nl','--help','-h'].includes(flag)){
    if(equals>=0){await diagnostic(`Error: Option '${flag}' does not take a value.\n`);return 2;}
    if(flag==='--full')full=true;else if(flag==='--json')json=true;else if(flag==='--nl')nl=true;else help=true;
    continue;
   }
   if(!['--database','-d','--path','-p','--query','-q'].includes(flag))return invalid(unknownOption(flag));
   const attached=long?(equals<0?undefined:arg.slice(equals+1)):(arg.length>2?arg.slice(2):undefined);
   const value=attached??args[++index];
   if(value===undefined){await diagnostic(`Error: Option '${flag}' requires an argument.\n`);return 2;}
   if(flag==='--query'||flag==='-q')queries.push(value);else if(flag==='--path'||flag==='-p')path=value;else database=value;
  }else inputs.push(arg);
 }
 if(help){await emit(listHelp);return 0;}
 if(inputs.length)return invalid(`Got unexpected extra argument${inputs.length>1?'s':''} (${inputs.join(' ')})`);
 const selected=path||database;
 const filename=selected?pathOf(context,selected):`${createLlmConfiguration(context).directory}/logs.db`;
 try{
  for(const [label,supplied] of [["'-p' / '--path'",path],["'-d' / '--database'",database]] as const){
   if(supplied===undefined)continue;
   let stat;
   try{stat=await context.fs.stat(pathOf(context,supplied),{signal:context.signal});}
   catch(error){if(!(error instanceof FsError)||error.code!=='ENOENT')throw error;return invalid(`Invalid value for ${label}: File '${supplied}' does not exist.`);}
   if(stat.type!=='file')return invalid(`Invalid value for ${label}: File '${supplied}' is a directory.`);
  }
  try{await context.fs.stat(filename,{signal:context.signal});}
  catch(error){if(!(error instanceof FsError)||error.code!=='ENOENT')throw error;await diagnostic(`Error: No log database found at ${filename}\n`);return 1;}
  let count=0;
  await visitLlmStoredSchemas(context,{...controls,database:filename,queries},async row=>{
   if(json||nl){
    if(!nl)await emit(count?',\n':'[\n');
    const text='{"id":'+JSON.stringify(row.id)+',"content":'+row.content+',"recently_used":'+JSON.stringify(row.recentlyUsed)+',"times_used":'+row.timesUsed.toString()+'}';
    await renderSchemaJson(text,emit,context.signal,nl?{indent:null}:{linePrefix:'  ',trailingNewline:false});
   }else{
    await emit('- id: '+row.id+'\n');
    if(full){await emit('  schema: |\n');await renderSchemaJson(row.content,emit,context.signal,{linePrefix:'    '});}
    else await emit('  summary: |\n    '+summarizeSchemaJson(row.content,context.signal)+'\n');
    await emit('  usage: |\n    '+row.timesUsed+' time'+(row.timesUsed===1n?'':'s')+', most recently '+(row.recentlyUsed??'None')+'\n');
   }
   count++;
  });
  if(json&&!nl)await emit(count?'\n]\n':'[]\n');
  return 0;
 }catch(error){context.signal.throwIfAborted();await diagnostic(`Error: ${error instanceof Error?error.message:String(error)}\n`);return 1;}
}

// Click uses difflib's contiguous matching-block ratio, rather than edit distance.
function unknownOption(flag:string):string{
 const choices=['--path','--database','--query','--full','--json','--nl','--help'];
 const scores=choices.map(choice=>{
  if(2*Math.min(choice.length,flag.length)/(choice.length+flag.length)<0.6)return {choice,score:0};
  const matches=(a0:number,a1:number,b0:number,b1:number):number=>{
   let length=0,ai=a0,bi=b0;
   for(let a=a0;a<a1;a++)for(let b=b0;b<b1;b++){
    let size=0;while(a+size<a1&&b+size<b1&&choice[a+size]===flag[b+size])size++;
    if(size>length){length=size;ai=a;bi=b;}
   }
   if(!length)return 0;
   return length+matches(a0,ai,b0,bi)+matches(ai+length,a1,bi+length,b1);
  };
  return {choice,score:2*matches(0,choice.length,0,flag.length)/(choice.length+flag.length)};
 }).filter(item=>item.score>=0.6).sort((a,b)=>b.score-a.score||(a.choice<b.choice?1:-1)).slice(0,3).map(item=>item.choice).sort();
 const suffix=scores.length===1?' Did you mean '+scores[0]+'?':scores.length?' (Possible options: '+scores.join(', ')+')':'';
 return 'No such option: '+flag+(flag.startsWith('--')?suffix:'');
}
