import {yieldTurn} from 'safe-bash-contracts/yield';
import {FsError} from 'safe-bash-contracts';
import {withSqliteInputSnapshots,type SqliteInputSnapshotsOptions} from './sqlite-input-snapshots.js';
import {withPrivateSqliteSession} from './sqlite-session.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {readSqliteFile,writeSqliteFile} from './file-io.js';
import {verifySqliteSnapshot} from './sqlite-snapshot.js';
import {readSqliteRecord} from './sqlite-record-read.js';
import {sqliteRecord,type SqliteRecordValue} from './sqlite-record.js';

/** Stage native SELECT results as framed SQLite records in caller storage.
 * The spool is never attached to the source connection. Native expression
 * evaluation still owns complete field values; JavaScript transfers are bounded.
 * Streams are borrowed for the callback lifetime. Canonical inputs stay intact. */
export async function withSqliteQueryRecords<T>(options:SqliteInputSnapshotsOptions&{sql:string},operation:(rows:AsyncIterable<SqliteRecordValue[]>,columns:readonly string[])=>Promise<T>):Promise<T>{
 const {signal}=options;
 return withSqliteInputSnapshots(options,async(storage,inputs)=>{
  const file=await storage.fs.open!(storage.directory+'/results',{access:'readwrite',creation:'exclusive',signal});
  let accepting=true,size=0,iterator:AsyncGenerator<SqliteRecordValue[]>|undefined,value!:T;
  const errors:unknown[]=[];
  const check=()=>{signal.throwIfAborted();if(!accepting)throw new FsError('EBADF',{message:'SQLite query results are closed'});};
  try{
   let columns:readonly string[]=[];
   await withPrivateSqliteSession({...options,fs:storage.fs,directory:storage.directory,path:storage.directory+'/database-0'},async session=>{
    for(let index=1;index<inputs.length;index++)await withSqliteStatement(session.module,{...session,signal,sql:'ATTACH DATABASE ? AS "'+inputs[index]!.alias.replaceAll('"','""')+'"'},async statement=>{
     for await(const ignored of statement.rows([storage.directory+'/database-'+index],[]))signal.throwIfAborted();
    });
    let progressFailure:unknown;
    session.module.progress_handler(session.database,1000,async()=>{
     try{await yieldTurn(signal);return 0;}catch(error){progressFailure=error;return 1;}
    },0);
    try{
     columns=await withSqliteStatement(session.module,{...session,signal,single:true,sql:options.sql},async statement=>statement.columns());
     // A derived table preserves SELECT/WITH/VALUES admission and rejects writes.
     await withSqliteStatement(session.module,{...session,signal,single:true,sql:'SELECT * FROM ('+options.sql+')'},async statement=>{
      for await(const row of statement.records()){
       const record=sqliteRecord(row),end=size+8+record.size;
       if(!Number.isSafeInteger(end)||end>options.maxFileBytes)throw new FsError('EFBIG',{message:'SQLite query results exceed file budget'});
       const header=new Uint8Array(8);new DataView(header.buffer).setBigUint64(0,BigInt(record.size));
       await writeSqliteFile(file,header,size,signal);size+=8;
       for await(const bytes of record.bytes(signal)){await writeSqliteFile(file,bytes,size,signal);size+=bytes.length;}
       if(size!==end)throw new FsError('EIO',{message:'Invalid SQLite query record size'});
      }
     });
    }catch(error){if(progressFailure!==undefined)throw progressFailure;throw error;}
    finally{session.module.progress_handler(session.database,0,null,0);}
   });
   const snapshot=await file.stat({signal});verifySqliteSnapshot(snapshot,snapshot);
   const read=async(bytes:Uint8Array,position:number)=>{
    check();verifySqliteSnapshot(await file.stat({signal}),snapshot);
    const complete=await readSqliteFile(file,bytes,position,signal);
    check();verifySqliteSnapshot(await file.stat({signal}),snapshot);
    if(!complete)throw new FsError('EIO',{message:'Truncated SQLite query record'});
   };
   const rows=async function*():AsyncGenerator<SqliteRecordValue[]>{
    for(let position=0;position<size;){
     check();const header=new Uint8Array(8);
     await read(header,position);
     const length=Number(new DataView(header.buffer).getBigUint64(0)),start=position+8;
     if(!Number.isSafeInteger(length)||length<1||length>size-start)throw new FsError('EIO',{message:'Invalid SQLite query record size'});
     yield await readSqliteRecord({size:length,bytes(offset=0,count=length-offset){return {async *[Symbol.asyncIterator](){
      check();if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(count)||offset<0||count<0||offset+count>length)throw new RangeError('Invalid SQLite query record range');
      for(let done=0;done<count;){
       check();const bytes=new Uint8Array(Math.min(16384,count-done));
       await read(bytes,start+offset+done);
       check();done+=bytes.length;yield bytes;
      }
     }};}},{signal,maxColumns:2000});
     position=start+length;
    }
   };
   iterator=rows();value=await operation({[Symbol.asyncIterator]:()=>iterator!},columns);
  }catch(error){errors.push(error);}
  accepting=false;
  try{await iterator?.return(undefined);}catch(error){if(!errors.includes(error))errors.push(error);}
  try{await file.close();}catch(error){errors.push(error);}
  if(errors.length===1)throw errors[0];
  if(errors.length)throw new AggregateError(errors,'SQLite query result cleanup failed');
  return value;
 });
}
