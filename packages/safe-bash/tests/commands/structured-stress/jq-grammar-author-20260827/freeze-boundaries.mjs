import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { artifact } from './artifacts.mjs';
import { sourceSnapshot } from '../jq-42-independent-review/common.mjs';
const before=sourceSnapshot();
const vectors=[];
for(const offset of [16381,16382,16383,16384,16385]) for(const tail of ['NaN\nInfinity\n01\n1.\n','"é😀"\n1e+','[NaN,1.,-Infinity]\n']) {
  const input=' '.repeat(offset)+tail;
  const argv=['-c','.'];
  const result=spawnSync('/usr/bin/jq',argv,{input,shell:false,timeout:2000,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',LANG:'C',TZ:'UTC',TERM:'dumb'}});
  assert.ifError(result.error);
  vectors.push({id:`scan-boundary-${vectors.length}`,argv,inputHex:Buffer.from(input).toString('hex'),expected:{status:result.status,stdoutHex:result.stdout.toString('hex'),stderrHex:result.stderr.toString('hex')}});
}
artifact('native-boundary-frozen.json',{recordedAt:new Date().toISOString(),before,after:sourceSnapshot(),vectors});
