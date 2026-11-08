import assert from 'node:assert/strict';
import test from 'node:test';
import {createMemoryFileSystem} from '@poe-code/safe-fs';
import {createCommandArguments} from 'safe-bash-contracts';
import {bindFileOutputBudget} from 'safe-bash-contracts/filesystem-output-budget';
import {createMikeYqCommand} from './mike.js';

for(const mode of ['success','limit','cancel','publish','replace','write','finish'] as const)test(`retains in-place YQ output and cleans staging on ${mode}`,async()=>{
 const fs=createMemoryFileSystem(),controller=new AbortController(),failure=new Error('stopped'),source=new TextEncoder().encode('a: 1\n');
 await fs.writeFile('/input.yml',source);await fs.chmod('/input.yml',0o640);
 const text='é😀'.repeat(20000);let largest=0,created=0,removed=0,closed=0,diagnostic='';
 const filesystem=new Proxy(fs,{get(target,key){
  if(key==='createStagedFile')return async(...args:Parameters<typeof fs.createStagedFile>)=>{
   assert.ok(args[2].type!=='file'||args[2].data.length<=16384,'whole-file staging forbidden');
   const stage=await fs.createStagedFile(...args);created++;
   return {...stage,writer:{async write(bytes:Uint8Array,options?:{signal?:AbortSignal}){
    largest=Math.max(largest,bytes.length);assert.ok(bytes.length<=16384);await stage.writer!.write(bytes,options);if(mode==='cancel')controller.abort(failure);if(mode==='write')throw failure;
   },async finish(options?:{signal?:AbortSignal}){if(mode==='finish')throw failure;return stage.writer!.finish(options);}},cleanup:{async remove(){removed++;await stage.cleanup!.remove();},async close(){closed++;await stage.cleanup!.close();}}};
  };
  if(key==='publishStagedFile')return async(...args:Parameters<typeof fs.publishStagedFile>)=>{
   if(mode==='publish')throw failure;
   if(mode==='replace'){await fs.unlink('/input.yml');await fs.writeFile('/input.yml',new TextEncoder().encode('replacement'));}
   return fs.publishStagedFile(...args);
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 const result=createMikeYqCommand({limits:mode==='limit'?{maxOutputBytes:100}:{}}).execute({command:'yq',...createCommandArguments(['-i','strenv(TEXT)','/input.yml']),cwd:'/',env:{TEXT:text},fs:filesystem,signal:controller.signal,
  stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(){assert.fail('unexpected stdout');}},stderr:{async write(bytes){diagnostic+=new TextDecoder().decode(bytes);}}});
 if(mode==='cancel'||mode==='publish'||mode==='write'||mode==='finish')await assert.rejects(Promise.resolve(result),error=>error===failure);
 else{const actual=await result;assert.equal(actual.exitCode,mode==='success'?0:1,diagnostic);}
 assert.equal(removed,created);assert.equal(closed,created);
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['input.yml']);
 assert.equal(new TextDecoder().decode(await fs.readFile('/input.yml')),mode==='success'?text+'\n':mode==='replace'?'replacement':'a: 1\n');
 if(mode==='success'){assert.ok(largest>0);assert.equal((await fs.stat('/input.yml')).mode&0o777,0o640);}
});

test('preserves document separators across staged result batches',async()=>{
 const fs=createMemoryFileSystem();await fs.writeFile('/input.yml',new TextEncoder().encode('a: first\n---\na: second\n'));
 const result=await createMikeYqCommand().execute({command:'yq',...createCommandArguments(['-i','.a','/input.yml']),cwd:'/',env:{},fs,signal:new AbortController().signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(){assert.fail();}},stderr:{async write(bytes){assert.fail(new TextDecoder().decode(bytes));}}});
 assert.equal(result.exitCode,0);assert.equal(new TextDecoder().decode(await fs.readFile('/input.yml')),'first\n---\nsecond\n');
});

for (const reject of [false, true]) test(`charges retained output to invocation budget (reject=${reject})`, async () => {
 const fs = createMemoryFileSystem();
 await fs.writeFile('/input.yml', new TextEncoder().encode('a: 1\n'));
 const context = { registerCleanup: (_cleanup: () => Promise<void> | void) => {} };
 let charged = 0;
 const failure = new Error('filesystem budget exceeded');
 bindFileOutputBudget(context, sink => sink, async (bytes, write) => {
  charged += bytes.length;
  if (reject) throw failure;
  return write();
 });
 const result = Promise.resolve(createMikeYqCommand().execute({command:'yq', ...createCommandArguments(['-i', '.a', '/input.yml']), cwd:'/', env:{}, fs, ...context,
  signal:new AbortController().signal, stdin:{async *[Symbol.asyncIterator](){}}, stdout:{async write(){assert.fail();}}, stderr:{async write(){}}}));
 if (reject) await assert.rejects(result, error => error === failure);
 else assert.equal((await result).exitCode, 0);
 assert.equal(charged, 2);
 assert.equal(new TextDecoder().decode(await fs.readFile('/input.yml')), reject ? 'a: 1\n' : '1\n');
 assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['input.yml']);
});
