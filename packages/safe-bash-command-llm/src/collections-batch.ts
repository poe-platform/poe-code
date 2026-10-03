import {hasUnpairedSurrogate} from "./python-unicode.js";
import {FsError,type FileSystem} from 'safe-bash-contracts';
import {md5} from 'safe-bash-checksum-engine/md5';
import {withSqliteStatement,type SqliteFinalizer,type SqliteRecordValue} from 'safe-bash-sqlite-engine/storage';
import type {LlmCollection} from './collections.js';
import type {LlmService} from './service.js';
import type {LlmInputSource,LlmOption} from './types.js';
import {sourceBytes,waitForSource} from './request-source.js';
import {createLlmSpool} from './retained-spool.js';
import {jsonValue} from './json-value.js';
import {writeEmbeddings,type StoredEmbedding} from './collections-write.js';

export interface LlmCollectionBatchEntry {readonly id:string;readonly input:LlmInputSource;readonly binary?:boolean;readonly metadata?:Readonly<Record<string,LlmOption>>}
export interface LlmCollectionBatchOptions {
 readonly service:LlmService;readonly entries:AsyncIterable<LlmCollectionBatchEntry>;
 readonly directory:string;readonly maxInputBytes:number;readonly batchSize?:number;
 readonly binary?:boolean;readonly store?:boolean;
}
type Spool=Awaited<ReturnType<typeof createLlmSpool>>;
type Staged={binary:boolean;id:string;hash:Uint8Array;input:Spool;size:number;metadata:SqliteRecordValue};
const hashKey=(bytes:Uint8Array)=>Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');

