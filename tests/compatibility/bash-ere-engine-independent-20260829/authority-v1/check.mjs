import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const own=path.dirname(new URL(import.meta.url).pathname);
const root=path.dirname(own);
const started=Date.now();
const log=fs.openSync(path.join(own,'capture.data'),'wx',0o600);
const emit=value=>fs.writeSync(log,JSON.stringify(value)+'\n');
let bytes=0;
const inputs=[];
const read=(name,expected)=>{
  const location=path.join(root,name);const stat=fs.lstatSync(location);
  assert.ok(stat.isFile());assert.ok(stat.size<=2097152);bytes+=stat.size;assert.ok(bytes<=16777216);
  const body=fs.readFileSync(location);const sha256=crypto.createHash('sha256').update(body).digest('hex');
  if(expected)assert.equal(sha256,expected);
  inputs.push({path:name,bytes:stat.size,mode:stat.mode&0o777,sha256});return body.toString('utf8');
};
try{
  emit({event:'start',at:new Date().toISOString(),role:'SOURCE/DATA'});
  for(const args of [['rev-parse','--show-toplevel'],['status','--short','--untracked-files=no']]){
    emit({event:'enroll',args});
    const outcome=spawnSync('/usr/bin/git',args,{cwd:'/Users/kjopek/Workspace/safe-bash',env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0'},timeout:5000,maxBuffer:1048576});
    emit({event:'retired',status:outcome.status,signal:outcome.signal,stdout:outcome.stdout?.toString(),stderr:outcome.stderr?.toString()});
    assert.equal(outcome.status,0);assert.equal(outcome.signal,null);
  }
  const matcher=read('engine/2.data','d9eb7ec7b18648ddcbd853085aef6972cd5938d3817df458796b0a7354b0abeb');
  const design=read('design/2.data','7fb1f7348ba43c9e036ed71806061206d8be45ec77f3853fb89425bc0719b615');
  const cases=JSON.parse(read('witnesses/cases.json.data','c19afeb49fc6f830aeeafcd6464fe9bb30da1504d9964ac3f2f7d2e7f5bc919b'));
  const summary=JSON.parse(read('SUMMARY.json','c4cbd72d05136a8a7432a2c4600d7922c9efe23a8bab24cbf5f776fde090a9c8'));
  const failures=summary.layouts.map(row=>({layout:row.layout,ids:row.failures}));
  assert.equal(failures.length,3);assert.equal(failures[0].ids.length,7);
  for(const row of failures)assert.deepEqual(row.ids,failures[0].ids);
  let units=0,checkpoints=0;
  for(let ordinal=1;ordinal<=255;ordinal++){
    units++;
    for(let side=0;side<2;side++)for(let remaining=255;remaining>ordinal;remaining--){units++;if(remaining%256===0)checkpoints++;}
  }
  assert.equal(units,65025);assert.equal(checkpoints,0);
  const lines=(body,from,to)=>body.split('\n').slice(from-1,to).map((text,index)=>({line:from+index,text}));
  const result={source:'f97fd06024cb63edfd01873d81d84576a22189db',inputs,failures,authorE12:cases.find(row=>row.id==='E12'),designLines:lines(design,87,107),cooperativeDesignLines:lines(design,156,161),historyOrder:lines(matcher,29,61),groupEntry:lines(matcher,145,150),arithmetic:{entries:255,units,checkpoints,role:'finite DATA arithmetic; no matcher call'},native:'UNRUN',newProductLoads:0,elapsedMs:Date.now()-started};
  fs.writeFileSync(path.join(own,'SOURCE-DATA.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  emit({event:'complete',bytes,elapsedMs:Date.now()-started});console.log(JSON.stringify(result));
}catch(error){emit({event:'failure',message:String(error?.stack??error)});process.exitCode=1;}
finally{fs.fsyncSync(log);fs.closeSync(log);}
