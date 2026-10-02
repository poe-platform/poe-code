import type { CommandContext } from 'safe-bash-contracts';
import { pathOf } from 'safe-bash-contracts/path';
import { createLlmConfiguration } from './configuration.js';
import { transactSqlite } from './sqlite-transaction.js';
import { migrateLlmHistorySchema } from './history-migrations.js';
import { withSqliteStatement } from './sqlite-statement.js';
import { readSqliteBlob } from './sqlite-blob-read.js';
import type { LlmStoredSchemaOptions } from './stored-schema.js';

export interface LlmStoredSchemaUsage {
 readonly id: string;
 /** Original JSON text, preserving integer precision and object insertion order. */
 readonly content: string;
 readonly recentlyUsed: string | null;
 readonly timesUsed: bigint;
}

/** Visit used schemas in pinned least-recently-used order. Await each consumer
 * before reading the next row; native sorting spills into caller-owned storage.
 * Migrations and sidecar recovery use the same guarded canonical transaction as
 * individual schema reads. A failed consumer prevents publication. */
export async function visitLlmStoredSchemas(
 context: Pick<CommandContext,'fs'|'cwd'|'env'|'signal'>,
 options: Omit<LlmStoredSchemaOptions,'migrate'> & {readonly queries?: readonly string[]},
 visit: (schema: LlmStoredSchemaUsage) => Promise<void>,
): Promise<void> {
 const {fs,signal}=context;
 signal.throwIfAborted();
 const maxBytes=options.maxBytes??Infinity;
 if(maxBytes!==Infinity&&(!Number.isSafeInteger(maxBytes)||maxBytes<0))throw new RangeError('Invalid schema byte limit');
 const path=options.database===undefined?`${createLlmConfiguration(context).directory}/logs.db`:pathOf(context,options.database);
 // Own caller query controls before asynchronous work.
 const queries=options.queries?.slice()??[];
 await fs.stat(path,{signal});
 const result=await transactSqlite({fs,path,signal,maxFileBytes:Number.MAX_SAFE_INTEGER,maxIndexBytes:Number.MAX_SAFE_INTEGER,maxOpenFiles:64},async session=>{
  await migrateLlmHistorySchema(session,signal,new Date().toISOString());
  const encoding=await withSqliteStatement(session.module,{...session,signal,sql:'PRAGMA encoding'},async statement=>{
   for await(const row of statement.rows([],['text']))return String(row[0]).toLowerCase();
   throw new Error('Missing SQLite encoding');
  });
  const read=async(rowid:bigint,column:string):Promise<string>=>{
   const decoder=new TextDecoder(encoding,{fatal:true,ignoreBOM:true});let text='';
   for await(const bytes of readSqliteBlob(session.module,{...session,signal,table:'schemas',column,rowid,...(maxBytes===Infinity?{}:{maxBytes})})){
    options.admitBytes?.(bytes.length);text+=decoder.decode(bytes,{stream:true});
   }
   return text+decoder.decode();
  };
  const where=queries.length?' WHERE '+queries.map(()=>'schemas.content LIKE ?').join(' AND '):'';
  const sql=`SELECT schemas.rowid, COALESCE(MAX(responses.datetime_utc),''), MAX(responses.datetime_utc) IS NULL, COUNT(*) FROM schemas JOIN responses ON responses.schema_id=schemas.id${where} GROUP BY responses.schema_id ORDER BY MAX(responses.datetime_utc)`;
  await withSqliteStatement(session.module,{...session,signal,sql},async statement=>{
   for await(const row of statement.rows(queries.map(query=>'%'+query+'%'),['integer','text','integer','integer'])){
    options.admitBytes?.(new TextEncoder().encode(row[1] as string).length);
    const rowid=row[0] as bigint;
    const id=await read(rowid,'id'),content=await read(rowid,'content');
    await visit({id,content,recentlyUsed:row[2]===1n?null:row[1] as string,timesUsed:row[3] as bigint});
    signal.throwIfAborted();
   }
  });
 });
 if(result.cleanupErrors.length)throw new AggregateError(result.cleanupErrors,'History schema cleanup failed',{cause:{committed:result.committed}});
}
