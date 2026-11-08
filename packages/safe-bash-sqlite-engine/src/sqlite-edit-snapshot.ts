import {FsError,type ByteSource,type FileReadHandle} from 'safe-bash-contracts';
import type {SqliteFileSystem} from './safe-fs.js';
import {findSqliteRecord,type SqliteRecordSource} from './sqlite-pages.js';
import {writeSqliteFile} from './file-io.js';
import {verifySqliteSnapshot} from './sqlite-snapshot.js';

export interface SqliteEditSnapshot {
 findRecord(rootPage:number,rowid:bigint,match?:'exact'|'at-or-after'):Promise<(SqliteRecordSource & {readonly rowid:bigint})|undefined>;
}

/** Keep a bounded-I/O immutable copy while a private destination is edited.
 * Every field stream is scoped to the callback; admitted reads drain on exit. */
export async function withSqliteEditSnapshot<T>(options:{fs:SqliteFileSystem;directory:string;path:string;signal:AbortSignal},operation:(snapshot:SqliteEditSnapshot)=>Promise<T>):Promise<T>{
 const {fs,directory,path,signal}=options;
 if(!fs.open||!fs.unlink||!path.startsWith(directory+'/')||path.slice(directory.length+1).includes('/'))throw new FsError('EACCES',{path});
 const temporary=directory+'/edit-source-'+crypto.randomUUID();
 let source:Awaited<ReturnType<NonNullable<typeof fs.open>>>|undefined,copy:typeof source,created=false,active=true,pending:Promise<unknown>|undefined,value!:T;
 const errors:unknown[]=[];
 const remember=(error:unknown):void=>{if(!errors.includes(error))errors.push(error);};
 const run=<V>(action:()=>Promise<V>):Promise<V>=>{
  if(!active)return Promise.reject(new FsError('EBADF',{message:'SQLite edit snapshot is closed'}));
  if(pending){const error=new FsError('EBUSY',{message:'SQLite snapshot reads must be serialized'});remember(error);return Promise.reject(error);}
  if(errors.length)return Promise.reject(errors[0]);
  const task=Promise.resolve().then(()=>{signal.throwIfAborted();return action();});pending=task;
  void task.then(()=>{pending=undefined;},error=>{pending=undefined;remember(error);});return task;
 };
 try{
  signal.throwIfAborted();
  source=await fs.open(path,{access:'read',creation:'never',signal});
  const expected=await source.stat({signal});verifySqliteSnapshot(expected,expected);
  copy=await fs.open(temporary,{access:'readwrite',creation:'exclusive',signal});created=true;
  for(let position=0;position<expected.size;){
   signal.throwIfAborted();verifySqliteSnapshot(await source.stat({signal}),expected);
   const bytes=new Uint8Array(Math.min(16384,expected.size-position));
   const count=await source.read(bytes,position,{signal});
   if(!Number.isSafeInteger(count)||count<1||count>bytes.length)throw new FsError('EIO',{path});
   await writeSqliteFile(copy,bytes.subarray(0,count),position,signal);position+=count;
  }
  verifySqliteSnapshot(await source.stat({signal}),expected);
  await source.close();source=undefined;
  const file=copy;
  const snapshot:FileReadHandle={stat:controls=>file.stat(controls),async read(position,count,controls){
   const bytes=new Uint8Array(Math.min(count,16384));
   const length=await file.read(bytes,position,controls);
   if(!Number.isSafeInteger(length)||length<0||length>bytes.length)throw new FsError('EIO',{path:temporary});
   return bytes.slice(0,length);
  },async close(){/* This scope owns the handle. */}};
  value=await operation({findRecord(rootPage,rowid,match='exact'){return run(async()=>{
   const record=await findSqliteRecord(snapshot,rootPage,rowid,signal,match);
   if(!record)return undefined;
   return {size:record.size,rowid:record.rowid,bytes(offset=0,length=record.size-offset):ByteSource{
    const iterator=record.bytes(offset,length)[Symbol.asyncIterator]();
    return {[Symbol.asyncIterator](){return {
     next(){return run(()=>iterator.next());},
     return(){return run(async()=>iterator.return?iterator.return():{done:true as const,value:undefined});},
    };}};
   }};
  });}});
 }catch(error){remember(error);}
 active=false;
 if(pending)try{await pending;}catch(error){remember(error);}
 for(const file of [source,copy])if(file)try{await file.close();}catch(error){remember(error);}
 if(created)try{await fs.unlink(temporary,{signal:new AbortController().signal});}catch(error){remember(error);}
 if(errors.length===1)throw errors[0];
 if(errors.length)throw new AggregateError(errors,'SQLite edit snapshot and cleanup failed');
 return value;
}
