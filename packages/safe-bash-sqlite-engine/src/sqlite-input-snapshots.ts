import {FsError} from 'safe-bash-contracts';
import type {FileSystem} from 'safe-bash-contracts';
import {createPrivateSqliteStorage} from './sqlite-private.js';
import {acquireSqliteSources} from './sqlite-sources.js';
import {copySqliteSnapshot} from './sqlite-copy-snapshot.js';

export interface SqliteInputSnapshotsOptions {
 fs:FileSystem;path:string;directory:string;signal:AbortSignal;
 maxFileBytes:number;maxIndexBytes:number;maxOpenFiles:number;
 attachments?:readonly {alias:string;path:string}[];
}
/** Own immutable copies and their private cleanup for read/query operations. */
export async function withSqliteInputSnapshots<T>(options:SqliteInputSnapshotsOptions,operation:(storage:Awaited<ReturnType<typeof createPrivateSqliteStorage>>,inputs:readonly {path:string;alias:string}[])=>Promise<T>):Promise<T>{
 const {fs,signal}=options;
 for(const limit of [options.maxFileBytes,options.maxIndexBytes,options.maxOpenFiles])if(!Number.isSafeInteger(limit)||limit<0)throw new RangeError('Invalid SQLite snapshot budget');
 const inputs=[{path:options.path,alias:'main'},...(options.attachments??[]).map(input=>({...input}))];
 for(const {alias}of inputs)if(alias.includes('\0')||new TextEncoder().encode(alias).length>65536)throw new RangeError('Invalid SQLite attachment alias');
 const storage=await createPrivateSqliteStorage({...options,maxFiles:options.maxOpenFiles});
 const errors:unknown[]=[];let value!:T;
 try{
  for(const [index,input]of inputs.entries()){
   const sources=await acquireSqliteSources(fs,input.path,signal);
   try{
    if(!sources.database)throw new FsError('ENOENT',{path:input.path});
    await copySqliteSnapshot({...options,sources,storage,path:`${storage.directory}/database-${index}`});
    input.path=sources.path;
   }finally{await sources.close();}
  }
  value=await operation(storage,inputs);
 }catch(error){errors.push(error);}
 try{await storage.close();}catch(error){errors.push(error);}
 if(errors.length===1)throw errors[0];
 if(errors.length)throw new AggregateError(errors,'SQLite read session and cleanup failed');
 return value;
}
