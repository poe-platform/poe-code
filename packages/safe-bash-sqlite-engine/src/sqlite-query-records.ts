import {yieldTurn} from 'safe-bash-contracts/yield';
import {FsError,type FileReadHandle} from 'safe-bash-contracts';
import {withSqliteInputSnapshots,type SqliteInputSnapshotsOptions} from './sqlite-input-snapshots.js';
import {withPrivateSqliteSession} from './sqlite-session.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {findSqliteRecord} from './sqlite-pages.js';
import {readSqliteRecord} from './sqlite-record-read.js';
import type {SqliteRecordValue} from './sqlite-record.js';

/** Materialize native SELECT results in private caller storage, then expose
 * physical field streams. SQLite evaluates expressions; no result fields cross
 * the native scalar ABI or become whole JavaScript strings/byte arrays.
 * Streams are borrowed for the callback lifetime. Canonical inputs stay intact. */
export async function withSqliteQueryRecords<T>(options:SqliteInputSnapshotsOptions&{sql:string},operation:(rows:AsyncIterable<SqliteRecordValue[]>,columns:readonly string[])=>Promise<T>):Promise<T>{
 const {signal}=options;
 return withSqliteInputSnapshots(options,async(storage,inputs)=>{
  const path=storage.directory+'/results',table='result_'+crypto.randomUUID().replaceAll('-','');
  let columns:readonly string[]=[];
  const root=await withPrivateSqliteSession({...options,fs:storage.fs,directory:storage.directory,path:storage.directory+'/database-0'},async session=>{
   for(let index=1;index<inputs.length;index++)await withSqliteStatement(session.module,{...session,signal,sql:'ATTACH DATABASE ? AS "'+inputs[index]!.alias.replaceAll('"','""')+'"'},async statement=>{
    for await(const ignored of statement.rows([storage.directory+'/database-'+index],[]))signal.throwIfAborted();
   });
   await withSqliteStatement(session.module,{...session,signal,sql:'ATTACH DATABASE ? AS "'+table+'"'},async statement=>{
    for await(const ignored of statement.rows([path],[]))signal.throwIfAborted();
   });
   let progressFailure:unknown;
   session.module.progress_handler(session.database,1000,async()=>{
    try{await yieldTurn(signal);return 0;}catch(error){progressFailure=error;return 1;}
   },0);
   try{
   columns=await withSqliteStatement(session.module,{...session,signal,single:true,sql:options.sql},async statement=>statement.columns());
   // A derived table preserves SELECT/WITH/VALUES semantics and rejects write
   // statements. The same shape is used by the reference CLI's counting pass.
   await withSqliteStatement(session.module,{...session,signal,single:true,sql:'CREATE TABLE "'+table+'".result AS SELECT * FROM ('+options.sql+')'},async statement=>{
    for await(const ignored of statement.rows([],[]))signal.throwIfAborted();
   });
   return await withSqliteStatement(session.module,{...session,signal,sql:'SELECT rootpage FROM "'+table+'".sqlite_schema WHERE name=?'},async statement=>{
    for await(const row of statement.rows(['result'],['integer']))return Number(row[0]);
    throw new FsError('EIO',{message:'Missing SQLite result table'});
   });
   }catch(error){if(progressFailure!==undefined)throw progressFailure;throw error;}
   finally{session.module.progress_handler(session.database,0,null,0);}
  });
  const descriptor=await storage.fs.open!(path,{access:'read',creation:'never',signal});
  let accepting=true;
  const check=()=>{signal.throwIfAborted();if(!accepting)throw new FsError('EBADF',{message:'SQLite query results are closed'});};
  const file:FileReadHandle={async stat(settings){check();return descriptor.stat(settings);},async read(position,length,settings){check();const bytes=new Uint8Array(Math.min(length,65536));const count=await descriptor.read(bytes,position,settings);check();return bytes.subarray(0,count);},close:()=>descriptor.close()};
  const rows=async function*(){
   const header=new Uint8Array(4);let offset=0;
   while(offset<header.length){const part=await file.read(56+offset,4-offset,{signal});if(!part.length)throw new FsError('EIO',{message:'Invalid SQLite encoding header'});header.set(part,offset);offset+=part.length;}
   const encoding=new DataView(header.buffer).getUint32(0);
   if(encoding<1||encoding>3)throw new FsError('EIO',{message:'Invalid SQLite text encoding'});
   for(let rowid=1n;;){
    check();const record=await findSqliteRecord(file,root,rowid,signal,'at-or-after');if(!record)return;
    const values=await readSqliteRecord(record,{signal,maxColumns:2000});
    if(encoding!==1)for(let index=0;index<values.length;index++){
     const field=values[index];if(!field||typeof field!=='object'||field.type!=='text')continue;
     const bytes={async *[Symbol.asyncIterator](){
      const decoder=new TextDecoder(encoding===2?'utf-16le':'utf-16be',{fatal:true,ignoreBOM:true}),encoder=new TextEncoder();
      for await(const chunk of field.bytes)for(let start=0;start<chunk.length;start+=16384){check();const value=encoder.encode(decoder.decode(chunk.subarray(start,start+16384),{stream:true}));if(value.length)yield value;}
      const last=encoder.encode(decoder.decode());if(last.length)yield last;
     }};
     let size=0;for await(const chunk of bytes)size+=chunk.length;
     values[index]={type:'text',size,bytes};
    }
    yield values;
    if(record.rowid===(1n<<63n)-1n)return;rowid=record.rowid+1n;
   }
  };
  const iterator=rows(),errors:unknown[]=[];let value!:T;
  try{value=await operation({[Symbol.asyncIterator]:()=>iterator},columns);}catch(error){errors.push(error);}
  accepting=false;
  try{await iterator.return(undefined);}catch(error){if(!errors.includes(error))errors.push(error);}
  try{await descriptor.close();}catch(error){errors.push(error);}
  if(errors.length===1)throw errors[0];
  if(errors.length)throw new AggregateError(errors,'SQLite query result cleanup failed');
  return value;
 });
}
