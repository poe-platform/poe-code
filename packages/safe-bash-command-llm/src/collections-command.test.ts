import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {transactSqlite} from 'safe-bash-sqlite-engine/storage';
import {withLlmCollections,createLlmCollectionCommands} from './collections.js';
import {createLlmCommand} from './command.js';
import type {LlmEmbeddingSourceRequest} from './types.js';

const limits={maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8};
const signal=new AbortController().signal;
async function execute(fs:MemoryFileSystem,args:string[],env:Record<string,string>={},onEmbed?:(request:LlmEmbeddingSourceRequest)=>Promise<void>){
 const out:Uint8Array[]=[],err:Uint8Array[]=[];
 const command=createLlmCommand({collections:createLlmCollectionCommands(limits),providers:[{name:'fixture',models:[{id:'e',capabilities:['embed','embed-binary']}],complete(){throw new Error('unexpected completion');},async embedSources(request){await onEmbed?.(request);return {model:'e',vectors:[[1,0.5]]};}}]});
 const result=await command.execute({command:'llm',args,fs,cwd:'/',env:{LLM_USER_PATH:'/config',...env},signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(bytes){out.push(bytes.slice());}},stderr:{async write(bytes){err.push(bytes.slice());}}});
 return {code:result.exitCode,out:Buffer.concat(out).toString(),err:Buffer.concat(err).toString()};
}
async function fixture(){
 const fs=new MemoryFileSystem();const options={fs,path:'/data.db',signal,...limits,now:()=>new Date(0)};
 await withLlmCollections(options,async catalog=>{await catalog.collection('zed',{model:'e'});await catalog.collection('alpha',{model:'e'});});
 await transactSqlite(options,session=>session.execute("INSERT INTO embeddings(collection_id,id,embedding) VALUES (1,'one',X'0000803F')"));return fs;
}
test('collection list and delete use the optional storage capability and reference output',async()=>{
 const fs=await fixture();
 assert.deepEqual(await execute(fs,['collections','-d','/data.db']),{code:0,out:'alpha: e\n  0 embeddings\nzed: e\n  1 embedding\n',err:''});
 const json=await execute(fs,['collections','list','--json'],{LLM_EMBEDDINGS_DB:'/data.db'});
 assert.equal(json.code,0);assert.deepEqual(JSON.parse(json.out),[{name:'alpha',model:'e',num_embeddings:0},{name:'zed',model:'e',num_embeddings:1}]);
 assert.deepEqual(await execute(fs,['collections','delete','zed','-d/data.db']),{code:0,out:'',err:''});
 assert.deepEqual(await execute(fs,['collections','-d/data.db']),{code:0,out:'alpha: e\n  0 embeddings\n',err:''});
 assert.deepEqual(await execute(fs,['collections','delete','missing','-d/data.db']),{code:1,out:'',err:'Error: Collection does not exist\n'});
});
test('collection path, missing tables, and parser errors preserve reference diagnostics',async()=>{
 const fs=new MemoryFileSystem();
 assert.deepEqual(await execute(fs,['collections','path'],{LLM_EMBEDDINGS_DB:'/ignored.db'}),{code:0,out:'/config/embeddings.db\n',err:''});
 assert.deepEqual(await execute(fs,['collections','-d','/missing.db']),{code:1,out:'',err:'Error: No collections table found in /missing.db\n'});
 assert.deepEqual(await execute(fs,['collections','delete']),{code:2,out:'',err:"Usage: llm collections delete [OPTIONS] COLLECTION\nTry 'llm collections delete -h' for help.\n\nError: Missing argument 'COLLECTION'.\n"});
 const help=await execute(fs,['collections','--help']);assert.equal(help.code,0);assert.ok(help.out.includes('list*   View a list of collections'));
});
test('collection command output matches pinned LLM 0.27.1 differential fixtures',async()=>{
 const cases=JSON.parse(readFileSync(new URL('./fixtures/collections-cli-0.27.1.json',import.meta.url),'utf8')) as {args:string[];code:number;out:string;err:string}[];
 for(const row of cases){
  const result=await execute(await fixture(),['collections',...row.args],{LLM_EMBEDDINGS_DB:'/data.db'});
  assert.deepEqual(result,{code:row.code,out:row.out,err:row.err},JSON.stringify(row.args));
 }
});
test('stored embed creates collections, deduplicates before transport, and preserves the collection model',async()=>{
 const fs=new MemoryFileSystem();let calls=0;
 const check=async(request:LlmEmbeddingSourceRequest)=>{calls++;assert.equal(request.model,'e');let text='';for await(const bytes of request.inputs[0]!.bytes)text+=new TextDecoder().decode(bytes);assert.equal(text,'hello');};
 assert.deepEqual(await execute(fs,['embed','docs','one','-m','e','-c','hello','--store','--metadata','{"x":"y"}'],{},check),{code:0,out:'',err:''});
 assert.deepEqual(await execute(fs,['embed','docs','duplicate','-m','ignored','-c','hello'],{},check),{code:0,out:'',err:''});
 assert.equal(calls,1);
 assert.deepEqual(await execute(fs,['collections']),{code:0,out:'docs: e\n  1 embedding\n',err:''});
 assert.deepEqual(await execute(fs,['embed','docs','one','-c','hello','--format','json'],{},check),{code:0,out:'null\n',err:''});
 await withLlmCollections({fs,path:'/config/embeddings.db',signal,...limits,now:()=>new Date(0)},async catalog=>{
  await catalog.similarById('docs','one',{},()=>{throw new Error('self result');});
  await catalog.similarByVector('docs',[1,0.5],{},async row=>{let metadata='';for await(const bytes of row.metadata!.bytes)metadata+=new TextDecoder().decode(bytes);assert.deepEqual(JSON.parse(metadata),{x:'y'});});
 });
});
test('stored embed reads binary files and does not publish on provider failure',async()=>{
 const fs=new MemoryFileSystem();await fs.writeFile('/input',Uint8Array.of(0,255));
 assert.deepEqual(await execute(fs,['embed','docs','one','-m','e','-i','/input','--binary','--store','-d','/binary.db'],{},async request=>{
  assert.equal(request.binary,true);const bytes=[];for await(const chunk of request.inputs[0]!.bytes)bytes.push(...chunk);assert.deepEqual(bytes,[0,255]);
 }),{code:0,out:'',err:''});
 const failed=await execute(fs,['embed','new','one','-m','e','-c','hello','-d','/failed.db'],{},async()=>{throw new Error('provider failed');});assert.equal(failed.code,1);
 await assert.rejects(fs.stat('/failed.db'),{code:'ENOENT'});
});
test('optional collections preserve stateless embed and Python JSON Unicode escaping',async()=>{
 const fs=await fixture();
 assert.deepEqual(await execute(fs,['embed','-m','e','-c','hello']),{code:0,out:'[1.0, 0.5]\n',err:''});
 await withLlmCollections({fs,path:'/data.db',signal,...limits,now:()=>new Date(0)},async catalog=>{await catalog.collection('😀',{model:'mé'});});
 const result=await execute(fs,['collections','--json','-d/data.db']);
 assert.equal(result.code,0);assert.ok(result.out.includes('"name": "\\ud83d\\ude00"'));assert.ok(result.out.includes('"model": "m\\u00e9"'));
});
