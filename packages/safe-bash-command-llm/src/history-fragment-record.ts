import {sha256} from '@noble/hashes/sha2.js';
import {toByteSource,type ByteSource} from 'safe-bash-contracts';
import {yieldTurn} from 'safe-bash-contracts/yield';
import type {PrivateSqliteSession} from './sqlite-session.js';
import type {SqliteFinalizer} from './sqlite-finalization.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {sqliteRecord} from './sqlite-record.js';
import {sqliteSchemaTokens} from './sqlite-schema-tokens.js';
import {sqliteSourceChunks} from './sqlite-stream.js';
import {historySchemaStatements} from './history-schema.js';

/** Reopen the same retained UTF-8 content for hashing and publication. Replay is
 * verified against the first digest, so mutation cannot publish stale identity. */
export async function prepareLlmFragmentRecord(session:PrivateSqliteSession,fragment:{readonly content:()=>ByteSource;readonly source?:string|null},signal:AbortSignal):Promise<{id:bigint;hash:string;finalize?:(editor:SqliteFinalizer)=>Promise<void>}>{
 const {content,source=null}=fragment;
 let size=0,identity='';
 async function* scan(replay:boolean):AsyncGenerator<Uint8Array>{
  const hash=sha256.create(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});let total=0;
  try{
   for await(const chunk of sqliteSourceChunks(content(),signal)){
    if(!(chunk instanceof Uint8Array))throw new TypeError('Fragment content must yield bytes');
    await yieldTurn(signal);
    for(let offset=0;offset<chunk.length;offset+=16384){
     const bytes=chunk.slice(offset,offset+16384);total+=bytes.length;
     if(total>0x7fffffff||replay&&total>size)throw new RangeError('Fragment length changed or exceeds native storage');
     decoder.decode(bytes,{stream:true});hash.update(bytes);
     yield bytes;await yieldTurn(signal);
    }
   }
   decoder.decode();signal.throwIfAborted();
   const digest=Array.from(hash.digest(),byte=>byte.toString(16).padStart(2,'0')).join('');
   if(replay){if(total!==size||digest!==identity)throw new Error('Fragment content changed during replay');}
   else{size=total;identity=digest;}
  }finally{hash.destroy();}
 }
 for await(const unused of scan(false))void unused;
 let rootPage=0,hashIndex=false;
 await withSqliteStatement(session.module,{...session,signal,sql:"SELECT type,COALESCE(sql,''),rootpage FROM sqlite_schema WHERE tbl_name='fragments'"},async q=>{
  for await(const [type,sql,page]of q.rows([],['text','text','integer'])){
   if(type==='table'){
    if(sqliteSchemaTokens(sql as string)!==sqliteSchemaTokens(historySchemaStatements.find(value=>value.startsWith('CREATE TABLE "fragments"'))!))throw new Error('Fragment streaming requires the pinned table definition');
    rootPage=Number(page);
   }else if(type==='index'&&sqliteSchemaTokens(sql as string)===sqliteSchemaTokens(historySchemaStatements.find(value=>value.startsWith('CREATE UNIQUE INDEX "idx_fragments_hash"'))!))hashIndex=true;
   else throw new Error('Fragment streaming requires index/trigger-aware custom-schema handling');
  }
 });
 if(!rootPage||!hashIndex)throw new Error('Missing history fragment table or hash index');
 await withSqliteStatement(session.module,{...session,signal,sql:'PRAGMA encoding'},async q=>{for await(const row of q.rows([],['text']))if(row[0]!=='UTF-8')throw new Error('Fragment streaming requires UTF-8 storage');});
 let id:bigint|undefined,date='';
 await withSqliteStatement(session.module,{...session,signal,sql:"INSERT INTO fragments(hash,content,datetime_utc,source) VALUES(?,zeroblob(?),datetime('now'),?) ON CONFLICT(hash) DO NOTHING RETURNING id,datetime_utc"},async insert=>{
  for await(const row of insert.rows([identity,BigInt(size),source],['integer','text'])){id=row[0] as bigint;date=row[1] as string;}
 });
 if(id===undefined){
  await withSqliteStatement(session.module,{...session,signal,sql:'SELECT id FROM fragments WHERE hash=?'},async q=>{for await(const row of q.rows([identity],['integer']))id=row[0] as bigint;});
  if(id===undefined)throw new Error('Missing deduplicated fragment');
  return {id,hash:identity};
 }
 const text=(value:string)=>{const bytes=new TextEncoder().encode(value);return {type:'text' as const,size:bytes.length,bytes:toByteSource(bytes)};};
 const rowid=id,record=sqliteRecord([null,text(identity),{type:'text',size,bytes:scan(true)},text(date),source===null?null:text(source)]);
 return {id,hash:identity,finalize:editor=>editor.rewriteRecord({rootPage,rowid,record})};
}
