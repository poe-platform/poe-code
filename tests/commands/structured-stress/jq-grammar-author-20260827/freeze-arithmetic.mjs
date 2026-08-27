import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { artifact } from './artifacts.mjs';
import { sourceSnapshot } from '../jq-42-independent-review/common.mjs';
const before=sourceSnapshot();
const vectors=[];
function add(filter,input) {
  const argv=['-c',filter];
  const result=spawnSync('/usr/bin/jq',argv,{input,shell:false,timeout:2000,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',LANG:'C',TZ:'UTC',TERM:'dumb'}});
  assert.ifError(result.error);
  vectors.push({id:`arithmetic-${vectors.length}`,argv,inputHex:Buffer.from(input).toString('hex'),expected:{status:result.status,stdoutHex:result.stdout.toString('hex'),stderrHex:result.stderr.toString('hex')}});
}
for(const left of ['NaN','Infinity','-Infinity','0','1','-1','1.5','1e9999']) for(const right of ['NaN','Infinity','-Infinity','0','1','-1','1.5','1e9999']) for(const operator of ['+','-','*','/','%','==','!=','<','<=','>','>=']) add(`.[0] ${operator} .[1]`,`[${left},${right}]`);
for(const input of ['NaN','Infinity','-Infinity','1e9999','0']) for(const filter of ['contains(.)','[.,.]|unique','[.,.]|sort','[.,.]-[.]','[.,.] == [.,.]','[.,.]|unique_by(.)']) add(filter,input);
artifact('native-arithmetic-frozen.json',{recordedAt:new Date().toISOString(),before,after:sourceSnapshot(),vectors});
console.log(JSON.stringify({vectors:vectors.length}));
