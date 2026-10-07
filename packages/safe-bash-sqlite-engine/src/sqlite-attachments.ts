import {FsError} from 'safe-bash-contracts';
import {withSqliteInputSnapshots,type SqliteInputSnapshotsOptions} from './sqlite-input-snapshots.js';
import {withPrivateSqliteSession} from './sqlite-session.js';
import {withSqliteStatement,type SqliteBinding} from './sqlite-statement.js';
import {acquireSqliteSources} from './sqlite-sources.js';
import {copySqliteSnapshot} from './sqlite-copy-snapshot.js';

/** Prepare sqlite-utils attachments in order, before collection migrations.
 * Missing canonical files are created empty. Existing data is only read through
 * owned snapshots; aliases and database contents are validated by SQLite. */
export async function prepareSqliteAttachments(options:SqliteInputSnapshotsOptions):Promise<void>{
 const {fs,signal}=options,attachments=options.attachments?.map(input=>({...input}))??[];
 if(!attachments.length)return;
 if(!fs.open)throw new FsError('ENOSYS',{message:'SQLite attachments require descriptor storage'});
 const ensure=async(path:string)=>{
  try{await fs.stat(path,{signal});return;}catch(error){if(!(error instanceof FsError)||error.code!=='ENOENT')throw error;}
  const file=await fs.open!(path,{access:'readwrite',creation:'ifMissing',signal});
  await file.close();
 };
 await ensure(options.path);
 await withSqliteInputSnapshots({...options,attachments:[]},async storage=>{
  await withPrivateSqliteSession({...options,fs:storage.fs,directory:storage.directory,path:storage.directory+'/database-0'},async session=>{
   const execute=async(sql:string,bindings:readonly SqliteBinding[]=[])=>withSqliteStatement(session.module,{...session,signal,sql,single:true},async statement=>{
    for await(const ignored of statement.rows(bindings,[]))signal.throwIfAborted();
   });
   for(const [index,input]of attachments.entries()){
    // Reserve first: duplicate/reserved/malformed aliases fail before creating
    // their source. This empty database contains no caller payload.
    await execute('ATTACH DATABASE ? AS ['+input.alias+']',[':memory:']);
    try{await ensure(input.path);}catch(error){
     signal.throwIfAborted();
     if(error instanceof FsError&&['ENOENT','ENOTDIR','EACCES','EISDIR'].includes(error.code))throw new FsError('EIO',{message:'unable to open database: '+input.path});
     throw error;
    }
    const sources=await acquireSqliteSources(fs,input.path,signal);
    const path=storage.directory+'/database-'+(index+1);
    try{await copySqliteSnapshot({...options,sources,storage,path});}finally{await sources.close();}
    await execute('DETACH DATABASE ['+input.alias+']');
    await execute('ATTACH DATABASE ? AS ['+input.alias+']',[path]);
   }
  });
 });
}
