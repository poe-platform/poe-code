import {yieldTurn} from 'safe-bash-contracts/yield';
import {toByteSource,type ByteSource} from 'safe-bash-contracts';
import type {PrivateSqliteSession} from './sqlite-session.js';
import type {SqliteFinalizer} from './sqlite-finalization.js';
import {withSqliteStatement,type SqliteBinding} from './sqlite-statement.js';
import {sqliteRecord,type SqliteRecordValue} from './sqlite-record.js';
import {sqliteSchemaTokens} from './sqlite-schema-tokens.js';
import {historySchemaStatements} from './history-schema.js';
import {sqliteSourceChunks} from './sqlite-stream.js';

export interface LlmHistoryText {readonly size:number;readonly bytes:ByteSource}
interface ToolEventOwner {readonly responseId:string;readonly toolId?:bigint|null;readonly name:string;readonly toolCallId?:string|null}
/** JSON fields are already serialized with reference Python JSON semantics.
 * Large payloads must use the known-length source form. */
export type LlmHistoryToolEvent=
 | {readonly kind:'instance';readonly plugin?:string|null;readonly name:string;readonly arguments:LlmHistoryText}
 | ToolEventOwner&{readonly kind:'call';readonly arguments:LlmHistoryText}
 | ToolEventOwner&{readonly kind:'result';readonly output:LlmHistoryText|string|null;readonly instanceId?:bigint|null;readonly exception?:string|null};

/** Insert a native row and return its mandatory closed-file TEXT finalizer.
 * The surrounding canonical transaction owns source lifetime and publication. */
export async function prepareLlmToolEvent(session:PrivateSqliteSession,event:LlmHistoryToolEvent,signal:AbortSignal):Promise<{id:bigint;finalize:(editor:SqliteFinalizer)=>Promise<void>}>{
 let table:string,columns:string[],values:(string|bigint|null|LlmHistoryText)[];
 if(event.kind==='instance'){
  table='tool_instances';columns=['plugin','name','arguments'];values=[event.plugin??null,event.name,event.arguments];
 }else if(event.kind==='call'){
  table='tool_calls';columns=['response_id','tool_id','name','arguments','tool_call_id'];values=[event.responseId,event.toolId??null,event.name,event.arguments,event.toolCallId??null];
 }else if(event.kind==='result'){
  table='tool_results';columns=['response_id','tool_id','name','output','tool_call_id','instance_id','exception'];values=[event.responseId,event.toolId??null,event.name,event.output,event.toolCallId??null,event.instanceId??null,event.exception??null];
 }else throw new TypeError('Invalid history tool event kind');
 let rootPage=0;
 await withSqliteStatement(session.module,{...session,signal,sql:'SELECT type,COALESCE(sql,\'\'),rootpage FROM sqlite_schema WHERE tbl_name=?'},async q=>{
  for await(const [type,sql,page]of q.rows([table],['text','text','integer'])){
   if(type!=='table')throw new Error('Tool event streaming requires index/trigger-aware custom-schema handling');
   if(sqliteSchemaTokens(sql as string)!==sqliteSchemaTokens(historySchemaStatements.find(value=>value.startsWith('CREATE TABLE "'+table+'"'))!))throw new Error('Tool event streaming requires the pinned table definition');
   rootPage=Number(page);
  }
 });
 if(!rootPage)throw new Error('Missing history tool event table');
 await withSqliteStatement(session.module,{...session,signal,sql:'PRAGMA encoding'},async q=>{for await(const row of q.rows([],['text']))if(row[0]!=='UTF-8')throw new Error('Tool event streaming requires UTF-8 storage');});
 const expressions:string[]=[],bindings:SqliteBinding[]=[],fields:SqliteRecordValue[]=[null];
 for(const value of values){
  if(value!==null&&typeof value==='object'){
   if(!Number.isSafeInteger(value.size)||value.size<0||value.size>0x7fffffff)throw new RangeError('Invalid tool event text size');
   const {size,bytes}=value;
   expressions.push('zeroblob(?)');bindings.push(BigInt(size));
   fields.push({type:'text',size,bytes:{async *[Symbol.asyncIterator](){
    const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
    for await(const chunk of sqliteSourceChunks(bytes,signal)){
     await yieldTurn(signal);
     if(!(chunk instanceof Uint8Array))throw new TypeError('Tool event text must yield bytes');
     for(let offset=0;offset<chunk.length;offset+=16384){
      signal.throwIfAborted();const part=chunk.subarray(offset,offset+16384);
      decoder.decode(part,{stream:true});yield part;
     }
    }
    decoder.decode();
   }}});
  }else{
   expressions.push('?');bindings.push(value);
   if(typeof value==='string'){
    if(value.length>65536)throw new RangeError('SQLite control exceeds byte budget');
    for(let index=0;index<value.length;index++){
     if(index%4096===0)await yieldTurn(signal);
     const code=value.charCodeAt(index);
     if(code>=0xd800&&code<=0xdbff){const low=value.charCodeAt(++index);if(!(low>=0xdc00&&low<=0xdfff))throw new TypeError('Invalid Unicode in tool event metadata');}
     else if(code>=0xdc00&&code<=0xdfff)throw new TypeError('Invalid Unicode in tool event metadata');
    }
    const bytes=new TextEncoder().encode(value);fields.push({type:'text',size:bytes.length,bytes:toByteSource(bytes)});
   }
   else fields.push(value);
  }
 }
 const record=sqliteRecord(fields);let id!:bigint;
 await withSqliteStatement(session.module,{...session,signal,sql:`INSERT INTO ${table}(${columns.map(column=>'"'+column+'"').join(',')}) VALUES(${expressions.join(',')}) RETURNING id`},async insert=>{
  for await(const row of insert.rows(bindings,['integer']))id=row[0] as bigint;
 });
 return {id,finalize:editor=>editor.rewriteRecord({rootPage,rowid:id,record})};
}
