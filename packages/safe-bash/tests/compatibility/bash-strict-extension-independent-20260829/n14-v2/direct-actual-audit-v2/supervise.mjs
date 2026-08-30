import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const previous = path.join(path.dirname(root), 'direct-actual-audit-v1');
const repository = '/Users/kjopek/Workspace/safe-bash';
const relative = path.relative(repository, root);
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const git = '/usr/bin/git';
const gitOptions = ['-c','gc.auto=0','-c','maintenance.auto=false','-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','core.abbrev=40'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const mode = process.argv[2];
const captureRoot=mode==='publish'?fs.mkdtempSync('/tmp/virtual37-data-v2-publication-'):path.join(root,'capture');
fs.mkdirSync(captureRoot,{recursive:true});
const eventFile = fs.openSync(path.join(captureRoot,mode+'.events.jsonl'),'wx');
function event(value) {fs.writeSync(eventFile,JSON.stringify({at:new Date().toISOString(),...value})+'\n');fs.fsyncSync(eventFile);}
function read(file,maximum=2097152) {const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>maximum)throw Error('regular bounded input '+file);const bytes=fs.readFileSync(file);if(bytes.length!==stat.size)throw Error('read size changed');return bytes;}
function snapshot(directory) {
  let bytes=0,entries=0;const files=[];
  function visit(current) {for(const name of fs.readdirSync(current).sort()){const file=path.join(current,name),stat=fs.lstatSync(file);if(stat.isDirectory()){entries++;visit(file);}else{if(!stat.isFile())throw Error('nonregular owned output');entries++;bytes+=stat.size;files.push({path:path.relative(directory,file),bytes:stat.size,sha256:hash(read(file,16777216))});}}}
  visit(directory);return Object.freeze({root:directory,at:new Date().toISOString(),bytes,entries,files:Object.freeze(files)});
}
async function child(label,executable,args,timeout=30000) {
  const stdoutPath=path.join(captureRoot,label+'.stdout'),stderrPath=path.join(captureRoot,label+'.stderr');
  const stdout=fs.openSync(stdoutPath,'wx'),stderr=fs.openSync(stderrPath,'wx');
  event({event:'capture-open',label});
  let processChild,exitSeen=false,exitCode,signal,spawnErrorPresent=false,spawnError;
  try {
    processChild=spawn(executable,args,{cwd:repository,stdio:['ignore',stdout,stderr],env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
    const closed=new Promise(resolve=>{processChild.on('error',error=>{spawnErrorPresent=true;spawnError=error;});processChild.on('exit',(code,value)=>{exitSeen=true;exitCode=code;signal=value;event({event:'exit',label,pid:processChild.pid,code,signal:value});});processChild.on('close',(code,value)=>resolve({code,signal:value}));});
    event({event:'enrolled',label,pid:processChild.pid,executable,args});
    let timedOut=false;const timer=setTimeout(()=>{timedOut=true;processChild.kill('SIGKILL');},timeout);
    const result=await closed;clearTimeout(timer);
    fs.fsyncSync(stdout);fs.fsyncSync(stderr);
    event({event:'close',label,pid:processChild.pid,...result,exitSeen,timedOut,spawnErrorPresent});
    if(timedOut||spawnErrorPresent||!exitSeen||signal!==null)throw Error('known retirement/admission failure '+label+': '+String(spawnError));
    return {label,code:exitCode,stdout:stdoutPath,stderr:stderrPath};
  } finally {fs.closeSync(stdout);fs.closeSync(stderr);event({event:'capture-closed',label});}
}
function write(name,value) {fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
async function main() {
  event({event:'owner-start',pid:process.pid,mode});
  if(mode==='prepare') {
    write('START.json',{at:new Date().toISOString(),deadline:new Date(Date.now()+15*60000).toISOString(),budget:{knownOS:32,peak:3,capture:48*1024*1024,work:192*1024*1024},scope:'DATA re-adjudication; no product/native execution'});
    const oldRelative=path.relative(repository,path.join(previous,'AUDIT.json'));
    const result=await child('old-index-git',git,[...gitOptions,'show','05707e3b0011864154707266f2375d88cf80c6a1:'+oldRelative]);
    if(result.code!==0)throw Error('old index authority');
    const old=read(result.stdout),working=read(path.join(previous,'AUDIT.json'));
    if(!old.equals(working))throw Error('old index differs from immutable evidence');
    const oldData=JSON.parse(old);
    const nodeStat=fs.lstatSync(node);if(!nodeStat.isFile()||nodeStat.size>128*1024*1024)throw Error('node tool type/size');
    const digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(node,{highWaterMark:65536}))digest.update(chunk);
    const nodeHash=digest.digest('hex');if(nodeHash!=='5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011')throw Error('node identity');
    write('INPUTS.json',{previousIndex:{path:path.join(previous,'AUDIT.json'),bytes:old.length,sha256:hash(old),commit:'05707e3b0011864154707266f2375d88cf80c6a1'},rawRoot:'/private/tmp/safe-bash-surface-direct-activation-v2-actual-01/capture',node:{path:node,bytes:nodeStat.size,sha256:nodeHash},rawFrames:oldData.frameIndex.length,oldChecks:oldData.checks,oldFailures:oldData.failed.length,noInflation:true});
    const membership=JSON.parse(read(path.join(repository,'tests/compatibility/bash-surface-independent-20260829/virtual-comparison-direct-activation-v2/actual-run-v1/MEMBERSHIP.json')));
    const matrix=JSON.parse(read(path.join(repository,'tests/compatibility/bash-surface-independent-20260829/virtual-comparison-direct-activation-v2/profile/MATRIX.json')));
    write('SCHEMA.json',{observation:membership.observationFiles[0],nativeKeys:Object.keys(matrix.cases[0].nativeObservation),firstChildKeys:Object.keys(membership.childRows[0])});
  } else if(mode==='syntax') {
    for(const name of ['supervise.mjs','audit.mjs']){const result=await child('syntax-'+name,node,['--check',path.join(root,name)]);if(result.code!==0)throw Error('syntax '+name);}
    write('SYNTAX.json',{success:true,files:['supervise.mjs','audit.mjs']});
  } else if(mode==='seal') {
    const files={};for(const name of ['supervise.mjs','audit.mjs','INPUTS.json','PRESEAL.md']){const bytes=read(path.join(root,name));files[name]={bytes:bytes.length,sha256:hash(bytes)};}
    write('SEAL.json',{at:new Date().toISOString(),files,knownRolePlan:26,knownRoleCeiling:32,peak:3,pureAuditProcesses:1,maximumPureAuditProcesses:2});
    let result=await child('stage-preseal',git,[...gitOptions,'add','--',relative,path.relative(repository,path.join(previous,'capture/v2-bootstrap.stdout')),path.relative(repository,path.join(previous,'capture/v2-bootstrap.stderr'))]);if(result.code!==0)throw Error('stage');
    result=await child('commit-preseal',git,[...gitOptions,'commit','--only','-m','test: preseal corrected virtual37 receipt-layer data audit','--',relative,path.relative(repository,path.join(previous,'capture/v2-bootstrap.stdout')),path.relative(repository,path.join(previous,'capture/v2-bootstrap.stderr'))]);if(result.code!==0)throw Error('commit');
  } else if(mode==='audit') {
    const seal=JSON.parse(read(path.join(root,'SEAL.json')));for(const [name,pin]of Object.entries(seal.files)){const bytes=read(path.join(root,name));if(bytes.length!==pin.bytes||hash(bytes)!==pin.sha256)throw Error('seal drift '+name);}
    const result=await child('audit',node,[path.join(root,'audit.mjs'),path.join(root,'INPUTS.json')],60000);
    write('EXECUTION.json',{...result,at:new Date().toISOString(),helperExit:result.code,knownClosed:true});
    if(result.code!==0)process.exitCode=1;
  } else if(mode==='publish') {
    write('PUBLICATION-LOCATION.json',{captureRoot,at:new Date().toISOString(),qualification:'Independent direct-file publication capture outside the committed tree; inspect final events/exit, not a fabricated pre-commit completion.'});
    const sampled=snapshot(root);if(sampled.bytes>192*1024*1024)throw Error('own working ceiling');
    write('PUBLICATION-SNAPSHOT.json',sampled);event({event:'immutable-local-snapshot',bytes:sampled.bytes,entries:sampled.entries});
    let result=await child('stage-results',git,[...gitOptions,'add','--',relative]);if(result.code!==0)throw Error('stage results');
    result=await child('commit-results',git,[...gitOptions,'commit','--only','-m','test: publish virtual37 receipt-layer data adjudication','--',relative]);if(result.code!==0)throw Error('commit results');
    result=await child('owned-status',git,[...gitOptions,'status','--porcelain=v1','--untracked-files=normal','--',relative]);if(result.code!==0)throw Error('owned status');
    event({event:'publication-finished',note:'publication transcript is live post-commit evidence, not falsely claimed part of preceding commit'});
    console.log(JSON.stringify({captureRoot,code:0,scope:relative}));
  } else throw Error('unsupported explicit mode');
}
try {await main();event({event:'owner-complete',pid:process.pid,code:process.exitCode??0});}
catch(error){event({event:'primary',present:true,message:String(error),stack:error?.stack});console.error(error);process.exitCode=1;}
finally {fs.closeSync(eventFile);}
