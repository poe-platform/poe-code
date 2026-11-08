import {hasUnpairedSurrogate,pythonSurrogateId} from "./python-unicode.js";
import {sqliteRecord,withSqliteStatement,type SqliteFinalizer,type SqliteRecordValue} from 'safe-bash-sqlite-engine/storage';
export interface StoredEmbedding {
 readonly [pythonSurrogateId]?:true|undefined;readonly id:string;readonly hash:Uint8Array;readonly vector:readonly number[];
 readonly content:SqliteRecordValue;readonly metadata:SqliteRecordValue;readonly binary:boolean;readonly updated:bigint;
}
const blob=(size:number,bytes:AsyncIterable<Uint8Array>):SqliteRecordValue=>({type:'blob',size,bytes});
const empty={async *[Symbol.asyncIterator](){}};
const scalar=(bytes:Uint8Array)=>blob(bytes.length,{async *[Symbol.asyncIterator](){yield bytes;}});

/** Insert indexed placeholders natively, then stream final records through one
 * immutable snapshot per batch. Repeated IDs retain their final replacement. */
export async function writeEmbeddings(editor:SqliteFinalizer,collectionId:bigint,entries:readonly StoredEmbedding[],signal:AbortSignal):Promise<void>{
 const records=new Map<string,{rowid:bigint;record:ReturnType<typeof sqliteRecord>}>();let rootPage=0;
 await editor.withSession(async session=>{
  await withSqliteStatement(session.module,{...session,signal,sql:"SELECT name FROM sqlite_schema WHERE tbl_name='embeddings' AND (type='trigger' OR (type='index' AND name NOT IN ('sqlite_autoindex_embeddings_1','idx_embeddings_content_hash'))) LIMIT 1"},async query=>{
   for await(const [name]of query.rows([],['text']))throw new Error(`Unsupported embedding schema extension: ${String(name)}`);
  });
  for(const entry of entries){
   const {id,vector,content,metadata,hash,binary,updated}=entry;
   if(!vector.length||vector.some(value=>!Number.isFinite(value)))throw new TypeError('Invalid embedding vector');
   const encoded:AsyncIterable<Uint8Array>={async *[Symbol.asyncIterator](){
    for(let offset=0;offset<vector.length;offset+=4096){
     signal.throwIfAborted();const bytes=new Uint8Array(Math.min(4096,vector.length-offset)*4),view=new DataView(bytes.buffer);
     for(let index=0;index<bytes.length/4;index++)view.setFloat32(index*4,vector[offset+index]!,true);
     yield bytes;
    }
   }};
   if(entry[pythonSurrogateId]||hasUnpairedSurrogate(id))throw new TypeError('surrogates not allowed');
   const idBytes=new TextEncoder().encode(id);
   const idValue:SqliteRecordValue={type:'text',size:idBytes.length,bytes:{async *[Symbol.asyncIterator](){yield idBytes;}}};
   const record=sqliteRecord([collectionId,idValue,blob(vector.length*4,encoded),binary?null:content,binary?content:null,scalar(hash),metadata,updated]);
   let pad=-1,tail=-1;
   for(let prefix=0;prefix<=9&&pad<0;prefix++){
    const base=[collectionId,idValue,null,blob(prefix,empty),null,scalar(hash),null],minimum=sqliteRecord([...base,blob(0,empty)]).size;
    for(let extra=0;extra<=9;extra++){
     const count=record.size-minimum-extra;
     if(count>=0&&sqliteRecord([...base,blob(count,empty)]).size===record.size){pad=prefix;tail=count;break;}
    }
   }
   if(pad<0)throw new Error('Unable to represent embedding placeholder');
   await withSqliteStatement(session.module,{...session,signal,sql:'INSERT OR REPLACE INTO embeddings(collection_id,id,embedding,content,content_blob,content_hash,metadata,updated) VALUES(?,?,NULL,zeroblob(?),NULL,?,NULL,zeroblob(?)) RETURNING rowid'},async query=>{
    for await(const [value]of query.rows([collectionId,id,pad,hash,tail],['integer']))records.set(id,{rowid:value as bigint,record});
   });
  }
  await withSqliteStatement(session.module,{...session,signal,sql:"SELECT rootpage FROM sqlite_schema WHERE name='embeddings'"},async query=>{
   for await(const [value]of query.rows([],['integer']))rootPage=Number(value);
  });
 });
 if(records.size)await editor.rewriteRecords({async *[Symbol.asyncIterator](){for(const entry of records.values())yield {rootPage,...entry};}});
}
