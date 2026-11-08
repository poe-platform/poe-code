import {withPrivateSqliteSession,type PrivateSqliteSession} from './sqlite-session.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {withSqliteInputSnapshots,type SqliteInputSnapshotsOptions} from './sqlite-input-snapshots.js';

/** Query immutable caller-backed copies; never publish canonical changes. */
export async function withSqliteReadSession<T>(options:SqliteInputSnapshotsOptions,operation:(session:PrivateSqliteSession)=>Promise<T>):Promise<T>{
 const {signal}=options;
 return withSqliteInputSnapshots(options,async(storage,inputs)=>{
  return withPrivateSqliteSession({...options,fs:storage.fs,directory:storage.directory,path:storage.directory+'/database-0',filenames:inputs.map((input,index)=>({path:storage.directory+'/database-'+index,name:input.path}))},async session=>{
   await session.execute('PRAGMA query_only=ON');
   for(let index=1;index<inputs.length;index++){
    const alias=inputs[index]!.alias;
    await withSqliteStatement(session.module,{...session,signal,sql:'ATTACH DATABASE ? AS "'+alias.replaceAll('"','""')+'"'},async statement=>{
     for await(const ignored of statement.rows([`${storage.directory}/database-${index}`],[]))signal.throwIfAborted();
    });
   }
   return operation(session);
  });
 });
}
