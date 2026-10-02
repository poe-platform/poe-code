import type {ByteSource} from 'safe-bash-contracts';
import {transactSqlite} from './sqlite-transaction.js';
import {prepareLlmToolEvent,type LlmHistoryToolEvent} from './history-tool-event.js';
import type {PrivateSqliteSession} from './sqlite-session.js';
import type {SqliteFinalizer} from './sqlite-finalization.js';
import {migrateLlmHistorySchema} from './history-migrations.js';
import {writeLlmHistoryConversation} from './history-conversation.js';
import {prepareLlmSchemaRecord} from './history-schema-record.js';
import {prepareLlmResponseRecord,type LlmResponseRecord} from './history-response-record.js';
import {prepareLlmFragmentRecord} from './history-fragment-record.js';
import {writeLlmHistoryAttachments,type LlmHistoryAttachment} from './history-attachments.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {prepareLlmToolRecord,type LlmHistoryTool} from './history-tool-record.js';
import {sqliteSourceChunks} from './sqlite-stream.js';

export interface LlmHistoryFragment {
 readonly kind:'prompt'|'system';
 readonly content:()=>ByteSource;
 readonly source?:string|null;
}
export type LlmHistoryToolCall=Omit<Extract<LlmHistoryToolEvent,{kind:'call'}>,'kind'|'responseId'|'toolId'>;
export type LlmHistoryToolResult=Omit<Extract<LlmHistoryToolEvent,{kind:'result'}>,'kind'|'responseId'|'toolId'>&{
 readonly instance?:Omit<Extract<LlmHistoryToolEvent,{kind:'instance'}>,'kind'>;
 readonly attachments?:AsyncIterable<LlmHistoryAttachment>;
};
export interface LlmHistoryPersistenceInput {
 /** Provider JSON must already have reference replacements applied. */
 readonly response:Omit<LlmResponseRecord,'conversation_id'|'schema_id'>;
 readonly conversation:{readonly id:string;readonly model:string;readonly nameSource:ByteSource};
 /** Admitted schema control JSON; its canonical expansion is streamed. */
 readonly schemaJson?:string;
 readonly fragments?:AsyncIterable<LlmHistoryFragment>;
 readonly attachments?:AsyncIterable<LlmHistoryAttachment>;
 readonly tools?:AsyncIterable<LlmHistoryTool>;
 readonly toolCalls?:AsyncIterable<LlmHistoryToolCall>;
 readonly toolResults?:AsyncIterable<LlmHistoryToolResult>;
}

/** Internal persistence composition, not the provider-facing logger. The caller
 * owns retained response/fragment sources until this promise settles. Metadata,
 * native TEXT/FTS rewrites and links publish as one canonical source-set change.
 * Preserve the committed receipt: cleanup errors must never trigger a retry. */
