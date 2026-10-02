import { embeddingText } from "./embed-input.js";
import { FsError } from "safe-bash-contracts";
import { pathOf } from 'safe-bash-contracts/path';
import type { CommandContext } from 'safe-bash-contracts';
import type { LlmService } from './service.js';
import type { LlmInputSource, LlmEmbeddingResponse } from './types.js';
import { createLlmConfiguration } from './configuration.js';
import { fileSource } from './file-source.js';
import { createLlmSpool } from './retained-spool.js';
import { sourceBytes } from './request-source.js';
import { serializeLlmEmbedding, type LlmEmbeddingFormat } from './embed-output.js';
const usage="Usage: llm embed [OPTIONS] [COLLECTION] [ID]\n";
const help="Usage: llm embed [OPTIONS] [COLLECTION] [ID]\n\n  Embed text and store or return the result\n\nOptions:\n  -i, --input PATH                File to embed\n  -m, --model TEXT                Embedding model to use\n  --store                         Store the text itself in the database\n  -d, --database FILE\n  -c, --content TEXT              Content to embed\n  --binary                        Treat input as binary data\n  --metadata TEXT                 JSON object metadata to store\n  -f, --format [json|blob|base64|hex]\n                                  Output format\n  -h, --help                      Show this message and exit.\n";

