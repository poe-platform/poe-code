import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {transactSqlite} from 'safe-bash-sqlite-engine/storage';
import {withSqlEmbeddingEntries} from './import-sql.js';
const limits={maxFileBytes:8*1024*1024,maxIndexBytes:1048576,maxOpenFiles:16},signal=new AbortController().signal;
test('SQL embedding rows retain duplicate-key position, Python IDs and null separators',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/db',signal,...limits},s=>s.execute('CREATE TABLE sample(id INTEGER)'));
 const rows:unknown[]=[];
 await withSqlEmbeddingEntries({fs,path:'/db',directory:'/',signal,...limits,sql:"SELECT NULL AS id,'old' AS content,NULL AS empty,'new' AS content",prefix:'p:',prepend:'before '},async entries=>{for await(const entry of entries){let value='';for await(const bytes of entry.input.bytes)value+=new TextDecoder().decode(bytes);rows.push([entry.id,value]);}});
 assert.deepEqual(rows,[['p:None','before new ']]);
});
test('CLI imports attached SQL rows through the same streaming service and retains source databases',async()=>{
 const {createLlmCommand}=await import('./command.js'),{createLlmCollectionCommands}=await import('./collections.js');
 const fs=new MemoryFileSystem(),calls:string[][]=[];
 await transactSqlite({fs,path:'/source',signal,...limits},s=>s.execute("CREATE TABLE sample(id INTEGER,content TEXT); INSERT INTO sample VALUES(1,'first'),(2,'second')"));
 const original=await fs.readFile('/source');
 const command=createLlmCommand({collections:createLlmCollectionCommands(limits),providers:[{name:'fixture',models:[{id:'e',capabilities:['embed'],embeddingBatchSize:2}],async *complete(){},async embedSources(request){
  const values:string[]=[];for(const input of request.inputs){let value='';for await(const bytes of input.bytes)value+=new TextDecoder().decode(bytes);values.push(value);}calls.push(values);return {model:'e',vectors:values.map(()=>[1,1])};
 }}]});
 const errors:Uint8Array[]=[],output:Uint8Array[]=[];
 const result=await command.execute({command:'llm',args:['embed-multi','docs','--attach','source','/source','--sql','SELECT id,content FROM source.sample ORDER BY id','-m','e','-d','/db'],fs,cwd:'/',env:{},signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(bytes){output.push(bytes.slice());}},stderr:{async write(bytes){errors.push(bytes.slice());}}});
 assert.equal(result.exitCode,0,Buffer.concat(errors).toString());assert.deepEqual(calls,[['first','second']]);assert.equal(Buffer.concat(output).toString(),'Embedding\n');
 assert.deepEqual(await fs.readFile('/source'),original);assert.deepEqual((await fs.readdir('/')).map(e=>e.name),['db','source']);
});
test('SQL imports match pinned LLM 0.27.1 row conversion, batching and failed-provider timing',async()=>{
 const {default:reference}=await import('./fixtures/sql-import-0.27.1.json',{with:{type:'json'}});
 const {createLlmCommand}=await import('./command.js'),{createLlmCollectionCommands}=await import('./collections.js');
 const {withSqliteStatement}=await import('safe-bash-sqlite-engine/storage');
 for(const fixture of reference){
  const fs=new MemoryFileSystem(),calls:string[][]=[],out:Uint8Array[]=[],err:Uint8Array[]=[];
  const command=createLlmCommand({collections:createLlmCollectionCommands(limits),providers:[{name:'fixture',models:[{id:'e',capabilities:['embed'],embeddingBatchSize:2}],async *complete(){},async embedSources(request){
   const values:string[]=[];for(const input of request.inputs){let value='';for await(const bytes of input.bytes)value+=new TextDecoder().decode(bytes);values.push(value);}calls.push(values);return {model:'e',vectors:values.map(()=>[1,1])};
  }}]});
  const result=await command.execute({command:'llm',args:['embed-multi','docs','--sql',fixture.sql,'-m','e','-d','/db','--store','--prefix','p:','--prepend','before '],fs,cwd:'/',env:{},signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(bytes){out.push(bytes.slice());}},stderr:{async write(bytes){err.push(bytes.slice());}}});
  assert.equal(result.exitCode,fixture.code,fixture.sql);assert.equal(Buffer.concat(out).toString(),fixture.out,fixture.sql);assert.deepEqual(calls,fixture.calls,fixture.sql);
  if(fixture.exception)assert.ok(Buffer.concat(err).toString().includes(fixture.exception.message));else assert.equal(Buffer.concat(err).toString(),fixture.err);
  const rows:{id:unknown;content:unknown}[]=[];
  await transactSqlite({fs,path:'/db',signal,...limits},s=>withSqliteStatement(s.module,{...s,signal,sql:'SELECT id,content FROM embeddings ORDER BY id'},async statement=>{for await(const [id,content]of statement.rows([],['text','text']))rows.push({id,content});}));
  assert.deepEqual(rows,fixture.rows,fixture.sql);assert.deepEqual((await fs.readdir('/')).map(e=>e.name),['db']);
 }
});
test('large SQL text stays chunked and charges input admission during consumption',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/db',signal,...limits},s=>s.execute('CREATE TABLE sample(id INTEGER)'));
 let size=0,charged=0;
 await withSqlEmbeddingEntries({fs,path:'/db',directory:'/',signal,...limits,sql:"SELECT 1,replace(hex(zeroblob(131073)),'00','界')",admit(bytes){charged+=bytes;}},async entries=>{for await(const entry of entries)for await(const bytes of entry.input.bytes){assert.ok(bytes.length<=65536);size+=bytes.length;}});
 assert.equal(size,131073*3);assert.equal(charged,size);assert.deepEqual((await fs.readdir('/')).map(e=>e.name),['db']);
});
test('SQL input admission failure closes entries and all query scratch files',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/db',signal,...limits},s=>s.execute('CREATE TABLE sample(id INTEGER)'));
 const reason=new Error('input budget');
 await assert.rejects(withSqlEmbeddingEntries({fs,path:'/db',directory:'/',signal,...limits,sql:"SELECT 1,'payload'",admit(){throw reason;}},async entries=>{for await(const entry of entries)for await(const ignored of entry.input.bytes){assert.fail('admitted rejected bytes');}}),error=>error===reason);
 assert.deepEqual((await fs.readdir('/')).map(e=>e.name),['db']);
});
