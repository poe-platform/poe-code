import { FsError, type FileReadHandle } from 'safe-bash-contracts';
import type { SqliteFileSystem } from './sqlite-vfs.js';
import { findSqliteRecord } from './sqlite-pages.js';
import { sqliteRecord } from './sqlite-record.js';
import { writeSqliteFile } from './sqlite-file-io.js';
import { verifySqliteSnapshot } from './sqlite-snapshot.js';
import { sqliteSourceChunks } from './sqlite-stream.js';

/** Replace an equal-sized placeholder record in a CLOSED, exclusively owned
 * private database. The immutable working copy keeps page-chain validation
 * meaningful while destination writes advance its revision. Native indexes,
 * constraints and triggers must be handled by the owning history operation;
 * this primitive is not a general SQL UPDATE. Failure invalidates the private
 * transaction and must never be followed by canonical publication. */
export async function rewriteSqliteRecord(options: {
 fs: SqliteFileSystem; directory: string; path: string;
 rootPage: number; rowid: bigint; record: ReturnType<typeof sqliteRecord>; signal: AbortSignal;
}): Promise<void> {
 const {fs,directory,path,rootPage,rowid,record,signal}=options;
 signal.throwIfAborted();
 if(!path.startsWith(directory+'/')||path.slice(directory.length+1).includes('/')||!fs.open||!fs.unlink)throw new FsError('EACCES',{path});
 const temporary=directory+'/record-source-'+crypto.randomUUID();
 const errors:unknown[]=[];
 let file: Awaited<ReturnType<NonNullable<typeof fs.open>>>|undefined;
 let copy: typeof file;
 let created=false;
 try{
  file=await fs.open(path,{access:'readwrite',creation:'never',signal});
  const original=await file.stat({signal});verifySqliteSnapshot(original,original);
  copy=await fs.open(temporary,{access:'readwrite',creation:'exclusive',signal});created=true;
  for(let position=0;position<original.size;){
   signal.throwIfAborted();verifySqliteSnapshot(await file.stat({signal}),original);
   const bytes=new Uint8Array(Math.min(16384,original.size-position));
   const count=await file.read(bytes,position,{signal});
   if(!Number.isSafeInteger(count)||count<1||count>bytes.length)throw new FsError('EIO',{path});
   await writeSqliteFile(copy,bytes.subarray(0,count),position,signal);position+=count;
  }
  verifySqliteSnapshot(await file.stat({signal}),original);
  const source=copy;
  const snapshot:FileReadHandle={stat:controls=>source.stat(controls),async read(position,count,controls){
   const bytes=new Uint8Array(Math.min(count,16384));
   const length=await source.read(bytes,position,controls);
   if(!Number.isSafeInteger(length)||length<0||length>bytes.length)throw new FsError('EIO',{path:temporary});
   return bytes.slice(0,length);
  },async close(){/* The owner closes the descriptor below. */}};
  const stored=await findSqliteRecord(snapshot,rootPage,rowid,signal);
  if(!stored)throw new FsError('ENOENT',{path,message:'SQLite placeholder record is missing'});
  if(stored.size!==record.size)throw new RangeError('SQLite placeholder record length mismatch');
  const spans=stored.spans()[Symbol.asyncIterator]();
  let span=await spans.next(),offset=0,received=0;
  try{
   for await(const bytes of sqliteSourceChunks(record.bytes(signal),signal)){
    let position=0;
    while(position<bytes.length){
     if(span.done)throw new RangeError('SQLite record exceeds placeholder');
     const count=Math.min(bytes.length-position,span.value.length-offset,16384);
     await writeSqliteFile(file,bytes.subarray(position,position+count),span.value.offset+offset,signal);
     received+=count;position+=count;offset+=count;
     if(offset===span.value.length){span=await spans.next();offset=0;}
    }
   }
   if(received!==record.size||!span.done)throw new RangeError('SQLite record length mismatch');
  }finally{await spans.return?.();}
 }catch(error){errors.push(error);}
 for(const descriptor of [copy,file])if(descriptor)try{await descriptor.close();}catch(error){errors.push(error);}
 if(created)try{await fs.unlink!(temporary);}catch(error){errors.push(error);}
 if(errors.length===1)throw errors[0];
 if(errors.length)throw new AggregateError(errors,'SQLite record rewrite and cleanup failed');
}