export async function embeddingCommand(context:CommandContext,service:LlmService,tokens:readonly string[],write:(bytes:Uint8Array)=>Promise<void>,diagnostic:(text:string)=>Promise<void>,step:()=>Promise<void>,admit:(bytes:number,materialized?:boolean)=>void,maxConfigurationBytes=Infinity):Promise<number>{
 const encoder=new TextEncoder();
 const fail=async(message:string,code=1,withUsage=false):Promise<number>=>{await diagnostic((withUsage?usage+"Try 'llm embed -h' for help.\n\n":'')+`Error: ${message}\n`);return code;};
 const values:Record<string,string>={},operands:string[]=[];
 let ended=false,wantsHelp=false,store=false,binary=false;
 const names:Record<string,string>={'-m':'model','--model':'model','-c':'content','--content':'content','-i':'input','--input':'input','-f':'format','--format':'format','-d':'database','--database':'database','--metadata':'metadata'};
 for(let index=0;index<tokens.length;index++){
  await step();const token=tokens[index]!;
  if(!ended&&token==='--'){ended=true;continue;}
  if(ended||!token.startsWith('-')||token==='-'){operands.push(token);continue;}
  const long=token.startsWith('--'),equals=token.indexOf('=');
  for(let cursor=long?0:1;cursor<token.length;cursor++){
   const flag=long?token.slice(0,equals<0?undefined:equals):'-'+token[cursor];
   if(['--help','-h','--store','--binary'].includes(flag)){
    if(long&&equals>=0)return fail(`Option '${flag}' does not take a value.`,2);
    if(flag==='--store')store=true;else if(flag==='--binary')binary=true;else wantsHelp=true;
    if(long)break;continue;
   }
   const name=names[flag];if(!name)return fail(`No such option: ${flag}`,2,true);
   const attached=long?(equals<0?undefined:token.slice(equals+1)):(token.slice(cursor+1)||undefined);
   const value=attached??tokens[++index];if(value===undefined)return fail(`Option '${flag}' requires an argument.`,2);
   values[name]=value;break;
  }
 }
 if(wantsHelp){await write(encoder.encode(help));return 0;}
 if(operands.length>2)return fail(`Got unexpected extra argument${operands.length>3?'s':''} (${operands.slice(2).join(' ')})`,2,true);
 if(values.format!==undefined&&!['json','blob','base64','hex'].includes(values.format))return fail(`Invalid value for '-f' / '--format': '${values.format}' is not one of 'json', 'blob', 'base64', 'hex'.`,2,true);
 if(values.metadata!==undefined){
  let metadata:unknown;try{metadata=JSON.parse(values.metadata);}catch{return fail("Invalid value for '--metadata': metadata must be valid JSON",2,true);}
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))return fail("Invalid value for '--metadata': metadata must be a JSON object",2,true);
 }
 if(values.input&&values.input!=='-'){
  try{await context.fs.stat(pathOf(context,values.input),{signal:context.signal});}
  catch(error){if(error instanceof FsError&&error.code==='ENOENT')return fail(`Invalid value for '-i' / '--input': Path '${values.input}' does not exist.`,2,true);throw error;}
 }
 if(operands.length===1)return fail('Must provide both collection and id');
 if(store&&!operands.length)return fail('Must provide collection when using --store');
 if(operands.length)return fail('Embedding collections are not yet available');
 const config=createLlmConfiguration(context,maxConfigurationBytes);
 const selected=values.model??(context.env.LLM_EMBEDDING_MODEL||undefined)??await config.defaultModel('default_embedding_model.txt');
 let entry;
 if(selected!==undefined){try{entry=service.resolve(await config.resolveAlias(selected));}catch{/* Match reference unknown-model diagnostic. */}}
 if(!entry?.model.capabilities?.includes('embed'))return fail('You need to specify an embedding model (no default model is set)');
 const binaryInput=binary&&!values.content;
 if(binaryInput&&!entry.model.capabilities?.includes('embed-binary'))return fail(`Model ${entry.model.id} does not support binary embeddings`);
 let input:LlmInputSource|undefined;
 try{
  let result:LlmEmbeddingResponse;
  const request={model:entry.model.id,options:{},signal:context.signal};
  if(values.content&&entry.provider.embed){result=await service.embed({...request,inputs:[values.content]});}
  else{
   if(!service.embedSources||!entry.provider.embedSources)return fail(`Model ${entry.model.id} does not support streamed embeddings`);
   if(values.content){
    const content=values.content;
    input={async dispose(){},bytes:{async *[Symbol.asyncIterator](){for(let offset=0;offset<content.length;){let end=Math.min(offset+4096,content.length);const last=content.charCodeAt(end-1);if(end<content.length&&last>=0xd800&&last<=0xdbff)end--;yield encoder.encode(content.slice(offset,end));offset=end;}}}};
   }else if(values.input&&values.input!=='-'){
    const path=pathOf(context,values.input),stat=await context.fs.stat(path,{signal:context.signal});
    if(!stat.size)return fail('No content provided');
    admit(stat.size);
    input=await fileSource({fs:context.fs,path,signal:context.signal,expectedStat:stat});
   }else{
    let spool:Awaited<ReturnType<typeof createLlmSpool>>|undefined;
    try{
     const stdin=context.stdinInput?{[Symbol.asyncIterator](){return {next:()=>context.stdinInput!.read(16384,context.signal)};}}:context.stdin;
     const decoder=new TextDecoder('utf-8',{fatal:true});
     for await(const bytes of sourceBytes(stdin,context.signal)){
      if(!bytes.length)continue;admit(bytes.length);
      spool??=await createLlmSpool(context.fs,context.cwd,context.signal,'input');
      if(!binaryInput)for(let offset=0;offset<bytes.length;offset+=16384)decoder.decode(bytes.subarray(offset,offset+16384),{stream:true});
      await spool.write(bytes);
     }
     if(!binaryInput)decoder.decode();
     if(!spool)return fail('No content provided');
     const retained=spool;input={bytes:retained.replay(),dispose:()=>retained.close()};
    }catch(error){await spool?.close();throw error;}
   }
   // Service owns the input lease from this point, including rejected requests.
   const raw=input;
   const owned=!binaryInput&&!values.content?{bytes:embeddingText(raw.bytes,context.signal),dispose:()=>raw.dispose()}:raw;input=undefined;
   result=await service.embedSources({...request,inputs:[owned],...(binaryInput?{binary:true}:{})});
  }
  for await(const chunk of serializeLlmEmbedding(result.vectors[0]!,(values.format??'json') as LlmEmbeddingFormat,context.signal))await write(chunk);
  return 0;
 }finally{await input?.dispose();}
}
