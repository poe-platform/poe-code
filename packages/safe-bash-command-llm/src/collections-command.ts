import {FsError} from 'safe-bash-contracts';
import {pathOf} from 'safe-bash-contracts/path';
import {withLlmCollections} from './collections.js';
import {LlmCollectionDoesNotExist} from './collections-errors.js';
import {createLlmConfiguration} from './configuration.js';
import type {LlmCollectionCommands} from './collections-command-types.js';
import {embeddingCommand} from './embed-command.js';
import {acquireEmbeddingInput} from './embed-source.js';
import type {LlmInputSource,LlmOption} from './types.js';

class EmbeddingCommandError extends Error {}

const groupHelp="Usage: llm collections [OPTIONS] COMMAND [ARGS]...\n\n  View and manage collections of embeddings\n\nOptions:\n  -h, --help  Show this message and exit.\n\nCommands:\n  list*   View a list of collections\n  delete  Delete the specified collection\n  path    Output the path to the embeddings database\n";
const usages={list:'Usage: llm collections list [OPTIONS]\n',delete:'Usage: llm collections delete [OPTIONS] COLLECTION\n',path:'Usage: llm collections path [OPTIONS]\n'};
const help={
 list:usages.list+'\n  View a list of collections\n\nOptions:\n  -d, --database FILE  Path to embeddings database\n  --json               Output as JSON\n  -h, --help           Show this message and exit.\n',
 delete:usages.delete+'\n  Delete the specified collection\n\n  Example usage:\n\n      llm collections delete my-collection\n\nOptions:\n  -d, --database FILE  Path to embeddings database\n  -h, --help           Show this message and exit.\n',
 path:usages.path+'\n  Output the path to the embeddings database\n\nOptions:\n  -h, --help  Show this message and exit.\n',
};

