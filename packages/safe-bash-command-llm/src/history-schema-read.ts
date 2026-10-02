import type { FileSystem } from 'safe-bash-contracts';
import { transactSqlite } from './sqlite-transaction.js';
import { migrateLlmHistorySchema } from './history-migrations.js';
import { withSqliteStatement } from './sqlite-statement.js';
import { readSqliteBlob } from './sqlite-blob-read.js';

export async function readMigratedHistorySchema(fs: FileSystem, path: string, id: string, signal: AbortSignal, options: {
  maxBytes?: number; admitBytes?: (size: number) => void;
}): Promise<string | undefined> {
  const result = await transactSqlite({fs,path,signal,maxFileBytes:Number.MAX_SAFE_INTEGER,maxIndexBytes:Number.MAX_SAFE_INTEGER,maxOpenFiles:64}, async session => {
    await migrateLlmHistorySchema(session,signal,new Date().toISOString());
    const rowid = await withSqliteStatement(session.module,{...session,signal,sql:'SELECT rowid FROM schemas WHERE id=?'},async statement => {
      for await (const row of statement.rows([id],['integer'])) return row[0] as bigint;
      return undefined;
    });
    if (rowid === undefined) return undefined;
    const encoding = await withSqliteStatement(session.module,{...session,signal,sql:'PRAGMA encoding'},async statement => {
      for await (const row of statement.rows([],['text'])) return String(row[0]).toLowerCase();
      throw new Error('Missing SQLite encoding');
    });
    const decoder = new TextDecoder(encoding,{fatal:true,ignoreBOM:true});
    let text = '';
    for await (const bytes of readSqliteBlob(session.module,{...session,signal,table:'schemas',column:'content',rowid,...(options.maxBytes===undefined?{}:{maxBytes:options.maxBytes})})) {
      options.admitBytes?.(bytes.length); text += decoder.decode(bytes,{stream:true});
    }
    text += decoder.decode();
    return text;
  });
  if (result.cleanupErrors.length) throw new AggregateError(result.cleanupErrors,'History schema cleanup failed',{cause:{committed:result.committed}});
  return result.value;
}
