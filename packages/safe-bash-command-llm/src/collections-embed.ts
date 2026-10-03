import {FsError,type FileSystem} from 'safe-bash-contracts';
import {md5} from 'safe-bash-checksum-engine/md5';
import {sqliteRecord,withSqliteStatement,type SqliteFinalizer,type SqliteRecordValue} from 'safe-bash-sqlite-engine/storage';
import type {LlmCollection} from './collections.js';
import type {LlmService} from './service.js';
import type {LlmInputSource,LlmOption} from './types.js';
import {jsonValue} from './json-value.js';
import {createLlmSpool} from './retained-spool.js';
import {sourceBytes} from './request-source.js';

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

const blob=(size:number,bytes:AsyncIterable<Uint8Array>):SqliteRecordValue=>({type:'blob',size,bytes});
const empty={async *[Symbol.asyncIterator](){}};
const scalar=(bytes:Uint8Array)=>blob(bytes.length,{async *[Symbol.asyncIterator](){yield bytes;}});

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
  // Encode bounded chunks even when the provider returns a large vector.
  const encoded:AsyncIterable<Uint8Array>={async *[Symbol.asyncIterator](){
   for(let offset=0;offset<vector.length;offset+=4096){
    signal.throwIfAborted();const bytes=new Uint8Array(Math.min(4096,vector.length-offset)*4),view=new DataView(bytes.buffer);
    for(let index=0;index<bytes.length/4;index++)view.setFloat32(index*4,vector[offset+index]!,true);
    yield bytes;
   }
  }};
  const content=options.store?{type:options.binary?'blob' as const:'text' as const,size,bytes:{[Symbol.asyncIterator]:()=>retained.replay()[Symbol.asyncIterator]()}}:null;
  const idBytes=new TextEncoder().encode(id);
  const idValue:SqliteRecordValue={type:'text',size:idBytes.length,bytes:{async *[Symbol.asyncIterator](){yield idBytes;}}};
  const values:SqliteRecordValue[]=[collection.id,idValue,blob(vector.length*4,encoded),options.binary?null:content,options.binary?content:null,scalar(hash),metadata,BigInt(Math.floor(options.now().getTime()/1000))];
  const record=sqliteRecord(values);
  let pad=-1,tail=-1;
  for(let prefix=0;prefix<=9&&pad<0;prefix++){
   const base=[collection.id,idValue,null,blob(prefix,empty),null,scalar(hash),null];
   const minimum=sqliteRecord([...base,blob(0,empty)]).size;
   for(let extra=0;extra<=9;extra++){
    const count=record.size-minimum-extra;
    if(count>=0&&sqliteRecord([...base,blob(count,empty)]).size===record.size){pad=prefix;tail=count;break;}
   }
  }
  if(pad<0)throw new Error('Unable to represent embedding placeholder');
  let rootPage=0,rowid=0n;
  await editor.withSession(async session=>{
   // Physical field rewrites must never leave caller-defined payload indexes stale.
   await withSqliteStatement(session.module,{...session,signal,sql:"SELECT name FROM sqlite_schema WHERE tbl_name='embeddings' AND (type='trigger' OR (type='index' AND name NOT IN ('sqlite_autoindex_embeddings_1','idx_embeddings_content_hash'))) LIMIT 1"},async query=>{
    for await(const [name]of query.rows([],['text']))throw new Error(`Unsupported embedding schema extension: ${String(name)}`);
   });
   await withSqliteStatement(session.module,{...session,signal,sql:'INSERT OR REPLACE INTO embeddings(collection_id,id,embedding,content,content_blob,content_hash,metadata,updated) VALUES(?,?,NULL,zeroblob(?),NULL,?,NULL,zeroblob(?)) RETURNING rowid'},async query=>{
    for await(const [value]of query.rows([collection.id,id,pad,hash,tail],['integer']))rowid=value as bigint;
   });
   await withSqliteStatement(session.module,{...session,signal,sql:"SELECT rootpage FROM sqlite_schema WHERE name='embeddings'"},async query=>{
    for await(const [value]of query.rows([],['integer']))rootPage=Number(value);
   });
  });
  await editor.rewriteRecord({rootPage,rowid,record});
 }catch(error){failed=true;throw error;}
 finally{
  digest.destroy();
  const errors:unknown[]=[];
  for(const close of [()=>input.dispose(),()=>spool?.close(),()=>metadataSpool?.close()])try{await close();}catch(error){errors.push(error);}
  if(!failed&&errors.length)await Promise.reject(errors.length===1?errors[0]:new AggregateError(errors,'Embedding cleanup failed'));
 }
}