/** Explicit storage registration keeps SQLite out of stateless LLM bundles. */
export function createLlmCollectionCommands(options:{readonly maxFileBytes:number;readonly maxIndexBytes:number;readonly maxOpenFiles:number;readonly now?:()=>Date}):LlmCollectionCommands{
 for(const name of ['maxFileBytes','maxIndexBytes','maxOpenFiles'] as const)if(!Number.isSafeInteger(options[name])||options[name]<0)throw new RangeError(`Invalid collection ${name}`);
 const limits={maxFileBytes:options.maxFileBytes,maxIndexBytes:options.maxIndexBytes,maxOpenFiles:options.maxOpenFiles},now=options.now??(()=>new Date());
 return {async execute({context,tokens,write,diagnostic,step,maxConfigurationBytes,maxInputBytes,service,admit,command:group}){
  const encoder=new TextEncoder();
  const emit=async(text:string)=>{for(let offset=0;offset<text.length;){await step();let end=Math.min(offset+4096,text.length);const last=text.charCodeAt(end-1);if(end<text.length&&last>=0xd800&&last<=0xdbff)end--;await write(encoder.encode(text.slice(offset,end)));offset=end;}};
  if(group==='embed')return embeddingCommand(context,service,tokens,write,diagnostic,step,admit,maxConfigurationBytes,async request=>{
   const config=createLlmConfiguration(context,maxConfigurationBytes);
   const database=request.values.database||context.env.LLM_EMBEDDINGS_DB,path=pathOf(context,database||config.directory+'/embeddings.db');
   if(!database)await context.fs.mkdir(config.directory,{recursive:true,signal:context.signal});
   try{
    await withLlmCollections({...limits,fs:context.fs,path,signal:context.signal,now},async catalog=>{
     let model:string;
     if(await catalog.exists(request.collection))model=(await catalog.collection(request.collection,{create:false})).model;
     else{
      const selected=request.values.model??(context.env.LLM_EMBEDDING_MODEL||undefined)??await config.defaultModel('default_embedding_model.txt');
      if(selected===undefined)throw new EmbeddingCommandError('You need to specify an embedding model (no default model is set)');
      const entry=service.resolve(await config.resolveAlias(selected));
      if(!entry.model.capabilities?.includes('embed'))throw new EmbeddingCommandError('You need to specify an embedding model (no default model is set)');
      model=entry.model.id;await catalog.collection(request.collection,{model});
     }
     const binary=request.binary&&!request.values.content;
     if(binary&&!service.resolve(model).model.capabilities?.includes('embed-binary'))throw new EmbeddingCommandError(`Model ${model} does not support binary embeddings`);
     let input:LlmInputSource|undefined;
     try{
      input=await acquireEmbeddingInput(context,request.values,binary,admit);
      if(!input)throw new EmbeddingCommandError('No content provided');
      const owned=input;input=undefined;
      await catalog.embed(request.collection,request.id,{service,input:owned,directory:context.cwd,maxInputBytes,binary,store:request.store,...(request.values.metadata===undefined?{}:{metadata:JSON.parse(request.values.metadata) as Record<string,LlmOption>})});
     }finally{await input?.dispose();}
    });
    // The pinned Collection.embed method returns None, including with --format.
    if(request.values.format==='json')await emit('null\n');
    else if(request.values.format)throw new TypeError("object of type 'NoneType' has no len()");
    return 0;
   }catch(error){
    if(error instanceof EmbeddingCommandError){await diagnostic(`Error: ${error.message}\n`);return 1;}
    throw error;
   }
  });
  if(tokens[0]==='--help'||tokens[0]==='-h'){await emit(groupHelp);return 0;}
  let command:keyof typeof usages='list',start=tokens[0]==='--'?1:0;
  if(tokens[start]&&Object.hasOwn(usages,tokens[start]!)){
   command=tokens[start] as keyof typeof usages;start++;
  }
  const fail=async(message:string,code=1,usage=false)=>{await diagnostic((usage?usages[command]+`Try 'llm collections ${command} -h' for help.\n\n`:'')+`Error: ${message}\n`);return code;};
  let database:string|undefined,json=false,ended=false,wantsHelp=false;const operands:string[]=[];
  for(let index=start;index<tokens.length;index++){
   await step();const token=tokens[index]!;
   if(!ended&&token==='--'){ended=true;continue;}
   if(ended||!token.startsWith('-')||token==='-'){operands.push(token);continue;}
   const equals=token.indexOf('='),long=token.startsWith('--');
   for(let cursor=long?0:1;cursor<token.length;cursor++){
    const flag=long?token.slice(0,equals<0?undefined:equals):'-'+token[cursor];
    if(flag==='--help'||flag==='-h'||flag==='--json'&&command==='list'){
     if(long&&equals>=0)return fail(`Option '${flag}' does not take a value.`,2);
     if(flag==='--json')json=true;else wantsHelp=true;
     if(long)break;continue;
    }
    if(command==='path'||flag!=='-d'&&flag!=='--database')return fail(`No such option: ${flag}`,2,true);
    database=(long?(equals<0?undefined:token.slice(equals+1)):(token.slice(cursor+1)||undefined))??tokens[++index];
    if(database===undefined)return fail(`Option '${flag}' requires an argument.`,2);
    break;
   }
  }
  if(wantsHelp){await emit(help[command]);return 0;}
  if(command==='delete'&&!operands.length)return fail("Missing argument 'COLLECTION'.",2,true);
  const extra=operands.slice(command==='delete'?1:0);
  if(extra.length)return fail(`Got unexpected extra argument${extra.length===1?'':'s'} (${extra.join(' ')})`,2,true);
  const config=createLlmConfiguration(context,maxConfigurationBytes);
  if(command==='path'){await emit(config.directory+'/embeddings.db\n');return 0;}
  const display=database||context.env.LLM_EMBEDDINGS_DB||config.directory+'/embeddings.db',path=pathOf(context,display);
  try{
   const stat=await context.fs.stat(path,{signal:context.signal});
   if(stat.type==='directory')return fail(`Invalid value for '-d' / '--database': File '${display}' is a directory.`,2,true);
  }catch(error){if(!(error instanceof FsError&&error.code==='ENOENT'))throw error;return fail(command==='list'?`No collections table found in ${display}`:'Collection does not exist');}
  try{
   await withLlmCollections({...limits,fs:context.fs,path,signal:context.signal,now,create:false},async catalog=>{
    if(command==='delete'){await catalog.delete(operands[0]!);return;}
    let count=0;
    await catalog.list(async row=>{
     if(json){
      // The fields are bounded SQLite controls; escape non-ASCII like Python's json.dumps.
      const quoted=(value:string)=>{let result='';for(const char of JSON.stringify(value)){if(char.codePointAt(0)!>127){for(let index=0;index<char.length;index++)result+='\\u'+char.charCodeAt(index).toString(16).padStart(4,'0');}else result+=char;}return result;};
      await emit((count?',\n':'[\n')+`    {\n        "name": ${quoted(row.name)},\n        "model": ${quoted(row.model)},\n        "num_embeddings": ${row.count}\n    }`);
     }else await emit(`${row.name}: ${row.model}\n  ${row.count} embedding${row.count===1n?'':'s'}\n`);
     count++;
    });
    if(json)await emit(count?'\n]\n':'[]\n');
   });
   return 0;
  }catch(error){
   context.signal.throwIfAborted();
   if(error instanceof LlmCollectionDoesNotExist)return fail('Collection does not exist');
   if(error instanceof FsError&&error.code==='ENOENT')return fail(command==='list'?`No collections table found in ${display}`:'Collection does not exist');
   throw error;
  }
 }};
}
