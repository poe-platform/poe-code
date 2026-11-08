import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {transactSqlite,withSqliteStatement} from 'safe-bash-sqlite-engine/storage';
import {createLlmCommand} from './command.js';
import {createLlmCollectionCommands} from './collections.js';
import reference from './fixtures/files-0.27.1.json' with {type:'json'};
const limits={maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8};
test('file import CLI matches pinned text, binary, glob and diagnostic captures',async()=>{
 for(const fixture of reference){
  const fs=new MemoryFileSystem(),signal=new AbortController().signal,calls:unknown[][]=[];
  for(const [path,hex]of Object.entries(fixture.files)){await fs.mkdir('/'+path.slice(0,path.lastIndexOf('/')),{recursive:true});await fs.writeFile('/'+path,Uint8Array.from(Buffer.from(hex,'hex')));}
  const command=createLlmCommand({collections:createLlmCollectionCommands(limits),providers:[{name:'fixture',models:[{id:'e',capabilities:['embed','embed-binary','embed-mixed'],embeddingBatchSize:2}],async *complete(){},async embedSources(request){
   const values:unknown[]=[];
   for(let index=0;index<request.inputs.length;index++){const chunks:Uint8Array[]=[];for await(const chunk of request.inputs[index]!.bytes)chunks.push(chunk);const bytes=Buffer.concat(chunks);values.push(request.inputTypes?.[index]==='binary'||request.binary?{hex:bytes.toString('hex')}:bytes.toString());}
   calls.push(values);return {model:'e',vectors:values.map(()=>[1,1])};
  }}]});
  const out:Uint8Array[]=[],err:Uint8Array[]=[];
  const result=await command.execute({command:'llm',args:['embed-multi',...fixture.args],fs,cwd:'/',env:{},signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(bytes){out.push(bytes.slice());}},stderr:{async write(bytes){err.push(bytes.slice());}}});
  assert.deepEqual({code:result.exitCode,out:Buffer.concat(out).toString(),err:Buffer.concat(err).toString(),calls},{code:fixture.code,out:fixture.out,err:fixture.err,calls:fixture.calls},JSON.stringify(fixture.args));
  if(fixture.code===0){
   const rows:unknown[]=[];
   await transactSqlite({fs,path:'/db',signal,...limits},session=>withSqliteStatement(session.module,{...session,signal,sql:"SELECT id,coalesce(content,''),hex(content_blob),content IS NULL FROM embeddings ORDER BY id"},async statement=>{for await(const [id,content,blob,isNull]of statement.rows([],['text','text','text','integer']))rows.push({id,content:isNull===1n?null:content,blob});}));
   assert.deepEqual(rows,fixture.rows);
  }
  assert.ok((await fs.readdir('/')).every(entry=>entry.name==='docs'||entry.name==='db'));
 }
});
test('repeated file groups share provider batches and charge raw file bytes',async()=>{
 for(const maxInputBytes of [Infinity,1000]){
  const fs=new MemoryFileSystem(),signal=new AbortController().signal,calls:string[][]=[];
  await fs.mkdir('/one');await fs.mkdir('/two');await fs.writeFile('/one/a',new TextEncoder().encode('x'.repeat(600)));await fs.writeFile('/two/b',new TextEncoder().encode('y'.repeat(600)));
  const command=createLlmCommand({limits:{maxInputBytes},collections:createLlmCollectionCommands(limits),providers:[{name:'fixture',models:[{id:'e',capabilities:['embed'],embeddingBatchSize:2}],async *complete(){},async embedSources(request){
   const values:string[]=[];for(const input of request.inputs){let value='';for await(const bytes of input.bytes)value+=new TextDecoder().decode(bytes);values.push(value);}calls.push(values);return {model:'e',vectors:values.map(()=>[1])};
  }}]});
  const err:Uint8Array[]=[];
  const result=await command.execute({command:'llm',args:['embed-multi','docs','--files','one','*','--files','two','*','-m','e','-d','/db'],fs,cwd:'/',env:{},signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(){}},stderr:{async write(bytes){err.push(bytes.slice());}}});
  assert.equal(result.exitCode,maxInputBytes===Infinity?0:1);
  assert.deepEqual(calls,maxInputBytes===Infinity?[['x'.repeat(600),'y'.repeat(600)]]:[]);
  if(maxInputBytes!==Infinity)assert.match(Buffer.concat(err).toString(),/input byte limit exceeded/);
  assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['db','one','two']);
 }
});
