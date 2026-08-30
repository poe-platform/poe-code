import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {closeSync,fstatSync,mkdtempSync,openSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {node24,save,sha} from '../common.mjs';
import {superviseFencedWorker} from '../fenced-supervisor.mjs';

const directory=dirname(fileURLToPath(import.meta.url)),outer=realpathSync(mkdtempSync('/private/tmp/unified76-os-protocol-'));
const foreign=spawn(node24,['--input-type=module','-e',"process.stdin.resume();process.stdin.once('end',()=>process.exitCode=0);"],{stdio:['pipe','pipe','pipe']});
const foreignClosed=new Promise(resolve=>foreign.once('close',(status,signal)=>resolve({status,signal}))),rows=[];
const descriptor=openSync(join(outer,'surrogate'),'wx'),stat=fstatSync(descriptor);
try{
  for(const mode of ['phase','observe','fd','outside','extra','environment','abandon','loopback','network']){
    const evidence=realpathSync(mkdtempSync(join(outer,mode+'-'))),output='/tmp/unified76-build-types-review-protocol-'+mode+'-'+process.pid;
    const receipt=await superviseFencedWorker({output,outer:evidence,script:join(directory,'protocol-worker.mjs'),args:[mode],cwd:directory,environment:{...process.env,FOREIGN_PID:String(foreign.pid),SURROGATE_IDENTITY:JSON.stringify({dev:stat.dev,ino:stat.ino})},phases:['observe','fd'].includes(mode)?[]:['probe'],limits:{timeoutMs:15000,maxOutputBytes:1024*1024,observeSockets:true}});
    rows.push({mode,evidence,receipt});save(join(evidence,'ASSERTION-INPUT.json'),rows.at(-1));
    assert.equal(receipt.result.status,0,readFileSync(join(evidence,'stderr'),'utf8'));assert.equal(receipt.result.clean,true);assert.equal(receipt.result.closed,true);
    assert.equal(receipt.clean,!['outside','extra','environment','abandon','network'].includes(mode));assert.equal(foreign.exitCode,null,'foreign process remains alive');
    if(mode==='abandon'){assert.ok(receipt.phaseReceipt.events.some(row=>row.result?.signals.length));assert.ok(receipt.phaseReceipt.events.every(row=>!row.result||row.result.survivors.length===0));}
  }
}catch(error){rows.push({failure:error.stack});process.exitCode=1;}
finally{closeSync(descriptor);foreign.stdin.end();assert.deepEqual(await foreignClosed,{status:0,signal:null});}
save(join(outer,'REPORT.json'),{at:new Date().toISOString(),source:['protocol-worker.mjs','protocol-controls.mjs'].map(path=>({path,sha256:sha(readFileSync(join(directory,path)))})),rows,fullGate:false,foreignReaped:true});console.log(JSON.stringify({outer,cases:rows.length,status:process.exitCode??0}));
