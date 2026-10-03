import {pathOf} from 'safe-bash-contracts/path';
import {FsError} from 'safe-bash-contracts';
import type {LlmCollectionCommands} from './collections-command-types.js';
import {withLlmCollections} from './collections.js';
import {createLlmConfiguration} from './configuration.js';
import {withCsvEmbeddingEntries} from './import-csv.js';
import {withJsonEmbeddingEntries} from './import-json.js';
import {withJsonLinesEmbeddingEntries} from './import-json-lines.js';
import {fileSource} from './file-source.js';
import type {LlmInputSource} from './types.js';
import {tokenInteger} from './token-integer.js';
import {sourceBytes} from './request-source.js';
import {sniffEmbeddingInput} from './import-csv-sniff.js';

const usage='Usage: llm embed-multi [OPTIONS] COLLECTION [INPUT_PATH]\n';
export async function embedMultiCommand(invocation:Parameters<LlmCollectionCommands['execute']>[0],limits:{maxFileBytes:number;maxIndexBytes:number;maxOpenFiles:number;now:()=>Date}):Promise<number>{
 const {context,tokens,service,diagnostic,maxConfigurationBytes,maxInputBytes,step}=invocation;
 const fail=async(message:string,code=2)=>{await diagnostic((code===2?usage+"Try 'llm embed-multi -h' for help.\n\n":'')+`Error: ${message}\n`);return code;};
 const values:Record<string,string>={},operands:string[]=[];let store=false,ended=false,help=false;
 for(let index=0;index<tokens.length;index++){
  await step();const token=tokens[index]!;
  if(!ended&&token==='--'){ended=true;continue;}
  if(ended||!token.startsWith('-')||token==='-'){operands.push(token);continue;}
  const equals=token.indexOf('='),long=token.startsWith('--');
  for(let cursor=long?0:1;cursor<token.length;cursor++){
   const flag=long?token.slice(0,equals<0?undefined:equals):'-'+token[cursor];
   if(flag==='-h'||flag==='--help'){if(equals>=0)return fail(`Option '${flag}' does not take a value.`);help=true;if(long)break;continue;}
   if(flag==='--store'){if(equals>=0)return fail(`Option '${flag}' does not take a value.`);store=true;break;}
   const name=({'--format':'format','--batch-size':'batchSize','--prefix':'prefix','--prepend':'prepend','-m':'model','--model':'model','-d':'database','--database':'database'} as Record<string,string>)[flag];
   if(!name)return fail(`No such option: ${flag}`);
   const value=(long?(equals<0?undefined:token.slice(equals+1)):(token.slice(cursor+1)||undefined))??tokens[++index];
   if(value===undefined)return fail(`Option '${flag}' requires an argument.`);values[name]=value;break;
  }
 }
 if(help){await invocation.write(new TextEncoder().encode(usage+'\n  Store embeddings from a CSV, TSV, JSON or JSONL file. Use - to read stdin.\n\nOptions:\n  --format [json|csv|tsv|nl]  Input format (auto-detected by default)\n  --batch-size INTEGER        Batch size to use when running embeddings\n  --prefix TEXT               Prefix to add to the IDs\n  -m, --model TEXT            Embedding model to use\n  --prepend TEXT              Prepend this string to all content\n  --store                     Store the text itself in the database\n  -d, --database FILE         Path to embeddings database\n  -h, --help                  Show this message and exit.\n'));return 0;}
 if(!operands.length)return fail("Missing argument 'COLLECTION'.");
 if(operands.length>2)return fail(`Got unexpected extra argument${operands.length===3?'':'s'} (${operands.slice(2).join(' ')})`);
 if(!operands[1])return fail('Either --sql or input path or --files is required');
 if(operands[1]!=='-'){
  try{const stat=await context.fs.stat(pathOf(context,operands[1]),{signal:context.signal});if(stat.type==='directory')return fail(`Invalid value for '[INPUT_PATH]': File '${operands[1]}' is a directory.`);}
  catch(error){if(error instanceof FsError&&error.code==='ENOENT')return fail(`Invalid value for '[INPUT_PATH]': File '${operands[1]}' does not exist.`);throw error;}
 }
 if(values.format!==undefined&&values.format!=='csv'&&values.format!=='tsv'&&values.format!=='json'&&values.format!=='nl')return fail('This import requires CSV or TSV data');
 const integer=values.batchSize===undefined?'100':tokenInteger(values.batchSize);
 if(integer===undefined)return fail(`Invalid value for '--batch-size': '${values.batchSize}' is not a valid integer.`);
 const requested=Number(integer)||100;
 if(!Number.isSafeInteger(requested)||requested<1)throw new RangeError('Stop argument for islice() must be None or an integer: 0 <= x <= sys.maxsize.');
 const config=createLlmConfiguration(context,maxConfigurationBytes),database=values.database||context.env.LLM_EMBEDDINGS_DB;
 if(!database)await context.fs.mkdir(config.directory,{recursive:true,signal:context.signal});
 const options={...limits,fs:context.fs,path:pathOf(context,database||config.directory+'/embeddings.db'),signal:context.signal};
 const name=operands[0]!;let model='';
 let missingModel=false;
 await withLlmCollections(options,async catalog=>{
  if(await catalog.exists(name))model=(await catalog.collection(name,{create:false})).model;
  else{
   const selected=values.model??(context.env.LLM_EMBEDDING_MODEL||undefined)??await config.defaultModel('default_embedding_model.txt');
   if(selected===undefined){missingModel=true;return;}
   model=service.resolve(await config.resolveAlias(selected)).model.id;
   if(!service.resolve(model).model.capabilities?.includes('embed')){missingModel=true;return;}
   await catalog.collection(name,{model});
  }
 });
 if(missingModel)return fail('You need to specify an embedding model (no default model is set)',1);
 const batchSize=Math.min(requested,service.resolve(model).model.embeddingBatchSize??requested);
 const acquire=async():Promise<LlmInputSource>=>operands[1]==='-'?{async dispose(){},bytes:context.stdinInput?{[Symbol.asyncIterator](){return {next:()=>context.stdinInput!.read(16384,context.signal)};}}:context.stdin}:fileSource({fs:context.fs,path:pathOf(context,operands[1]!),signal:context.signal,maxBytes:maxInputBytes});
 const importEntries:typeof withCsvEmbeddingEntries=async(opts,bytes,operation)=>{
  if(values.format!==undefined)return (values.format==='json'?withJsonEmbeddingEntries:values.format==='nl'?withJsonLinesEmbeddingEntries:withCsvEmbeddingEntries)(opts,bytes,operation);
  const detected=await sniffEmbeddingInput(bytes,context.signal);
  try{return await (detected.format==='json'?withJsonEmbeddingEntries:withCsvEmbeddingEntries)(opts,detected.bytes,operation);}finally{await detected.close();}
 };
 const csvOptions={...options,directory:context.cwd,tabs:values.format==='tsv',autoDetect:values.format===undefined,prefix:values.prefix??'',prepend:values.prepend??''};
 if(operands[1]!=='-'){
  const input=await acquire();
  try{await importEntries(csvOptions,input.bytes,async entries=>{for await(const entry of entries)await entry.input.dispose();});}finally{await input.dispose();}
 }
 const input=await acquire();
 try{
  const admitted={async *[Symbol.asyncIterator](){for await(const bytes of sourceBytes(input.bytes,context.signal)){invocation.admit(bytes.length);yield bytes;}}};
  await importEntries(csvOptions,admitted,async entries=>{
   await invocation.write(new TextEncoder().encode('Embedding\n'));
   const iterator=entries[Symbol.asyncIterator]();let finished=false;
   while(!finished){
    const first=await iterator.next();if(first.done)break;
    await withLlmCollections(options,catalog=>catalog.embedMany(name,{service,directory:context.cwd,maxInputBytes,batchSize,store,entries:{async *[Symbol.asyncIterator](){
     yield first.value;
     for(let count=1;count<batchSize;count++){
      const next=await iterator.next();if(next.done){finished=true;break;}yield next.value;
     }
    }}}));
   }
  });
 }finally{await input.dispose();}
 return 0;
}
