import {MemoryFileSystem} from '@poe-platform/safe-fs/core';
import {Shell} from '@poe-platform/safe-bash/shell';
import {llmCommands} from '@poe-platform/safe-bash/commands/llm';
import {withLlmCollections,createLlmCollectionCommands,withSqlEmbeddingEntries,prepareSqliteAttachments} from '@poe-platform/safe-bash/commands/llm/collections';

export async function verifyLlmSqlImports(){
 const fs=new MemoryFileSystem(),signal=new AbortController().signal,limits={maxFileBytes:8388608,maxIndexBytes:1048576,maxOpenFiles:16};
 await withLlmCollections({...limits,fs,path:'/source.db',signal,now:()=>new Date(0)},catalog=>catalog.collection('source',{model:'embed'}));
 await fs.symlink('/source.db','/source-link.db');
 const before=await fs.readFile('/source.db'),calls=[];
 const shell=new Shell({fs}).use(llmCommands({collections:createLlmCollectionCommands(limits),providers:[{name:'fixture',models:[{id:'embed',capabilities:['embed'],embeddingBatchSize:2}],async *complete(){},async embedSources(request){
  const values=[];for(const input of request.inputs){let value='';for await(const bytes of input.bytes)value+=new TextDecoder().decode(bytes);values.push(value);}calls.push(values);return {model:'embed',vectors:values.map(()=>[1,1])};
 }}]}));
 try{
  const result=await shell.exec('llm embed-multi docs --attach source /source.db --sql "SELECT id,name,model FROM source.collections" -m embed -d /target.db --store');
  if(result.exitCode!==0||result.stdout!=='Embedding\n'||JSON.stringify(calls)!=='[["source embed"]]')throw new Error('SQL CLI import failed: '+JSON.stringify({result,calls}));
  const linked=await shell.exec('llm embed-multi linked --attach source /source-link.db --sql "SELECT id,name,model FROM source.collections" -m embed -d /linked.db');
  if(linked.exitCode!==0)throw new Error('Symlink SQL attachment failed: '+JSON.stringify(linked));
  await prepareSqliteAttachments({...limits,fs,path:'/prepared.db',directory:'/',signal,attachments:[{alias:'source',path:'/source.db'},{alias:'empty',path:'/empty.db'}]});
  if((await fs.stat('/prepared.db')).size!==0||(await fs.stat('/empty.db')).size!==0)throw new Error('SDK attachment preparation changed empty files');
  await fs.writeFile('/broken.db',new TextEncoder().encode('not sqlite'));
  const failure=await shell.exec('llm embed-multi docs --attach source /broken.db - --format csv -m embed -d /failed.db',{stdin:'id,content\n1,ok\n'});
  if(failure.exitCode!==1||!failure.stderr.includes('file is not a database')||(await fs.stat('/failed.db')).size!==0)throw new Error('Unused attachment validation failed: '+JSON.stringify(failure));
  const missing=await shell.exec('llm embed-multi docs --attach source /new.db --sql "SELECT 1,\'created\'" -m embed -d /created.db');
  if(missing.exitCode!==0||(await fs.stat('/new.db')).size!==0)throw new Error('Missing attachment creation failed: '+JSON.stringify(missing));
 }finally{await shell.dispose();}
 let largeBytes=0;
 await withSqlEmbeddingEntries({...limits,fs,path:'/source.db',directory:'/',signal,sql:"SELECT 1,replace(hex(zeroblob(131073)),'00','界')"},async entries=>{
  for await(const entry of entries)for await(const bytes of entry.input.bytes){if(bytes.length>65536)throw new Error('Unbounded SQL result transfer');largeBytes+=bytes.length;}
 });
 if(largeBytes!==393219)throw new Error('Large SQL text changed');
 const attachmentNames=[];
 await withSqlEmbeddingEntries({...limits,fs,path:'/source.db',directory:'/',signal,sql:'SELECT seq,name FROM pragma_database_list'},async entries=>{
  for await(const entry of entries){let name='';for await(const bytes of entry.input.bytes)name+=new TextDecoder().decode(bytes);attachmentNames.push(name);}
 });
 if(JSON.stringify(attachmentNames)!=='["main"]')throw new Error('Query sees result storage: '+JSON.stringify(attachmentNames));
 const attachments=Array.from({length:10},(_,index)=>({alias:'db'+index,path:'/source.db'}));
 let attachedCount='';
 await withSqlEmbeddingEntries({...limits,fs,path:'/source.db',directory:'/',signal,attachments,sql:'SELECT count(*),\'content\' FROM pragma_database_list'},async entries=>{
  for await(const entry of entries){attachedCount=entry.id;await entry.input.dispose();}
 });
 if(attachedCount!=='11')throw new Error('Result storage consumed native attachment capacity');
 const filenames=[];
 await withSqlEmbeddingEntries({...limits,fs,path:'/source.db',directory:'/',signal,attachments:[{alias:'again',path:'/source.db'}],sql:'SELECT name,file FROM pragma_database_list'},async entries=>{
  for await(const entry of entries){let path='';for await(const bytes of entry.input.bytes)path+=new TextDecoder().decode(bytes);filenames.push([entry.id,path]);}
 });
 if(JSON.stringify(filenames)!=='[["main","/source.db"],["again","/source.db"]]')throw new Error('SQLite filenames exposed snapshots: '+JSON.stringify(filenames));
 const after=await fs.readFile('/source.db');if(after.length!==before.length||after.some((byte,index)=>byte!==before[index]))throw new Error('SQL source changed');
 if(JSON.stringify((await fs.readdir('/')).map(entry=>entry.name))!=='["broken.db","created.db","empty.db","failed.db","linked.db","new.db","prepared.db","source-link.db","source.db","target.db"]')throw new Error('SQL result storage leaked');
 return {sqlImports:true,largeBytes};
}
