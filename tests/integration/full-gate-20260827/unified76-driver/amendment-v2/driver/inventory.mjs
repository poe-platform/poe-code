import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,readdir,readlink} from 'node:fs/promises';
import {join,resolve,posix} from 'node:path';

export async function capture(root){
  const entries=[];
  async function visit(path){
    const file=path==='.'?root:join(root,path),before=await lstat(file),mode=before.mode&0o7777;
    if(before.isSymbolicLink()){assert.notEqual(path,'.');entries.push({path,kind:'symlink',mode,target:await readlink(file)});}
    else if(before.isDirectory()){entries.push({path,kind:'directory',mode});for(const name of (await readdir(file)).sort())await visit(path==='.'?name:`${path}/${name}`);}
    else{
      assert.ok(before.isFile());const hash=createHash('sha256');let bytes=0;
      for await(const chunk of createReadStream(file,{highWaterMark:64*1024})){hash.update(chunk);bytes+=chunk.length;}
      const after=await lstat(file);assert.ok(after.isFile()&&after.ino===before.ino&&after.dev===before.dev&&after.size===before.size&&after.mode===before.mode&&after.mtimeMs===before.mtimeMs&&bytes===before.size,'file changed during inventory: '+path);
      entries.push({path,kind:'file',mode,bytes,sha256:hash.digest('hex')});
    }
  }
  assert.ok((await lstat(root)).isDirectory());await visit('.');entries.sort((left,right)=>left.path<right.path?-1:left.path>right.path?1:0);
  return{format:'unified76-streamed-inventory-v1',entries,sha256:createHash('sha256').update(JSON.stringify(entries)).digest('hex')};
}
export function compare(before,after){
  assert.equal(before.format,'unified76-streamed-inventory-v1');assert.equal(after.format,before.format);
  const expected=new Map(before.entries.map(entry=>[entry.path,entry])),actual=new Map(after.entries.map(entry=>[entry.path,entry]));assert.equal(expected.size,before.entries.length);assert.equal(actual.size,after.entries.length);
  const changes=[];
  for(const path of [...new Set([...expected.keys(),...actual.keys()])].sort()){
    if(!expected.has(path))changes.push({path,kind:'added'});else if(!actual.has(path))changes.push({path,kind:'removed'});else if(JSON.stringify(expected.get(path))!==JSON.stringify(actual.get(path)))changes.push({path,kind:'changed'});
  }
  return changes;
}
export async function createTreeGuard(root){
  const path=resolve(root),serialized=JSON.stringify(await capture(path));
  return Object.freeze({before:()=>JSON.parse(serialized),async check(){try{return{changes:compare(JSON.parse(serialized),await capture(path))};}catch(error){return{changes:[{path:'.',kind:'unreadable',error:error.message}]};}}});
}
export function requireBuildDelta(before,after){
  assert.equal(before.entries.some(entry=>entry.path==='dist'||entry.path.startsWith('dist/')),false,'build must start cold');
  assert.ok(after.entries.some(entry=>entry.path==='dist'&&entry.kind==='directory'));
  const withoutDist={...after,entries:after.entries.filter(entry=>entry.path!=='dist'&&!entry.path.startsWith('dist/'))};
  assert.deepEqual(compare(before,withoutDist),[],'only new dist outputs are authorized during build; no other new inputs may be blessed');
}
export async function verifyArchive(root,expected){
  const files=[],directories=[];
  async function visit(prefix){for(const name of(await readdir(join(root,prefix))).sort()){const path=prefix?`${prefix}/${name}`:name,stat=await lstat(join(root,path));if(stat.isDirectory()&&!stat.isSymbolicLink()){directories.push(path);await visit(path);}else files.push(path);}}
  await visit('');assert.deepEqual(files.sort(),expected.map(entry=>entry.path).sort(),'archive added/missing input');
  const wantedDirectories=new Set();for(const entry of expected){let parent=posix.dirname(entry.path);while(parent!=='.'){wantedDirectories.add(parent);parent=posix.dirname(parent);}}
  assert.deepEqual(directories.sort(),[...wantedDirectories].sort(),'archive added/missing directory');
  const manifest={};
  for(const entry of expected){
    const file=join(root,entry.path),before=await lstat(file),link=entry.mode==='120000';assert.equal(before.isSymbolicLink(),link);
    const gitHash=createHash('sha1').update(`blob ${entry.bytes}\0`),hash=createHash('sha256');let bytes=0;
    if(link){const target=await readlink(file),normalized=posix.normalize(posix.join(posix.dirname(entry.path),target));assert.ok(!posix.isAbsolute(target)&&normalized!=='..'&&!normalized.startsWith('../'),'archive symlink escape');const content=Buffer.from(target);gitHash.update(content);hash.update(content);bytes=content.length;}
    else{assert.ok(before.isFile()&&before.nlink===1);assert.equal(before.mode&0o777,Number.parseInt(entry.mode.slice(-3),8));for await(const chunk of createReadStream(file,{highWaterMark:64*1024})){gitHash.update(chunk);hash.update(chunk);bytes+=chunk.length;}}
    const after=await lstat(file);assert.ok(after.ino===before.ino&&after.dev===before.dev&&after.size===before.size&&after.mode===before.mode&&after.mtimeMs===before.mtimeMs,'archive input changed during authentication');
    assert.equal(bytes,entry.bytes);assert.equal(gitHash.digest('hex'),entry.blob,entry.path);manifest[entry.path]={blob:entry.blob,sha256:hash.digest('hex'),bytes,mode:before.mode&0o777,symlink:link};
  }
  return{files:manifest,count:expected.length,source:'exact committed input and directory sets, streamed Git blob/SHA256/mode/type authentication'};
}
