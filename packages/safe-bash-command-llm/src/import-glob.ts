import {FsError,type FileSystem} from 'safe-bash-contracts';
import {compilePythonGlob} from 'safe-bash-regex-engine/python-glob';
import {createPrivateSqliteStorage,withPrivateSqliteSession,withSqliteStatement,type SqliteBinding,type SqliteColumn} from 'safe-bash-sqlite-engine/storage';
import type {LlmEmbeddingFile} from './import-files.js';

/** Python pathlib glob traversal with caller-backed directory, stack and dedup
 * state. A directory is drained before yielding so consumers may create spools. */
export async function withEmbeddingFileGlob<T>(options:{
 readonly fs:FileSystem;readonly directory:string;readonly signal:AbortSignal;
 readonly maxFileBytes:number;readonly maxOpenFiles:number;
},source:{readonly directory:string;readonly pattern:string},operation:(files:AsyncIterable<LlmEmbeddingFile>)=>Promise<T>):Promise<T>{
 const {fs,signal}=options;signal.throwIfAborted();
 if(!source.pattern)throw new Error("Unacceptable pattern: ''");
 if(source.pattern.startsWith('/'))throw new Error('Non-relative patterns are unsupported');
 if(new TextEncoder().encode(source.pattern).length>65536)throw new RangeError('Glob pattern exceeds SQLite control byte limit');
 const parts=source.pattern.split('/').filter(part=>part&&part!=='.');
 if(!parts.length)throw new Error('tuple index out of range');
 for(const part of parts)if(part.includes('**')&&part!=='**')throw new Error("Invalid pattern: '**' can only be an entire path component");
 if(!fs.iterateDirectory)throw new FsError('ENOTSUP',{message:'File glob requires streaming directory enumeration'});
 const ignored=(error:unknown):boolean=>error instanceof FsError&&['ENOENT','ENOTDIR','EACCES'].includes(error.code);
 const storage=await createPrivateSqliteStorage({...options,maxFiles:options.maxOpenFiles});let failed=false;
 try{return await withPrivateSqliteSession({...options,fs:storage.fs,directory:storage.directory,path:storage.directory+'/glob'},async session=>{
  await session.execute('CREATE TABLE stack(seq INTEGER PRIMARY KEY AUTOINCREMENT,path TEXT,id TEXT,part INTEGER); CREATE TABLE children(seq INTEGER PRIMARY KEY,path TEXT,id TEXT,part INTEGER); CREATE TABLE visited(id TEXT,part INTEGER,PRIMARY KEY(id,part)); CREATE TABLE emitted(id TEXT PRIMARY KEY)');
  const query=async(sql:string,bindings:readonly SqliteBinding[]=[],columns:readonly SqliteColumn[]=[]):Promise<SqliteBinding[]|undefined>=>withSqliteStatement(session.module,{...session,signal,sql},async statement=>{
   let result:SqliteBinding[]|undefined;for await(const row of statement.rows(bindings,columns)){if(result)throw new Error('Glob control query returned more than one row');result=row;}return result;
  });
  const observe=async<T>(operation:()=>Promise<T>):Promise<T|undefined>=>{try{return await operation();}catch(error){signal.throwIfAborted();if(!ignored(error))throw error;return undefined;}};
  async function* listing(path:string){try{yield* fs.iterateDirectory!(path,{signal});}catch(error){signal.throwIfAborted();if(!ignored(error))throw error;}}
  const root=source.directory.endsWith('/')?source.directory.slice(0,-1):source.directory;
  await query('INSERT INTO stack(path,id,part) VALUES(?,?,0)',[root||'/','']);
  let active=true;
  async function* files():AsyncGenerator<LlmEmbeddingFile>{
   while(true){
    if(!active)throw new FsError('EBADF',{message:'File glob lease is closed'});signal.throwIfAborted();
    const row=await query('SELECT seq,path,id,part FROM stack ORDER BY seq DESC LIMIT 1',[],['integer','text','text','integer']);if(!row)return;
    const [seq,rawPath,rawId,index]=row,path=String(rawPath),id=String(rawId),part=Number(index);
    await query('DELETE FROM stack WHERE seq=?',[seq!]);
    if(await query('SELECT part FROM visited WHERE id=? AND part=?',[id,part],['integer']))continue;
    await query('INSERT INTO visited(id,part) VALUES(?,?)',[id,part]);
    if(part===parts.length){
     if(await query('SELECT id FROM emitted WHERE id=?',[id],['text']))continue;
     await query('INSERT INTO emitted(id) VALUES(?)',[id]);yield {path,id:id||'.'};continue;
    }
    const component=parts[part]!,recursive=component==='**';
     if((await observe(()=>fs.stat(path,{signal})))?.type!=='directory')continue;
     const join=(parent:string,name:string):string=>(parent==='/'?'':parent)+'/'+name;
     const childId=(name:string):string=>id?id+'/'+name:name;
     if(!recursive&&!component.includes('*')&&!component.includes('?')&&!component.includes('[')){
      const child=join(path,component);if(!await observe(()=>fs.lstat(child,{signal})))continue;
      if(child!==storage.directory)await query('INSERT INTO stack(path,id,part) VALUES(?,?,?)',[child,childId(component),part+1]);continue;
     }
     const pattern=recursive?undefined:compilePythonGlob(component);
     const canonical=await observe(()=>fs.realpath(path,{signal}));if(canonical===undefined)continue;
     await session.execute('DELETE FROM children');
     for await(const entry of listing(path)){
      signal.throwIfAborted();if(join(canonical,entry.name)===storage.directory)continue;
      if(recursive?entry.type!=='directory':!await pattern!.find(entry.name,{maxBufferBytes:65536,step(){signal.throwIfAborted();},checkpoint(){signal.throwIfAborted();}}))continue;
      await query('INSERT INTO children(path,id,part) VALUES(?,?,?)',[join(path,entry.name),childId(entry.name),recursive?part:part+1]);
     }
     await session.execute('INSERT INTO stack(path,id,part) SELECT path,id,part FROM children ORDER BY seq DESC; DELETE FROM children');
     if(recursive)await query('INSERT INTO stack(path,id,part) VALUES(?,?,?)',[path,id,part+1]);
   }
  }
  const iterator=files();let operationFailed=false;
  try{return await operation({[Symbol.asyncIterator]:()=>iterator});}catch(error){operationFailed=true;throw error;}
  finally{active=false;try{await iterator.return(undefined);}catch(error){if(!operationFailed)await Promise.reject(error);}}
 });}catch(error){failed=true;throw error;}finally{try{await storage.close();}catch(error){if(!failed)await Promise.reject(error);}}
}
