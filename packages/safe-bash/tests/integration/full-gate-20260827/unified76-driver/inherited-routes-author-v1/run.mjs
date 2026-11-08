import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,realpathSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {verifyToolFile} from '../launcher-v3/tool-routing.mjs';

const here=dirname(fileURLToPath(import.meta.url)),launcher=resolve(here,'../launcher-v3');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function resultExitCode(report){
  const expected=report.status==='AUTHOR_FOCUSED_PASS'?1:report.status==='AUTHOR_PASS'?10:0;
  return expected&&report.groups.length===expected&&report.passed===expected&&report.failed===0&&report.notExecuted===10-expected&&report.groups.every(row=>row.passed&&row.status===0&&row.signal===null&&row.closed&&!row.violation&&!row.spawnError&&row.signals.length===0)?0:1;
}
export async function run({focused=false}={}){
  const node='/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node';
  const receipt=JSON.parse(readFileSync(join(launcher,'EXTERNAL-RECEIPT.json'))),encoded=readFileSync(join(launcher,'EXTERNAL.json.gz.base64'));
  assert.equal(digest(encoded),receipt.encodedSha256);const decoded=gunzipSync(Buffer.from(encoded.toString().trim(),'base64'));assert.equal(digest(decoded),receipt.sha256);
  const record=JSON.parse(decoded).tools.find(row=>row.origin===node);assert.ok(record);verifyToolFile(record);
  const root=realpathSync(mkdtempSync('/tmp/unified76-inherited-author-'));
  const binding=JSON.parse(readFileSync(join(here,'REPLAY-BINDING.json')));
  const verify=()=>{for(const[file,hash]of Object.entries(binding.files))assert.equal(digest(readFileSync(resolve(here,file))),hash,file);};verify();
  const report={startedAt:new Date().toISOString(),root,binding,node:record,groups:[],status:'RUNNING',policy:'Ten presealed author groups only; no gate/prerequisites/private engine/A10; no old attempt rescore.'};
  writeFileSync(join(root,'START.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({root,startedAt:report.startedAt}));
  const started=Date.now();
  for(const number of focused?[9]:[1,2,3,4,5,6,7,8,9,10]){
    assert.ok(Date.now()-started<600000,'author cohort deadline');verify();verifyToolFile(record);
    const group='G'+String(number).padStart(2,'0'),work=join(root,group);mkdirSync(work);mkdirSync(join(work,'home'));mkdirSync(join(work,'tmp'));
    const result=await new Promise(resolveResult=>{
      const child=spawn(node,[join(here,'controls.mjs'),group,work],{detached:true,stdio:['ignore','pipe','pipe'],env:{PATH:'/dev/null',HOME:join(work,'home'),TMPDIR:join(work,'tmp'),TMP:join(work,'tmp'),TEMP:join(work,'tmp'),LANG:'C',LC_ALL:'C',TZ:'UTC',NO_COLOR:'1'}});
      const output={stdout:[],stderr:[]},sizes={stdout:0,stderr:0},signals=[];let violation,spawnError,hardTimer;
      const stop=reason=>{if(violation)return;violation=reason;signals.push('SIGTERM');try{process.kill(-child.pid,'SIGTERM');}catch{}hardTimer=setTimeout(()=>{signals.push('SIGKILL');try{process.kill(-child.pid,'SIGKILL');}catch{}},1000);};
      const timer=setTimeout(()=>stop('60s deadline'),60000);
      for(const channel of ['stdout','stderr'])child[channel].on('data',bytes=>{sizes[channel]+=bytes.length;if(sizes[channel]>1024*1024)stop(channel+' bound');else output[channel].push(bytes);});
      child.on('error',error=>{spawnError=error.message;});
      child.on('close',(status,signal)=>{clearTimeout(timer);clearTimeout(hardTimer);resolveResult({group,pid:child.pid,status,signal,spawnError,violation,signals,closed:true,stdout:Buffer.concat(output.stdout).toString(),stderr:Buffer.concat(output.stderr).toString()});});
    });
    writeFileSync(join(root,group+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    let observations;try{observations=JSON.parse(result.stdout);}catch{}
    const passed=result.status===0&&result.signal===null&&!result.violation&&!result.spawnError&&observations?.status==='PASS';
    report.groups.push({...result,observations,passed});console.log(JSON.stringify({group,passed,status:result.status,checks:observations?.checks.length}));
    if(result.violation||result.spawnError||result.signal)break;
  }
  verify();report.finishedAt=new Date().toISOString();report.passed=report.groups.filter(row=>row.passed).length;report.failed=report.groups.filter(row=>!row.passed).length;report.notExecuted=10-report.groups.length;report.status=report.passed===(focused?1:10)?(focused?'AUTHOR_FOCUSED_PASS':'AUTHOR_PASS'):'AUTHOR_NONPASS';
  report.qualification='Natural worker close and bounded synchronous Git completion; no universal detached-child/kernel-drain claim. Retained new roots, no failed-root mutation.';
  writeFileSync(join(root,'REPORT.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({root,status:report.status,passed:report.passed,failed:report.failed,notExecuted:report.notExecuted}));
  return resultExitCode(report);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){assert.equal(process.argv.length,3);assert.ok(['--run','--run-g09-v2'].includes(process.argv[2]));process.exitCode=await run({focused:process.argv[2]==='--run-g09-v2'});}
