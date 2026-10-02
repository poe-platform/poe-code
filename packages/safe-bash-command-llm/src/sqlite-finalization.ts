import { FsError } from 'safe-bash-contracts';
import { withPrivateSqliteSession, type PrivateSqliteSession } from './sqlite-session.js';
import { rewriteSqliteRecord } from './sqlite-record-write.js';
import type { SqliteFileSystem } from './sqlite-vfs.js';
import type { sqliteRecord } from './sqlite-record.js';

export interface SqliteFinalizer {
 /** Equal-sized private placeholder rewrite; caller owns index/trigger semantics. */
 rewriteRecord(options: {rootPage: number; rowid: bigint; record: ReturnType<typeof sqliteRecord>}): Promise<void>;
 /** Reopen a native connection only after all earlier rewrites have completed. */
 withSession<T>(operation: (session: PrivateSqliteSession) => Promise<T>): Promise<T>;
}

/** Serialize closed-file edits and native validation. Even a caught or unawaited
 * failed phase poisons publication; no phase can outlive the private owner. */
export async function finalizeSqlite(options: {
 fs: SqliteFileSystem; directory: string; path: string; signal: AbortSignal;
 maxOpenFiles: number; maxFileBytes: number;
}, operation: (editor: SqliteFinalizer) => Promise<void>): Promise<void> {
 let accepting=true,busy:Promise<unknown>|undefined;
 const errors:unknown[]=[];
 const remember=(error:unknown):void=>{if(!errors.includes(error))errors.push(error);};
 const run=<T>(action:()=>Promise<T>):Promise<T>=>{
  if(!accepting)return Promise.reject(new FsError('EBADF',{message:'SQLite finalization is closed'}));
  if(busy){const error=new FsError('EBUSY',{message:'SQLite finalization phases overlap'});remember(error);return Promise.reject(error);}
  if(errors.length)return Promise.reject(errors[0]);
  const task=Promise.resolve().then(()=>{options.signal.throwIfAborted();return action();});
  busy=task;
  void task.then(()=>{busy=undefined;},error=>{remember(error);busy=undefined;});
  return task;
 };
 try{
  await operation({
   rewriteRecord(record){const owned={rootPage:record.rootPage,rowid:record.rowid,record:{...record.record}};return run(()=>rewriteSqliteRecord({...options,...owned}));},
   withSession(callback){return run(()=>withPrivateSqliteSession(options,callback));},
  });
 }catch(error){remember(error);}
 accepting=false;
 if(busy)try{await busy;}catch(error){remember(error);}
 try{options.signal.throwIfAborted();}catch(error){remember(error);}
 if(errors.length===1)throw errors[0];
 if(errors.length)throw new AggregateError(errors,'SQLite finalization failed');
}
