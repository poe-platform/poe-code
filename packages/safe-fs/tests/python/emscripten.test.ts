import { strict as assert } from 'node:assert';
import { test, vi } from 'vitest';
import { mountPythonFileSystem, writePythonStat } from '../../src/python/emscripten.js';

test('initial Python cwd uses authoritative symlink resolution before runtime normalization', () => {
 const chdir = vi.fn();
 const FS: Record<string, any> = {root:{}, chdir, createNode: () => ({}), mount: () => {}};
 for (const method of ['lookupNode','open','stat','lstat','fstat','unlink','rmdir','chmod','truncate','utime','mkdir','rename','symlink','readdir','readlink','mknod','write']) FS[method] = () => {};
 const request = vi.fn((operation: string, path: string) => {
  if (operation === 'realpath') {
   assert.equal(path, '/work/link/..');
   return '/deep';
  }
  return {type:'directory',mode:0o755};
 });
 mountPythonFileSystem(FS, {request,cwd:'/work/link/..',runtimeMount:'/.runtime',maxTransferBytes:65536,errno:{},synchronizationFlags:0,runtimeModule:{SYSCALLS:{writeStat:()=>{}}}});
 assert.deepEqual(chdir.mock.calls, [['/deep']]);
});

test('Python stat ABI preserves block size and pre-epoch millisecond timestamps', () => {
 const bytes = new Uint8Array(128);
 writePythonStat(bytes, 0, {dev:1,ino:2,mode:33188,nlink:1,uid:0,gid:0,rdev:0,size:4,blksize:8192,blocks:1,atime:new Date(-1001),mtime:new Date(1234),ctime:new Date(0)});
 const view = new DataView(bytes.buffer);
 assert.equal(view.getInt32(32,true),8192);
 assert.equal(view.getBigInt64(40,true),-2n);
 assert.equal(view.getUint32(48,true),999000000);
 assert.equal(view.getUint32(64,true),234000000);
});
test('Python stat ABI rejects unknown or overflowing metadata', () => {
 const stat={dev:1,ino:2,mode:33188,nlink:1,uid:0,gid:0,rdev:0,size:4,blksize:8192,blocks:1,atime:new Date(0),mtime:new Date(0),ctime:new Date(0)};
 assert.throws(()=>writePythonStat(new Uint8Array(128),0,{...stat,ino:undefined}), /EOVERFLOW/);
 assert.throws(()=>writePythonStat(new Uint8Array(128),0,{...stat,dev:2**32}), /EOVERFLOW/);
});

test('Python stat ABI preserves canonical fractional milliseconds', () => {
 const bytes = new Uint8Array(128);
 writePythonStat(bytes, 0, {dev:1,ino:2,mode:33188,nlink:1,uid:0,gid:0,rdev:0,size:4,blksize:8192,blocks:1,atimeMs:-0.25,mtimeMs:1250.125,ctimeMs:0});
 const view=new DataView(bytes.buffer);
 assert.equal(view.getBigInt64(40,true),-1n);
 assert.equal(view.getUint32(48,true),999750000);
 assert.equal(view.getBigInt64(56,true),1n);
 assert.equal(view.getUint32(64,true),250125000);
});

test('runtime devices stay disjoint from application identities and retain device distinctions', async () => {
 const { createPythonRuntimeStatMapper } = await import('../../src/python/emscripten.js');
 const map = createPythonRuntimeStatMapper(2);
 const first = map({dev:1,ino:1});
 assert.equal(first.dev,0x80000000);
 assert.equal(first.ino,1);
 assert.equal(map({dev:1,ino:2}).dev,first.dev);
 assert.notEqual(map({dev:2,ino:1}).dev,first.dev);
 assert.equal(map(first),first);
 assert.throws(()=>map({dev:3,ino:1}),/EOVERFLOW/);
});

 test('Python creations apply the current guest mask without masking chmod', () => {
  let mask = 0o22;
  const FS: Record<string, any> = {root:{}, cwd:()=>'/work', createNode:()=>({}), mount:()=>{}, isFile:()=>true, isDir:()=>false, createStream:(stream:any)=>stream};
  for (const method of ['chdir','lookupNode','open','stat','lstat','fstat','unlink','rmdir','chmod','truncate','utime','mkdir','rename','symlink','readdir','readlink','mknod','write']) FS[method] = () => {};
  const request = vi.fn((op:string) => op === 'open' ? 1 : op === 'realpath' ? '/work' : op === 'descriptorCapabilities' ? {positionedWrite:true} : {type:'file',mode:0o600});
  mountPythonFileSystem(FS, {request,cwd:'/work',runtimeMount:'/.runtime',maxTransferBytes:65536,errno:{},synchronizationFlags:0,runtimeModule:{SYSCALLS:{writeStat:()=>{}}}, getUmask:()=>mask});
  FS.open('file', 577);
  FS.mkdir('directory');
  mask = 0o77;
  FS.open('private', 193, 0o640);
  FS.mkdir('private-dir',0o750);
  FS.mknod('node',0o100666,0);
  FS.chmod('private',0o666);
  assert.deepEqual(request.mock.calls.filter(([op])=>op==='open'||op==='mkdir'||op==='chmod'), [
   ['open','/work/file',{access:'write',creation:'ifMissing',truncate:true,append:false,mode:0o644,exactMode:true}],
   ['mkdir','/work/directory',{mode:0o755,exactMode:true}],
   ['open','/work/private',{access:'write',creation:'exclusive',truncate:false,append:false,mode:0o600,exactMode:true}],
   ['mkdir','/work/private-dir',{mode:0o700,exactMode:true}],
   ['open','/work/node',{access:'write',creation:'exclusive',mode:0o600,exactMode:true}],
   ['chmod','/work/private',0o666],
  ]);
 });

