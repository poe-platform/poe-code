import {blake2b} from '@noble/hashes/blake2.js';
import {toByteSource} from 'safe-bash-contracts';
import type {PrivateSqliteSession} from './sqlite-session.js';
import type {SqliteFinalizer} from './sqlite-finalization.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {sqliteRecord} from './sqlite-record.js';
import {sqliteSchemaTokens} from './sqlite-schema-tokens.js';
import {schemaJsonChunks} from './schema-json.js';
import {historySchemaStatements} from './history-schema.js';

/** Schema JSON is an admitted control value. Its expanded canonical form is
 * counted/hashed once and streamed again during closed-file TEXT finalization.
 * The surrounding transaction must run the returned finalizer before publish. */
export async function prepareLlmSchemaRecord(session:PrivateSqliteSession,json:string,signal:AbortSignal):Promise<{id:string;finalize?:(editor:SqliteFinalizer)=>Promise<void>}>{
 const encoder=new TextEncoder(),hash=blake2b.create({dkLen:16});let size=0;
 try{
  for await(const chunk of schemaJsonChunks(json,signal,{compact:true,trailingNewline:false})){
   const bytes=encoder.encode(chunk);hash.update(bytes);size+=bytes.length;
   if(!Number.isSafeInteger(size)||size>0x7fffffff)throw new RangeError('Schema text exceeds native SQLite record length');
  }
  const id=Array.from(hash.digest(),byte=>byte.toString(16).padStart(2,'0')).join('');
  let rootPage=0;
  await withSqliteStatement(session.module,{...session,signal,sql:"SELECT type,COALESCE(sql,''),rootpage FROM sqlite_schema WHERE tbl_name='schemas'"},async query=>{
   for await(const [type,sql,page]of query.rows([],['text','text','integer'])){
    if(type==='table'){
     if(sqliteSchemaTokens(sql as string)!==sqliteSchemaTokens(historySchemaStatements.find(value=>value.startsWith('CREATE TABLE "schemas"'))!))throw new Error('Schema streaming requires the pinned table definition');
     rootPage=Number(page);
    }else if(type==='trigger'||type==='index'&&sql!=='')throw new Error('Schema streaming requires index/trigger-aware custom-schema handling');
   }
  });
  if(!rootPage)throw new Error('Missing history schemas table');
  await withSqliteStatement(session.module,{...session,signal,sql:'PRAGMA encoding'},async q=>{for await(const row of q.rows([],['text']))if(row[0]!=='UTF-8')throw new Error('Schema streaming requires UTF-8 storage');});
  let rowid:bigint|undefined;
  await withSqliteStatement(session.module,{...session,signal,sql:'INSERT OR IGNORE INTO schemas(id,content) VALUES(?,zeroblob(?)) RETURNING rowid'},async insert=>{for await(const row of insert.rows([id,BigInt(size)],['integer']))rowid=row[0] as bigint;});
  if(rowid===undefined)return {id};
  const record=sqliteRecord([{type:'text',size:32,bytes:toByteSource(id)},{type:'text',size,bytes:(async function*(){
   for await(const chunk of schemaJsonChunks(json,signal,{compact:true,trailingNewline:false}))yield encoder.encode(chunk);
  })()}]);
  const inserted=rowid;
  return {id,finalize:editor=>editor.rewriteRecord({rootPage,rowid:inserted,record})};
 }finally{hash.destroy();}
}