export async function embedCollectionBatch(editor:SqliteFinalizer,options:LlmCollectionBatchOptions & {fs:FileSystem;signal:AbortSignal;collection:LlmCollection;now:()=>Date}):Promise<void>{
 const {signal,service,collection}=options;
 if(options.binary!==undefined&&typeof options.binary!=='boolean')throw new TypeError('Invalid embedding binary flag');
 if(!service.embedSources)throw new Error('LLM service does not support streamed embeddings');
 if(options.maxInputBytes!==Infinity&&(!Number.isSafeInteger(options.maxInputBytes)||options.maxInputBytes<0))throw new RangeError('Invalid embedding input byte limit');
 const requested=options.batchSize??100,modelSize=service.resolve(collection.model).model.embeddingBatchSize??requested;
 if(!Number.isSafeInteger(requested)||requested<1||!Number.isSafeInteger(modelSize)||modelSize<1)throw new RangeError('Invalid embedding batch size');
 const batchSize=Math.min(requested,modelSize),iterator=options.entries[Symbol.asyncIterator]();let ended=false,failed=false;
 let pending:Promise<IteratorResult<LlmCollectionBatchEntry>>|undefined;
 try{
  while(!ended){
   const staged:Staged[]=[],spools:Spool[]=[];let used=0,batchFailed=false;
   const admit=(size:number)=>{if(size>options.maxInputBytes-used)throw new RangeError('Embedding input byte limit exceeded');used+=size;};
   try{
    for(let index=0;index<batchSize;index++){
     signal.throwIfAborted();pending=Promise.resolve().then(()=>iterator.next());
     const next=await waitForSource(()=>pending!,signal);pending=undefined;if(next.done){ended=true;break;}
     const entry=next.value;let entryFailed=false;
     const digest=md5.create();
     try{
      if(typeof entry.id!=='string')throw new TypeError('Embedding ID must be a string');
      const input=await createLlmSpool(options.fs,options.directory,signal,'input');spools.push(input);
      if(entry.binary!==undefined&&typeof entry.binary!=='boolean')throw new TypeError('Invalid embedding binary flag');
      const binary=entry.binary??options.binary??false;
      const decoder=binary?undefined:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});let size=0;
      for await(const bytes of sourceBytes(entry.input.bytes,signal)){
       admit(bytes.length);size+=bytes.length;
       for(let offset=0;offset<bytes.length;offset+=16384){const chunk=bytes.subarray(offset,offset+16384);decoder?.decode(chunk,{stream:true});digest.update(chunk);await input.write(chunk);}
      }
      decoder?.decode();let metadata:SqliteRecordValue=null;
      if(entry.metadata&&Object.keys(entry.metadata).length){
       const retained=await createLlmSpool(options.fs,options.directory,signal,'input');spools.push(retained);let metadataSize=0;
       for await(const chunk of jsonValue(entry.metadata,signal)){admit(chunk.length);metadataSize+=chunk.length;await retained.write(chunk);}
       metadata={type:'text',size:metadataSize,bytes:{[Symbol.asyncIterator]:()=>retained.replay()[Symbol.asyncIterator]()}};
      }
      staged.push({binary,id:entry.id,hash:digest.digest(),input,size,metadata});
     }catch(error){entryFailed=true;throw error;}
     finally{digest.destroy();try{await entry.input.dispose();}catch(error){if(!entryFailed)await Promise.reject(error);}}
    }
    if(!staged.length)continue;
    const hashes=new Set(staged.map(entry=>hashKey(entry.hash))),filtered:Staged[]=[];
    // Query each candidate ID instead of retaining an unbounded list of every
    // existing ID with a matching content hash.
    await editor.withSession(async session=>{
     await withSqliteStatement(session.module,{...session,signal,sql:'SELECT content_hash FROM embeddings WHERE collection_id=? AND id=?'},async query=>{
      for(const entry of staged){
       // A Python SQLite TEXT ID cannot contain a lone surrogate. It cannot
       // match a stored ID, and Python reports its encoding failure only after
       // the provider call when inserting the result. Never query a lossy ID.
       if(entry.id.length<=65536&&hasUnpairedSurrogate(entry.id)){
        if(new TextEncoder().encode(entry.id).length>65536)throw new RangeError('SQLite binding exceeds scalar byte budget');
        filtered.push(entry);continue;
       }
       let skip=false;
       for await(const [hash]of query.rows([collection.id,entry.id],['blob']))if(hash instanceof Uint8Array&&hashes.has(hashKey(hash)))skip=true;
       if(!skip)filtered.push(entry);
      }
     });
    });
    if(!filtered.length)continue;
    let borrowed=true;
    const inputs=filtered.map(entry=>({async dispose(){},bytes:{async *[Symbol.asyncIterator](){
     if(!borrowed)throw new FsError('EBADF',{message:'Embedding source lease is closed'});
     for await(const chunk of entry.input.replay()){if(!borrowed)throw new FsError('EBADF',{message:'Embedding source lease is closed'});yield chunk;}
    }}}));
    const mixed=filtered.some(entry=>entry.binary!==filtered[0]!.binary);
    const kinds=mixed?{inputTypes:filtered.map(entry=>entry.binary?'binary' as const:'text' as const)}:{binary:filtered[0]!.binary};
    const response=await service.embedSources({model:collection.model,inputs,options:{},signal,...kinds}).finally(()=>{borrowed=false;});
    if(response.vectors.length!==filtered.length)throw new TypeError('Invalid embedding response');
    const records:StoredEmbedding[]=filtered.map((entry,index)=>({id:entry.id,hash:entry.hash,vector:response.vectors[index]!,metadata:entry.metadata,binary:entry.binary,updated:BigInt(Math.floor(options.now().getTime()/1000)),content:options.store?{type:entry.binary?'blob':'text',size:entry.size,bytes:{[Symbol.asyncIterator]:()=>entry.input.replay()[Symbol.asyncIterator]()}}:null}));
    await writeEmbeddings(editor,collection.id,records,signal);
   }catch(error){batchFailed=true;throw error;}
   finally{
    const errors:unknown[]=[];for(const spool of spools)try{await spool.close();}catch(error){errors.push(error);}
    if(!batchFailed&&errors.length)await Promise.reject(new AggregateError(errors,'Embedding batch cleanup failed'));
   }
  }
 }catch(error){failed=true;throw error;}
 finally{
  if(pending)void pending.then(async next=>{if(!next.done)await next.value.input.dispose();}).catch(()=>undefined);
  if(!ended){
   const returned=Promise.resolve().then(()=>iterator.return?.());
   if(signal.aborted)void returned.catch(()=>undefined);
   else try{await waitForSource(()=>returned,signal);}catch(error){if(!failed)await Promise.reject(error);}
  }
 }
}
