import {FsError,type FileSystem} from 'safe-bash-contracts';
import {createPrivateSqliteStorage} from './sqlite-private.js';
import {acquireSqliteSources} from './sqlite-sources.js';
import {copySqliteSnapshot} from './sqlite-copy-snapshot.js';
import {withPrivateSqliteSession,type PrivateSqliteSession} from './sqlite-session.js';
import {withSqliteStatement} from './sqlite-statement.js';

/** Query immutable caller-backed copies. Canonical databases and sidecars are
 * never published or modified; borrowed native resources expire on return. */
export async function withSqliteReadSession<T>(options:{
 fs:FileSystem;path:string;directory:string;signal:AbortSignal;
 maxFileBytes:number;maxIndexBytes:number;maxOpenFiles:number;
 attachments?:readonly {alias:string;path:string}[];
},operation:(session:PrivateSqliteSession)=>Promise<T>):Promise<T>{
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
   }finally{await sources.close();}
  }
  value=await withPrivateSqliteSession({...options,fs:storage.fs,directory:storage.directory,path:storage.directory+'/database-0'},async session=>{
   for(let index=1;index<inputs.length;index++){
    const alias=inputs[index]!.alias;
    await withSqliteStatement(session.module,{...session,signal,sql:'ATTACH DATABASE ? AS "'+alias.replaceAll('"','""')+'"'},async statement=>{
     for await(const ignored of statement.rows([`${storage.directory}/database-${index}`],[]))signal.throwIfAborted();
    });
   }
   await session.execute('PRAGMA query_only=ON');
   return operation(session);
  });
 }catch(error){errors.push(error);}
 try{await storage.close();}catch(error){errors.push(error);}
 if(errors.length===1)throw errors[0];
 if(errors.length)throw new AggregateError(errors,'SQLite read session and cleanup failed');
 return value;
}
