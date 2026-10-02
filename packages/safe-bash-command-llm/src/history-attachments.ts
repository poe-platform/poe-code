import type {ByteSource} from 'safe-bash-contracts';
import type {PrivateSqliteSession} from './sqlite-session.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {writeSqliteBlob} from './sqlite-blob.js';
import {sqliteSourceChunks} from './sqlite-stream.js';
import {sqliteSchemaTokens} from './sqlite-schema-tokens.js';
import {historySchemaStatements} from './history-schema.js';

export interface LlmHistoryAttachment {
 readonly id:string;
 readonly type?:string|null;
 readonly path?:string|null;
 readonly url?:string|null;
 readonly content?:{readonly size:number;readonly bytes:ByteSource}|null;
}

/** Store already-resolved attachment identities and metadata with the pinned
 * replace semantics. Content is written through native incremental BLOB I/O;
 * no source is materialized. The surrounding transaction owns publication. */
export async function writeLlmHistoryAttachments(
 session:PrivateSqliteSession,
 owner:{readonly responseId:string}|{readonly toolResultId:bigint},
 attachments:AsyncIterable<LlmHistoryAttachment>,
 signal:AbortSignal,
):Promise<void>{
 const tool='toolResultId' in owner;
 const ownerId=tool?owner.toolResultId:owner.responseId;
 const table=tool?'tool_results_attachments':'prompt_attachments';
 const ownerColumn=tool?'tool_result_id':'response_id';
 // Incremental blob writes bypass SQL triggers/check evaluation. Admit only
 // the known attachment table so custom constraints cannot observe zeros.
 let valid=false;
 await withSqliteStatement(session.module,{...session,signal,sql:"SELECT type,COALESCE(sql,'') FROM sqlite_schema WHERE tbl_name='attachments'"},async query=>{
  for await(const [type,sql]of query.rows([],['text','text'])){
   if(type==='table')valid=sqliteSchemaTokens(sql as string)===sqliteSchemaTokens(historySchemaStatements.find(value=>value.startsWith('CREATE TABLE "attachments"'))!);
   else if(type==='trigger'||type==='index'&&sql!=='')throw new Error('Attachment streaming requires index/trigger-aware custom-schema handling');
  }
 });
 if(!valid)throw new Error('Attachment streaming requires the pinned table definition');
 await session.execute('SAVEPOINT llm_history_attachments');
 try{
  await withSqliteStatement(session.module,{...session,signal,sql:'INSERT OR REPLACE INTO attachments(id,type,path,url,content) VALUES(?,?,?,?,CASE WHEN ? IS NULL THEN NULL ELSE zeroblob(?) END) RETURNING rowid'},async insert=>
   withSqliteStatement(session.module,{...session,signal,sql:`INSERT INTO ${table}(${ownerColumn},attachment_id,"order") VALUES(?,?,?)`},async link=>{
    let order=0n;
    for await(const attachment of sqliteSourceChunks(attachments,signal)){
     const {id,type=null,path=null,url=null}=attachment,content=attachment.content;
     const size=content?.size??null,bytes=content?.bytes;
     if(size!==null&&(!Number.isSafeInteger(size)||size<0||size>0x7fffffff))throw new RangeError('Invalid attachment content length');
     const length=size===null?null:BigInt(size);
     let rowid!:bigint;
     for await(const row of insert.rows([id,type,path,url,length,length],['integer']))rowid=row[0] as bigint;
     if(size!==null)await writeSqliteBlob(session.module,{...session,signal,table:'attachments',column:'content',rowid,size,source:bytes!});
     for await(const unused of link.rows([ownerId,id,order++],[]))void unused;
    }
   }));
  await session.execute('RELEASE llm_history_attachments');
 }catch(error){
  try{await session.execute('ROLLBACK TO llm_history_attachments; RELEASE llm_history_attachments');}
  catch(rollback){throw new AggregateError([error,rollback],'Attachment persistence and rollback failed');}
  throw error;
 }
}
