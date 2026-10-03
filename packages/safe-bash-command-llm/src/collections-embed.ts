import {FsError,type FileSystem} from 'safe-bash-contracts';
import {md5} from 'safe-bash-checksum-engine/md5';
import {withSqliteStatement,type SqliteFinalizer,type SqliteRecordValue} from 'safe-bash-sqlite-engine/storage';
import type {LlmCollection} from './collections.js';
import type {LlmService} from './service.js';
import type {LlmInputSource,LlmOption} from './types.js';
import {jsonValue} from './json-value.js';
import {createLlmSpool} from './retained-spool.js';
import {sourceBytes} from './request-source.js';
import {writeEmbeddings} from './collections-write.js';

export interface LlmCollectionEmbedOptions {
 readonly service:LlmService;
 /** Transferred input lease, consumed once and disposed when this operation settles. */
 readonly input:LlmInputSource;
 /** Caller-authorized directory for retained input staging. */
 readonly directory:string;
 readonly maxInputBytes:number;
 readonly binary?:boolean;
 readonly store?:boolean;
 readonly metadata?:Readonly<Record<string,LlmOption>>;
}

export async function embedCollection(editor:SqliteFinalizer,options:LlmCollectionEmbedOptions & {
 fs:FileSystem;signal:AbortSignal;collection:LlmCollection;id:string;now:()=>Date;
}):Promise<void>{
 const {signal,input,collection,id}=options;
 let spool:Awaited<ReturnType<typeof createLlmSpool>>|undefined;
 let metadataSpool:typeof spool;
 let failed=false;
 const digest=md5.create();
 try{
  if(typeof id!=='string')throw new TypeError('Embedding ID must be a string');
  if(options.maxInputBytes!==Infinity&&(!Number.isSafeInteger(options.maxInputBytes)||options.maxInputBytes<0))throw new RangeError('Invalid embedding input byte limit');
  spool=await createLlmSpool(options.fs,options.directory,signal,'input');
  const decoder=options.binary?undefined:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  let size=0;
  for await(const bytes of sourceBytes(input.bytes,signal)){
   if(bytes.length>options.maxInputBytes-size)throw new RangeError('Embedding input byte limit exceeded');
   size+=bytes.length;
   for(let offset=0;offset<bytes.length;offset+=16384){
    const part=bytes.subarray(offset,offset+16384);decoder?.decode(part,{stream:true});digest.update(part);await spool.write(part);
   }
  }
  decoder?.decode();
  const hash=digest.digest();
  const duplicate=await editor.withSession(session=>withSqliteStatement(session.module,{...session,signal,sql:'SELECT 1 FROM embeddings WHERE collection_id=? AND content_hash=? LIMIT 1'},async query=>{
   for await(const row of query.rows([collection.id,hash],['integer'])){void row;return true;}return false;
  }));
  if(duplicate)return;
  let metadata:SqliteRecordValue=null;
  if(options.metadata&&Object.keys(options.metadata).length){
   metadataSpool=await createLlmSpool(options.fs,options.directory,signal,'input');
   let metadataSize=0;
   for await(const bytes of jsonValue(options.metadata,signal)){
    if(bytes.length>options.maxInputBytes-size-metadataSize)throw new RangeError('Embedding input byte limit exceeded');
    metadataSize+=bytes.length;await metadataSpool.write(bytes);
   }
   const retainedMetadata=metadataSpool;
   metadata={type:'text',size:metadataSize,bytes:{[Symbol.asyncIterator]:()=>retainedMetadata.replay()[Symbol.asyncIterator]()}};
  }
  if(!options.service.embedSources)throw new Error('LLM service does not support streamed embeddings');
  const retained=spool;
  let borrowed=true;
  const source:LlmInputSource={bytes:{async *[Symbol.asyncIterator](){
   if(!borrowed)throw new FsError('EBADF',{message:'Embedding source lease is closed'});
   for await(const bytes of retained.replay()){
    if(!borrowed)throw new FsError('EBADF',{message:'Embedding source lease is closed'});
    yield bytes;
   }
  }},async dispose(){borrowed=false;}};
  const response=await options.service.embedSources({model:collection.model,inputs:[source],options:{},signal,...(options.binary===undefined?{}:{binary:options.binary})}).finally(()=>{borrowed=false;});
  const vector=response.vectors[0];
  if(response.vectors.length!==1||!vector||!vector.length||vector.some(value=>!Number.isFinite(value)))throw new TypeError('Invalid embedding vector');
  const content:SqliteRecordValue=options.store?{type:options.binary?'blob':'text',size,bytes:{[Symbol.asyncIterator]:()=>retained.replay()[Symbol.asyncIterator]()}}:null;
  await writeEmbeddings(editor,collection.id,[{id,hash,vector,content,metadata,binary:options.binary??false,updated:BigInt(Math.floor(options.now().getTime()/1000))}],signal);
 }catch(error){failed=true;throw error;}
 finally{
  digest.destroy();
  const errors:unknown[]=[];
  for(const close of [()=>input.dispose(),()=>spool?.close(),()=>metadataSpool?.close()])try{await close();}catch(error){errors.push(error);}
  if(!failed&&errors.length)await Promise.reject(errors.length===1?errors[0]:new AggregateError(errors,'Embedding cleanup failed'));
 }
}
