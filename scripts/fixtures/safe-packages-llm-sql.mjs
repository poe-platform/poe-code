import {MemoryFileSystem} from '@poe-platform/safe-fs/core';
import {Shell} from '@poe-platform/safe-bash/shell';
import {llmCommands} from '@poe-platform/safe-bash/commands/llm';
import {withLlmCollections,createLlmCollectionCommands,withSqlEmbeddingEntries} from '@poe-platform/safe-bash/commands/llm/collections';

export async function verifyLlmSqlImports(){
 const fs=new MemoryFileSystem(),signal=new AbortController().signal,limits={maxFileBytes:8388608,maxIndexBytes:1048576,maxOpenFiles:16};
 await withLlmCollections({...limits,fs,path:'/source.db',signal,now:()=>new Date(0)},catalog=>catalog.collection('source',{model:'embed'}));
 const before=await fs.readFile('/source.db'),calls=[];
 const shell=new Shell({fs}).use(llmCommands({collections:createLlmCollectionCommands(limits),providers:[{name:'fixture',models:[{id:'embed',capabilities:['embed'],embeddingBatchSize:2}],async *complete(){},async embedSources(request){
  const values=[];for(const input of request.inputs){let value='';for await(const bytes of input.bytes)value+=new TextDecoder().decode(bytes);values.push(value);}calls.push(values);return {model:'embed',vectors:values.map(()=>[1,1])};
 }}]}));
 try{
  const result=await shell.exec('llm embed-multi docs --attach source /source.db --sql "SELECT id,name,model FROM source.collections" -m embed -d /target.db --store');
  if(result.exitCode!==0||result.stdout!=='Embedding\n'||JSON.stringify(calls)!=='[["source embed"]]')throw new Error('SQL CLI import failed: '+JSON.stringify({result,calls}));
 }finally{await shell.dispose();}
 let largeBytes=0;
 await withSqlEmbeddingEntries({...limits,fs,path:'/source.db',directory:'/',signal,sql:"SELECT 1,replace(hex(zeroblob(131073)),'00','界')"},async entries=>{
  for await(const entry of entries)for await(const bytes of entry.input.bytes){if(bytes.length>65536)throw new Error('Unbounded SQL result transfer');largeBytes+=bytes.length;}
 });
 if(largeBytes!==393219)throw new Error('Large SQL text changed');
 const after=await fs.readFile('/source.db');if(after.length!==before.length||after.some((byte,index)=>byte!==before[index]))throw new Error('SQL source changed');
 if(JSON.stringify((await fs.readdir('/')).map(entry=>entry.name))!=='["source.db","target.db"]')throw new Error('SQL result storage leaked');
 return {sqlImports:true,largeBytes};
}
