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
