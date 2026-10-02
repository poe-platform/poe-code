import type {ByteSource} from 'safe-bash-contracts';
import {transactSqlite} from './sqlite-transaction.js';
import type {SqliteFinalizer} from './sqlite-finalization.js';
import {migrateLlmHistorySchema} from './history-migrations.js';
import {writeLlmHistoryConversation} from './history-conversation.js';
import {prepareLlmSchemaRecord} from './history-schema-record.js';
import {prepareLlmResponseRecord,type LlmResponseRecord} from './history-response-record.js';
import {prepareLlmFragmentRecord} from './history-fragment-record.js';
import {writeLlmHistoryAttachments,type LlmHistoryAttachment} from './history-attachments.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {sqliteSourceChunks} from './sqlite-stream.js';

export interface LlmHistoryFragment {
 readonly kind:'prompt'|'system';
 readonly content:()=>ByteSource;
 readonly source?:string|null;
}
export interface LlmHistoryPersistenceInput {
 /** Provider JSON must already have reference replacements applied. */
 readonly response:Omit<LlmResponseRecord,'conversation_id'|'schema_id'>;
 readonly conversation:{readonly id:string;readonly model:string;readonly nameSource:ByteSource};
 /** Admitted schema control JSON; its canonical expansion is streamed. */
 readonly schemaJson?:string;
 readonly fragments?:AsyncIterable<LlmHistoryFragment>;
 readonly attachments?:AsyncIterable<LlmHistoryAttachment>;
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
