import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=new URL('.',import.meta.url),log=fs.openSync(new URL('RUN.jsonl',root),'wx');
const start=Date.now();const rows=[];
const presealPath=new URL('PRESEAL.json',root);const stat=fs.lstatSync(presealPath);assert(stat.isFile()&&stat.size<262144);const preseal=JSON.parse(fs.readFileSync(presealPath));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function admit(row){const stat=fs.lstatSync(new URL(row.path,root));assert(stat.isFile()&&stat.size===row.bytes&&stat.size<=1048576);const bytes=fs.readFileSync(new URL(row.path,root));assert.equal(hash(bytes),row.sha256);}
for(const row of preseal.files)admit(row);
let allBytes=0;
for(const spec of preseal.children){
  assert(Date.now()-start<60000);const stdout=fs.openSync(new URL(spec.id+'.stdout',root),'wx'),stderr=fs.openSync(new URL(spec.id+'.stderr',root),'wx');
  fs.writeSync(log,JSON.stringify({event:'before-start',id:spec.id,at:Date.now()})+'\n');
  const child=spawn(preseal.node,[...spec.argv],{cwd:preseal.cwd,env:{PATH:'',HOME:preseal.cwd,LANG:'C',LC_ALL:'C',TZ:'UTC'},stdio:['ignore','pipe','pipe']});
  let exit=false,close=false,stdoutEOF=false,stderrEOF=false,forced=false,failed=false,status,signal;const counts={stdout:0,stderr:0};
  const fail=()=>{failed=true;if(!close){forced=true;child.kill('SIGKILL');}};
  for(const [name,pipe,descriptor] of [['stdout',child.stdout,stdout],['stderr',child.stderr,stderr]]){
    pipe.on('data',bytes=>{counts[name]+=bytes.length;allBytes+=bytes.length;if(counts[name]>1048576||allBytes>2097152){fail();return;}try{let offset=0;while(offset<bytes.length){const count=fs.writeSync(descriptor,bytes,offset,bytes.length-offset);if(count<=0)throw Error('short');offset+=count;}}catch{fail();}});
    pipe.on('end',()=>{if(name==='stdout')stdoutEOF=true;else stderrEOF=true;});pipe.on('error',fail);
  }
  child.on('error',fail);child.on('exit',(code,reason)=>{exit=true;status=code;signal=reason;});
  const timer=setTimeout(fail,15000);await new Promise(resolve=>child.on('close',()=>{close=true;resolve();}));clearTimeout(timer);
  fs.fsyncSync(stdout);fs.fsyncSync(stderr);fs.closeSync(stdout);fs.closeSync(stderr);
  const row={id:spec.id,pid:child.pid,exit,close,stdoutEOF,stderrEOF,forced,failed,status,signal,counts};rows.push(row);fs.writeSync(log,JSON.stringify(row)+'\n');
  if(failed||forced||!exit||!close||!stdoutEOF||!stderrEOF)throw Error('SAFETY_CAPTURE_RETIREMENT_STOP');
}
for(const row of preseal.files)admit(row);
fs.writeFileSync(new URL('RUN-RESULT.json',root),JSON.stringify({rows,allBytes,postguards:preseal.files.length,knownOs:3,peak:2,knownOutstanding:0,actualProductCalls:0},null,2)+'\n',{flag:'wx'});fs.closeSync(log);
console.log(JSON.stringify({children:rows.length,statuses:rows.map(row=>row.status),allBytes,postguards:preseal.files.length,knownOutstanding:0}));
