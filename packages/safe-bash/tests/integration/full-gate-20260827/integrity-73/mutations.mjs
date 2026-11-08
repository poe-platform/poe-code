import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const original=readFileSync(new URL('./tree.mjs',import.meta.url),'utf8');
const cases=[
  ['ignore-additions',"if (!expected.has(path)) changes.push({ path, kind: 'added', after: observed.get(path) });","if (!expected.has(path)) {}"],
  ['bypass-comparison','changes: compareTrees(JSON.parse(serialized), after)','changes: []'],
];
const receipts=[];
for(const [name,before,after]of cases){
  assert.equal(original.split(before).length,2);
  const directory=mkdtempSync(join(tmpdir(),'integrity73-mutant-'));
  try{
    writeFileSync(join(directory,'tree.mjs'),original.replace(before,after));writeFileSync(join(directory,'controls.test.mjs'),readFileSync(new URL('./controls.test.mjs',import.meta.url)));
    const result=spawnSync(process.execPath,['--test','--test-reporter=tap',join(directory,'controls.test.mjs')],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
    assert.equal(result.status,1,name);assert.match(result.stdout,/^not ok /m);receipts.push({name,status:result.status,stdout:result.stdout,stderr:result.stderr});
  }finally{rmSync(directory,{recursive:true,force:true});}
}
console.log(JSON.stringify({mutants:receipts.length,detected:receipts.length,receipts},null,2));