export async function persistLlmHistoryResponse(
 options:Omit<Parameters<typeof transactSqlite>[0],'finalize'>,
 input:LlmHistoryPersistenceInput,
){
 const {signal}=options,response={...input.response},conversation={...input.conversation};
 let schemaFinal:((editor:SqliteFinalizer)=>Promise<void>)|undefined;
 let responseFinal!:(editor:SqliteFinalizer)=>Promise<void>;
 return transactSqlite({...options,finalize:async editor=>{
  if(schemaFinal)await schemaFinal(editor);
  await responseFinal(editor);
  // Finalize one fragment at a time instead of retaining a closure/source for
  // every fragment. The enclosing private database is still unpublished.
  if(input.fragments){
   const order={prompt:0n,system:0n};
   for await(const fragment of sqliteSourceChunks(input.fragments,signal)){
    if(fragment.kind!=='prompt'&&fragment.kind!=='system')throw new TypeError('Invalid history fragment kind');
    const kind=fragment.kind;
    const prepared=await editor.withSession(async session=>{
     const result=await prepareLlmFragmentRecord(session,fragment,signal);
     await withSqliteStatement(session.module,{...session,signal,sql:`INSERT INTO ${kind}_fragments(response_id,fragment_id,"order") VALUES(?,?,?)`},async link=>{
      for await(const unused of link.rows([response.id,result.id,order[kind]++],[]))void unused;
     });
     return result;
    });
    if(prepared.finalize)await prepared.finalize(editor);
   }
  }
  // Keep insertion order in caller-backed SQLite, not an unbounded JS name map.
  const toolOrder='llm_pending_tools_'+crypto.randomUUID().split('-').join('');
  if(input.tools){
   await editor.withSession(session=>session.execute(`CREATE TABLE "${toolOrder}"(ordinal INTEGER PRIMARY KEY,tool_id INTEGER)`));
   for await(const tool of sqliteSourceChunks(input.tools,signal)){
    const prepared=await editor.withSession(async session=>{
     const result=await prepareLlmToolRecord(session,tool,signal);
     await withSqliteStatement(session.module,{...session,signal,sql:`INSERT INTO "${toolOrder}"(tool_id) VALUES(?)`},async q=>{
      for await(const unused of q.rows([result.id],[]))void unused;
     });
     await withSqliteStatement(session.module,{...session,signal,sql:'INSERT INTO tool_responses(tool_id,response_id) VALUES(?,?)'},async link=>{
      for await(const unused of link.rows([result.id,response.id],[]))void unused;
     });
     return result;
    });
    if(prepared.finalize)await prepared.finalize(editor);
   }
  }
  const resolveTool=async(session:PrivateSqliteSession,name:string):Promise<bigint|null>=>{
   let id:bigint|null=null;
   if(input.tools)await withSqliteStatement(session.module,{...session,signal,sql:`SELECT t.id FROM "${toolOrder}" o JOIN tools t ON t.id=o.tool_id WHERE t.name=? ORDER BY o.ordinal DESC LIMIT 1`},async q=>{
    for await(const row of q.rows([name],['integer']))id=row[0] as bigint;
   });
   return id;
  };
  if(input.toolCalls)for await(const call of sqliteSourceChunks(input.toolCalls,signal)){
   const prepared=await editor.withSession(async session=>prepareLlmToolEvent(session,{...call,kind:'call',responseId:response.id,toolId:await resolveTool(session,call.name)},signal));
   await prepared.finalize(editor);
  }
  if(input.toolResults)for await(const result of sqliteSourceChunks(input.toolResults,signal)){
   if(result.instance&&result.instanceId!=null)throw new TypeError('Supply either a new tool instance or an existing instance ID');
   const prepared=await editor.withSession(async session=>{
    const instance=result.instance?await prepareLlmToolEvent(session,{...result.instance,kind:'instance'},signal):undefined;
    const record=await prepareLlmToolEvent(session,{...result,kind:'result',responseId:response.id,toolId:await resolveTool(session,result.name),instanceId:instance?.id??result.instanceId??null},signal);
    if(result.attachments)await writeLlmHistoryAttachments(session,{toolResultId:record.id},result.attachments,signal);
    return {instance,record};
   });
   if(prepared.instance)await prepared.instance.finalize(editor);
   await prepared.record.finalize(editor);
  }
  if(input.tools)await editor.withSession(session=>session.execute(`DROP TABLE "${toolOrder}"`));
 }},async session=>{
  await migrateLlmHistorySchema(session,signal,new Date().toISOString());
  await writeLlmHistoryConversation(session,conversation,signal);
  let schemaId:string|null=null;
  if(input.schemaJson!==undefined){
   const schema=await prepareLlmSchemaRecord(session,input.schemaJson,signal);
   schemaId=schema.id;schemaFinal=schema.finalize;
  }
  responseFinal=await prepareLlmResponseRecord(session,{...response,conversation_id:conversation.id,schema_id:schemaId},signal);
  if(input.attachments)await writeLlmHistoryAttachments(session,{responseId:response.id},input.attachments,signal);
  return response.id;
 });
}
