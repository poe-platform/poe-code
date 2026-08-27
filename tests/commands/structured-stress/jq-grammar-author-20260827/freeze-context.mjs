import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { artifact } from './artifacts.mjs';
import { sourceSnapshot,digest } from '../jq-42-independent-review/common.mjs';
const before=sourceSnapshot();
assert.equal(digest(readFileSync('/usr/bin/jq')),'1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f');
const vectors=[];
for(const filter of ['join','join("-";":")','split','missing','-NaN','+1','1e','1..0','-','join,split','join(join)','join("-";split)','join | split','join(1;2;3)']) for(const prefix of ['', '  ','\n','\n  ','"é😀" | ']) {
  const argv=['-nc','--',prefix+filter];
  const result=spawnSync('/usr/bin/jq',argv,{input:'',shell:false,timeout:2000,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',LANG:'C',TZ:'UTC',TERM:'dumb'}});
  assert.ifError(result.error);
  vectors.push({id:`context-${vectors.length}`,argv,inputHex:'',expected:{status:result.status,stdoutHex:result.stdout.toString('hex'),stderrHex:result.stderr.toString('hex')}});
}
artifact('native-context-frozen.json',{recordedAt:new Date().toISOString(),before,after:sourceSnapshot(),vectors});
console.log(JSON.stringify({vectors:vectors.length}));