test.each([undefined, Infinity, 2048])('runtime mapper supports more than 1024 devices with limit %s', async limit => {
 const { createPythonRuntimeStatMapper } = await import('../../src/python/emscripten.js');
 const map = createPythonRuntimeStatMapper(limit);
 for (let dev = 0; dev < 1025; dev++) {
  const stat = map({dev, ino:1});
  assert.equal(stat.dev, 0x80000000 + dev);
  assert.equal(map({dev, ino:2}).dev, stat.dev);
  assert.equal(map(stat), stat);
 }
});

test.each([0, -1, NaN, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('runtime mapper rejects invalid device limit %s', async limit => {
 const { createPythonRuntimeStatMapper } = await import('../../src/python/emscripten.js');
 assert.throws(() => createPythonRuntimeStatMapper(limit), RangeError);
});


test('native stat uses an unknown sentinel for absent optional storage geometry', () => {
 const bytes = new Uint8Array(128);
 const stat = {dev:1,ino:2,mode:33188,nlink:1,uid:0,gid:0,rdev:0,size:4,atimeMs:0,mtimeMs:0,ctimeMs:0};
 writePythonStat(bytes, 0, stat);
 const view = new DataView(bytes.buffer);
 assert.equal(view.getInt32(32,true),-1);
 assert.equal(view.getInt32(36,true),-1);
 for (const key of ['blocks','blksize']) for (const value of [-1,NaN,1.5,2**31]) {
  assert.throws(()=>writePythonStat(bytes,0,{...stat,[key]:value}),/EOVERFLOW/);
 }
});

for (const scenario of ['fragmented','short','nonseekable'] as const) test(`Python JS filesystem reads ${scenario} host transfers without truncating guest buffers`,()=>{
 const seekable=scenario!=='nonseekable';
 const FS:Record<string,any>={root:{},cwd:()=>'/work',createNode:()=>({}),mount:()=>{},isFile:()=>true,isDir:()=>false,createStream:(stream:any)=>stream};
 for(const method of ['chdir','lookupNode','open','stat','lstat','fstat','unlink','rmdir','chmod','truncate','utime','mkdir','rename','symlink','readdir','readlink','mknod','write'])FS[method]=()=>{};
 const reads:unknown[][]=[];
 const request=(op:string,...args:any[])=>{
  if(op==='open')return 1;
  if(op==='realpath')return '/work';
  if(op==='descriptorCapabilities')return {positionedRead:seekable};
  if(op==='read'){
   reads.push(args);
   const [,length,position]=args;
   return Array.from({length:scenario==='short'?1:length},(_,index)=>(position??10)+index);
  }
  return {type:'file',mode:0o600};
 };
 mountPythonFileSystem(FS,{request,cwd:'/work',runtimeMount:'/.runtime',maxTransferBytes:2,errno:{},synchronizationFlags:0,runtimeModule:{SYSCALLS:{writeStat:()=>{}}}});
 const stream=FS.open('/file',0),buffer=new Uint8Array(9).fill(99);
 const length=stream.stream_ops.read(stream,buffer,2,5,10);
 const expected=scenario==='fragmented'?5:scenario==='short'?1:2;
 assert.equal(length,expected);
 assert.deepEqual([...buffer],[99,99,...Array.from({length:expected},(_,index)=>10+index),...Array(7-expected).fill(99)]);
 assert.deepEqual(reads,scenario==='fragmented'?[[1,2,10],[1,2,12],[1,1,14]]:[[1,2,seekable?10:null]]);
});
