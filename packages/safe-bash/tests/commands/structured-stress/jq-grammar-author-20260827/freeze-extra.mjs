import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { artifact } from './artifacts.mjs';
import { sourceSnapshot, digest } from '../jq-42-independent-review/common.mjs';
const before = sourceSnapshot();
assert.equal(before.structuredSha256,'30c573976d4dddb5e8e545f8e3914aeb166e0232f92ed0dfe20514205056db8f');
const vectors = [];
const add = (group,argv,input) => {
  const result = spawnSync('/usr/bin/jq',argv,{input:Buffer.from(input),shell:false,timeout:2000,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',LANG:'C',TZ:'UTC',TERM:'dumb'}});
  assert.ifError(result.error);
  vectors.push({id:`extra-${vectors.length}`,group,argv,inputHex:Buffer.from(input).toString('hex'),expected:{status:result.status,stdoutHex:result.stdout.toString('hex'),stderrHex:result.stderr.toString('hex')}});
};
for (const token of ['sNaN','snan','SNAN','sNaN123','+sNaN','-sNaN','NaN0','NaN0001','NaN1e2','NaN.1','nanfoo','-NaN123','+NaN123','n','nu','nul','NaN-1','1e0000000001','0.00','-000','+000','00.','00.0','000e2']) {
  for(const filter of ['.','[.,type,isnan,isinfinite,.==.,.<0,.>0]']) add('extra-numeric',['-c',filter],token);
  add('extra-tonumber',['-c','tonumber'],JSON.stringify(token));
}
for (const value of ['NaN','Infinity','-Infinity','1e9999','0','null','true','"s"','[]','{}']) for(const filter of ['[isnan,isinfinite]','[.==.,.!=.,.<.,.<=.,.>.,.>=.]','[.,.+1,.-.,.*0,./2]']) add('extra-semantics',['-c',filter],value);
for(const value of ['0 1','0,1','0]','0[1]','null\u0000','0\u0000\n','"\\u12"','"\\uXXXX"','"\\uD800x"']) add('extra-fromjson',['-c','fromjson'],JSON.stringify(value));
const paths=['tests/commands/structured/cli.test.ts','tests/commands/structured/resources.test.ts','tests/commands/structured-stress/safety.test.ts','tests/commands/structured-stress/raw-input.test.ts','tests/commands/structured-stress/independent-increment/safety.test.ts'];
const snapshots=paths.map(path=>{const bytes=readFileSync(path);return {path,sha256:digest(bytes),text:bytes.toString()};});
artifact('canonical-before.json',{recordedAt:new Date().toISOString(),head:before.head,snapshots});
artifact('native-extra-frozen.json',{recordedAt:new Date().toISOString(),before,after:sourceSnapshot(),vectors});
console.log(JSON.stringify({vectors:vectors.length}));
