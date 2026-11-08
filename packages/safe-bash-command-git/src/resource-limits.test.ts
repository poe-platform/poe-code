import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createGitCommand } from './index.js';
import { runner } from '../tests/support.js';

test('every budget accepts Infinity and rejects invalid finite values', () => {
  for (const name of ['maxEntries','maxBytes','maxDepth','maxHttpRequests','maxHttpBytes'] as const) {
    assert.doesNotThrow(()=>createGitCommand({limits:{[name]:Infinity}}));
    for (const value of [0,-1,NaN,-Infinity,1.5,Number.MAX_SAFE_INTEGER+1]) {
      assert.throws(()=>createGitCommand({limits:{[name]:value}}));
    }
  }
});

test('default budgets omit filesystem read caps', async () => {
  const fs=new MemoryFileSystem();
  await fs.mkdir('/repo',{recursive:true});
  await fs.writeFile('/unrelated',Uint8Array.of(1,2,3));
  const read=fs.readFile.bind(fs), list=fs.readdir.bind(fs);
  fs.readFile=async (path,options)=>{
    assert.equal(options?.maxBytes,undefined);
    return read(path,options);
  };
  fs.readdir=async (path,options)=>{
    assert.equal(options?.maxEntries,undefined);
    return list(path,options);
  };
  const result=await runner(fs)(['init','-b','main']);
  assert.equal(result.exitCode,0,result.stderr);
  assert.deepEqual(await fs.readFile('/unrelated'),Uint8Array.of(1,2,3));
});

test('finite output and depth budgets still leave the filesystem unchanged', async () => {
  for (const limits of [{maxBytes:16},{maxEntries:1},{maxDepth:1}]) {
    const fs=new MemoryFileSystem();
    await fs.mkdir('/repo',{recursive:true});
    if ('maxDepth' in limits) await fs.mkdir('/repo/deep',{recursive:true});
    const result=await runner(fs,createGitCommand({limits}))(['init']);
    assert.equal(result.exitCode,128,result.stderr);
    assert.ok(result.stderr.includes('limit'),result.stderr);
    await assert.rejects(fs.stat('/repo/.git'));
  }
});
