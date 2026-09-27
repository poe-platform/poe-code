import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { runner } from '../tests/support.js';

for (const operation of ['merge','cherry-pick']) {
  test(`${operation} publishes conflicts despite a nonzero exit`, async () => {
    const fs=new MemoryFileSystem();
    await fs.mkdir('/repo',{recursive:true});
    const run=runner(fs);
    const ok=async (args:string[])=>{const r=await run(args);assert.equal(r.exitCode,0,r.stderr);return r.stdout;};
    await ok(['init','-b','main']);
    const commit=async (text:string)=>{
      await fs.writeFile('/repo/a',new TextEncoder().encode(text+'\n'));
      await ok(['add','a']);
      await ok(['commit','-m',text]);
    };
    await commit('base');
    await ok(['checkout','-b','feature']);
    await commit('feature');
    const feature=(await ok(['rev-parse','HEAD'])).trim();
    await ok(['checkout','main']);
    await commit('main');
    const conflict=await run([operation,feature]);
    assert.equal(conflict.exitCode,1,conflict.stderr);
    const text=new TextDecoder().decode(await fs.readFile('/repo/a'));
    assert.ok(text.includes('<<<<<<<') && text.includes('=======') && text.includes('>>>>>>>'),text);
    if(operation==='merge') assert.equal((await fs.stat('/repo/.git/MERGE_HEAD')).type,'file');
    else assert.equal((await fs.stat('/repo/.git/index')).type,'file');
    assert.ok((await ok(['status'])).includes('a'));
    await ok(['merge','--abort']);
    assert.equal(new TextDecoder().decode(await fs.readFile('/repo/a')),'main\n');
  });
}

test('portable parser failures never publish an empty filesystem', async () => {
  const fs=new MemoryFileSystem();
  await fs.mkdir('/repo',{recursive:true});
  await fs.writeFile('/repo/keep',new TextEncoder().encode('keep'));
  const result=await runner(fs)(['config','key','\ud800']);
  assert.equal(result.exitCode,128);
  assert.equal(new TextDecoder().decode(await fs.readFile('/repo/keep')),'keep');
});
