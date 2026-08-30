import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { artifact } from './artifacts.mjs';
import { sourceSnapshot } from '../jq-42-independent-review/common.mjs';
const before=sourceSnapshot();
const files=Object.fromEntries(Object.entries({'continuation.json':'2\n','close.json':']\n','word.json':'N\n','bom.json':'\uFEFFNaN\n','records.json':'NaN\nInfinity\n[9]\n','invalid.json':'[}\n','unicode.json':'"é😀"\n','end-string.json':'ity"\n'}).map(([name,text])=>{artifact(`native-files/${name}`,text,true);return [name,Buffer.from(text).toString('hex')];}));
const vectors=[];
for(const [input,name] of [['1','continuation.json'],['[01,1.','close.json'],['Na','word.json'],['"Infin','end-string.json'],['','bom.json'],['0\n','bom.json'],['NaN\n','records.json'],['NaN\n','invalid.json'],['','unicode.json']]) for(const filter of ['.','.[0]','[type,isnan,isinfinite]','fromjson']) for(const order of [['-',name],[name,'-']]) {
  const argv=['-c',filter,...order];
  const result=spawnSync('/usr/bin/jq',argv,{input,shell:false,timeout:2000,cwd:new URL('./native-files/',import.meta.url),env:{PATH:'/usr/bin:/bin',LC_ALL:'C',LANG:'C',TZ:'UTC',TERM:'dumb'}});
  assert.ifError(result.error);
  vectors.push({id:`files-extra-${vectors.length}`,argv,inputHex:Buffer.from(input).toString('hex'),files:{[name]:files[name]},expected:{status:result.status,stdoutHex:result.stdout.toString('hex'),stderrHex:result.stderr.toString('hex')}});
}
artifact('native-files-frozen.json',{recordedAt:new Date().toISOString(),before,after:sourceSnapshot(),vectors});
console.log(JSON.stringify({vectors:vectors.length}));
