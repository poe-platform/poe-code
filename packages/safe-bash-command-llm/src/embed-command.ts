import {commandArguments} from './command-arguments.js';
import { FsError } from "safe-bash-contracts";
import { pathOf } from 'safe-bash-contracts/path';
import type { CommandContext } from 'safe-bash-contracts';
import type { LlmService } from './service.js';
import type { LlmInputSource, LlmEmbeddingResponse } from './types.js';
import { createLlmConfiguration } from './configuration.js';
import {acquireEmbeddingInput} from './embed-source.js';
import { serializeLlmEmbedding, type LlmEmbeddingFormat } from './embed-output.js';
const usage="Usage: llm embed [OPTIONS] [COLLECTION] [ID]\n";

export async function embeddingCommand(context:CommandContext,service:LlmService,tokens:readonly string[],write:(bytes:Uint8Array)=>Promise<void>,diagnostic:(text:string)=>Promise<void>,step:()=>Promise<void>,admit:(bytes:number,materialized?:boolean)=>void,maxConfigurationBytes=Infinity,stored?: (request:{collection:string;id:string;values:Readonly<Record<string,string>>;store:boolean;binary:boolean})=>Promise<number>):Promise<number>{
 const encoder=new TextEncoder();
 const fail=async(message:string,code=1,withUsage=false):Promise<number>=>{await diagnostic((withUsage?usage+"Try 'llm embed -h' for help.\n\n":'')+`Error: ${message}\n`);return code;};
 const parsed=await commandArguments('embed',tokens,[],text=>write(encoder.encode(text)),diagnostic,step);
 if(typeof parsed==='number')return parsed;
 const operands=parsed.operands,store=parsed.values.has('--store'),binary=parsed.values.has('--binary');
 const values:Record<string,string>={};
 for(const [flag,entries]of parsed.values)if(entries.length)values[flag.slice(2)]=entries.at(-1)!;
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
 if(operands.length)return stored?stored({collection:operands[0]!,id:operands[1]!,values,store,binary}):fail('Embedding collections are not yet available');
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
   input=await acquireEmbeddingInput(context,values,binaryInput,admit);
   if(!input)return fail('No content provided');
   // Service owns the input lease from this point, including rejected requests.
   const owned=input;input=undefined;
   result=await service.embedSources({...request,inputs:[owned],...(binaryInput?{binary:true}:{})});
  }
  for await(const chunk of serializeLlmEmbedding(result.vectors[0]!,(values.format??'json') as LlmEmbeddingFormat,context.signal))await write(chunk);
  return 0;
 }finally{await input?.dispose();}
}
