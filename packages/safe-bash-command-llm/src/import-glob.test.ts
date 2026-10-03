import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import reference from './fixtures/glob-3.9.json' with {type:'json'};
import {withFileEmbeddingEntries} from './import-files.js';
import {withEmbeddingFileGlob} from './import-glob.js';

async function fixture(){
 const fs=new MemoryFileSystem();
 for(const path of ['/nested/deep','/empty'])await fs.mkdir(path,{recursive:true});
 for(const path of ['/a.txt','/.hidden.txt','/nested/a.txt','/nested/deep/b.txt','/empty/.keep'])await fs.writeFile(path,new Uint8Array());
 await fs.symlink('nested','/link-dir');await fs.symlink('a.txt','/link-file');await fs.symlink('missing','/dangling');return fs;
}
const options=(fs:MemoryFileSystem)=>({fs,directory:'/',signal:new AbortController().signal,maxOpenFiles:8,maxFileBytes:16*1024*1024});
test('Python pathlib traversal preserves hidden files, lexical parents and symlink rules',async()=>{
 const fs=await fixture();
 for(const [pattern,expected]of [
  ['**',['.','nested','nested/deep','empty']],
  ['**/*.txt',['a.txt','.hidden.txt','nested/a.txt','nested/deep/b.txt']],
  ['**/**/a.txt',['a.txt','nested/a.txt']],
  ['link-dir/*.txt',['link-dir/a.txt']],
  ['nested/../*.txt',['nested/../a.txt','nested/../.hidden.txt']],
  ['*.txt/',['a.txt','.hidden.txt']],
  ['link-file',['link-file']],['missing',[]]
 ] as const){
  const ids:string[]=[];
  await withEmbeddingFileGlob(options(fs),{directory:'/',pattern},async files=>{for await(const file of files)ids.push(file.id);});
  assert.deepEqual(ids.sort(),[...expected].sort(),pattern);
 }
 assert.equal((await fs.readdir('/')).length,7);
});
test('glob streams directories without array fallback and retires storage on early exit',async()=>{
 const fs=await fixture();const original=fs.readdir.bind(fs);fs.readdir=async()=>{throw Error('array enumeration');};
 await withEmbeddingFileGlob(options(fs),{directory:'/',pattern:'**/*'},async files=>{for await(const file of files){assert.ok(file.id);break;}});
 assert.equal((await original('/')).length,7);
});
test('glob validation and cancellation preserve errors without leftover storage',async()=>{
 const fs=await fixture();
 for(const [pattern,message]of [['.', 'tuple index out of range'],['./', 'tuple index out of range'],['',"Unacceptable pattern: ''"],['/x','Non-relative patterns are unsupported'],['a**b',"Invalid pattern: '**' can only be an entire path component"]]){
  await assert.rejects(withEmbeddingFileGlob(options(fs),{directory:'/',pattern:pattern!},async()=>{}),{message});
 }
 const controller=new AbortController();controller.abort(false);
 await assert.rejects(withEmbeddingFileGlob({...options(fs),signal:controller.signal},{directory:'/',pattern:'*'},async()=>{}),error=>error===false);
 assert.equal((await fs.readdir('/')).length,7);
});

test('matches every pinned Python 3.9 pathlib capture',async()=>{
 const fs=await fixture();
 for(const row of reference){
  const run=()=>withEmbeddingFileGlob(options(fs),{directory:'/',pattern:row.pattern},async files=>{const ids:string[]=[];for await(const file of files)ids.push(file.id);return ids.sort();});
  if(row.error)await assert.rejects(run(),{message:row.message});
  else assert.deepEqual(await run(),row.matches!.map(match=>match.path).sort(),row.pattern);
 }
});
test('file spools can mutate the source parent after enumeration and escaped iterators are closed',async()=>{
 const fs=await fixture();let retained:AsyncIterator<unknown>|undefined;const ids:string[]=[];
 await withEmbeddingFileGlob(options(fs),{directory:'/',pattern:'*.txt'},async files=>{
  retained=files[Symbol.asyncIterator]();
  await withFileEmbeddingEntries(options(fs),files,async entries=>{for await(const entry of entries){ids.push(entry.id);for await(const chunk of entry.input.bytes)assert.equal(chunk.length,0);}});
 });
 assert.deepEqual(ids,['a.txt','.hidden.txt']);assert.equal((await retained!.next()).done,true);
 assert.equal((await fs.readdir('/')).length,7);
});
test('queued cancellation during enumeration closes both iterator and private storage',async()=>{
 const fs=await fixture(),controller=new AbortController(),reason=new Error('cancel traversal');
 const original=fs.iterateDirectory.bind(fs);let closed=false;
 fs.iterateDirectory=async function*(path,opts){try{for await(const entry of original(path,opts)){controller.abort(reason);yield entry;}}finally{closed=true;}};
 await assert.rejects(withEmbeddingFileGlob({...options(fs),signal:controller.signal},{directory:'/',pattern:'*'},async files=>{for await(const ignored of files)assert.fail('unexpected file');}),error=>error===reason);
 assert.equal(closed,true);assert.equal((await fs.readdir('/')).length,7);
});
test('multiple glob groups share one iterator and retain duplicates between groups',async()=>{
 const fs=await fixture(),ids:string[]=[];
 await withEmbeddingFileGlob(options(fs),[{directory:'/',pattern:'a.txt'},{directory:'/nested',pattern:'a.txt'}],async files=>{for await(const file of files)ids.push(file.id+':'+file.path);});
 assert.deepEqual(ids,['a.txt:/a.txt','a.txt:/nested/a.txt']);
 assert.equal((await fs.readdir('/')).length,7);
});
