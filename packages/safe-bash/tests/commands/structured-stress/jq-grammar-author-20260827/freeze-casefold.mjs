import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { artifact } from './artifacts.mjs';
import { sourceSnapshot } from '../jq-42-independent-review/common.mjs';
const before=sourceSnapshot();
const vectors=[];
for(const token of ['ſNaN','ſnan','SNaN','sNaN','Naℕ','NаN','NaN٠','ＮａＮ','∞','Infınity','İnfinity','+ſnan','-ſNaN','ſNaN123']) for(const [filter,input] of [['.',token],['.',`[${token}]`],['.',JSON.stringify({[token]:token})],['fromjson',JSON.stringify(token)],['tonumber',JSON.stringify(token)]]) {
  const argv=['-c',filter];
  const result=spawnSync('/usr/bin/jq',argv,{input,shell:false,timeout:2000,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',LANG:'C',TZ:'UTC',TERM:'dumb'}});
  assert.ifError(result.error);
  vectors.push({id:`casefold-${vectors.length}`,argv,inputHex:Buffer.from(input).toString('hex'),expected:{status:result.status,stdoutHex:result.stdout.toString('hex'),stderrHex:result.stderr.toString('hex')}});
}
artifact('native-casefold-frozen.json',{recordedAt:new Date().toISOString(),before,after:sourceSnapshot(),vectors});
