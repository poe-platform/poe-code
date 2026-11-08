import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const repo='/Users/kjopek/Workspace/safe-bash';
const author=path.join(repo,'tests/compatibility/bash-ere-runtime-integration-author-20260829/rebind-v1/producer-v2');
const mode=process.argv[2];
const capture=mode==='publish'?fs.mkdtempSync('/tmp/ere-producer-independent-publication-'):path.join(root,'capture');
fs.mkdirSync(capture,{recursive:true});
const events=fs.openSync(path.join(capture,mode+'.events.jsonl'),'wx');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function event(value){fs.writeSync(events,JSON.stringify({at:new Date().toISOString(),...value})+'\n');fs.fsyncSync(events);}
function read(file,max=2097152){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>max)throw Error('bounded regular input '+file);const bytes=fs.readFileSync(file);if(bytes.length!==stat.size)throw Error('read size drift');return bytes;}
function write(name,value){fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
async function child(label,exe,args,timeout=30000,input){
  const out=path.join(capture,label+'.stdout'),err=path.join(capture,label+'.stderr');
  const stdout=fs.openSync(out,'wx'),stderr=fs.openSync(err,'wx');event({event:'capture-open',label});
  let failurePresent=false,failure,exitSeen=false;
  try{const proc=spawn(exe,args,{cwd:repo,stdio:[input===undefined?'ignore':'pipe',stdout,stderr],env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
    const done=new Promise(resolve=>{proc.on('error',error=>{failurePresent=true;failure=error;});proc.on('exit',(code,signal)=>{exitSeen=true;event({event:'exit',label,pid:proc.pid,code,signal});});proc.on('close',(code,signal)=>resolve({code,signal}));});
    event({event:'enrolled',label,pid:proc.pid,exe,args});if(input!==undefined){proc.stdin.on('error',error=>{failurePresent=true;failure=error;});proc.stdin.end(input);}let timedOut=false;const timer=setTimeout(()=>{timedOut=true;proc.kill('SIGKILL');},timeout);const result=await done;clearTimeout(timer);fs.fsyncSync(stdout);fs.fsyncSync(stderr);event({event:'close',label,pid:proc.pid,...result,exitSeen,timedOut,failurePresent});
    if(!exitSeen||timedOut||failurePresent||result.signal!==null)throw Error('known retirement STOP '+String(failure));return {...result,stdout:out,stderr:err};
  }finally{fs.closeSync(stdout);fs.closeSync(stderr);event({event:'capture-closed',label});}
}
const node='/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const git='/usr/bin/git';
const options=['-c','gc.auto=0','-c','maintenance.auto=false','-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','core.abbrev=40'];
async function main(){
  event({event:'owner-start',mode,pid:process.pid});
  if(mode==='inspect'){
    write('START.json',{at:new Date().toISOString(),budget:{minutes:15,knownOS:32,peak:3,capture:50331648,work:201326592},scope:'SOURCE/DATA producer-only; no runtime/build/consumer execution'});
    const names=fs.readdirSync(author).sort();const records=[];
    for(const name of names){const file=path.join(author,name),stat=fs.lstatSync(file);if(!stat.isFile())continue;records.push({name,bytes:stat.size});if(name==='HANDOFF.md'){const text=read(file,65536);fs.writeFileSync(path.join(root,'HANDOFF.raw'),text,{flag:'wx'});}}
    write('AUTHOR-LOCATORS.json',{author,files:records});
    const result=await child('committed-handoff',git,[...options,'show','439138a0e13595a41e84841f83e4f2f51b36ff68:'+path.relative(repo,path.join(author,'HANDOFF.md'))]);if(result.code!==0)throw Error('handoff authority');
    if(!read(result.stdout).equals(read(path.join(root,'HANDOFF.raw'))))throw Error('handoff mutable mismatch');
    const digest=crypto.createHash('sha256');const stat=fs.lstatSync(node);if(!stat.isFile()||stat.size>134217728)throw Error('node type/size');for await(const bytes of fs.createReadStream(node,{highWaterMark:65536}))digest.update(bytes);
    const sha256=digest.digest('hex');if(sha256!=='5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011')throw Error('node hash');write('TOOL.json',{path:node,bytes:stat.size,sha256});
  }else if(mode==='details'){
    const details={};for(const name of ['SEAL.json','RESULT.json','PRE-INFLATE-RECEIPT.json','PACKAGE-MANIFEST.json']){const bytes=read(path.join(author,name));const value=JSON.parse(bytes);details[name]={bytes:bytes.length,sha256:hash(bytes),value:name==='PACKAGE-MANIFEST.json'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,Array.isArray(item)?{length:item.length,first:item[0]}:item])):value};}
    details.parentFiles=fs.readdirSync(path.dirname(author)).sort();write('DETAILS.json',details);
    const result=await child('committed-seal',git,[...options,'show','fe109f8b8b18c18188b79f2dfd64f68ca0940fdb:'+path.relative(repo,path.join(author,'SEAL.json'))]);if(result.code!==0)throw Error('seal authority');
    if(!read(result.stdout).equals(read(path.join(author,'SEAL.json'))))throw Error('seal mutable mismatch');
  }else if(mode==='bind'){
    const rows=[['65e4d29173ed2cbef981f356a5527e5b88cd7a13',path.join(author,'PRE-INFLATE-RECEIPT.json')],['439138a0e13595a41e84841f83e4f2f51b36ff68',path.join(author,'PACKAGE-MANIFEST.json')],['22260dd7',path.join(path.dirname(author),'SOURCE-REPORT.json')]];
    for(const name of ['positive.mts','negative.mts','produce.outer.jsonl','A09.stdout','A09.stderr','A12.stdout','A12.stderr','A15.stdout','A15.stderr'])rows.push(['22260dd7',path.join(path.dirname(author),name)]);
    const pins=rows.map(([commit,file])=>{const bytes=read(file);return {commit,path:file,bytes:bytes.length,sha256:hash(bytes)};});
    const result=await child('committed-inputs',git,[...options,'cat-file','--batch'],30000,rows.map(([commit,file])=>commit+':'+path.relative(repo,file)).join('\n')+'\n');if(result.code!==0)throw Error('input Git binding');
    const batch=read(result.stdout,8388608);let position=0;for(const pin of pins){const newline=batch.indexOf(10,position);if(newline<0)throw Error('Git frame');const header=batch.subarray(position,newline).toString().split(' ');position=newline+1;if(header[1]!=='blob'||Number(header[2])!==pin.bytes)throw Error('Git blob type/size '+pin.path);const bytes=batch.subarray(position,position+pin.bytes);position+=pin.bytes+1;if(hash(bytes)!==pin.sha256)throw Error('committed input mismatch');}if(position!==batch.length)throw Error('extra Git frame');
    write('INPUTS.json',{author,pins,archive:{bytes:908381,sha256:'4f90df04dba998f184473254bb450f9e085b9fc9d5994dc91a21a7ccf1d1d66e'},source:{bytes:118730,sha256:'4cee9ef732e44e8c7eba1c64d44015762ee6e0be72488dfcd6bf0f44a80bcb6e'},sealSha256:'f78151de4b59220dc906ee29600f19fb5ed90ee99d88985093d422ea8d54e934'});
  }else if(mode==='syntax'){
    for(const name of ['supervise.mjs','audit.mjs']){const result=await child('syntax-'+name,node,['--check',path.join(root,name)]);if(result.code!==0)throw Error('syntax '+name);}
  }else if(mode==='seal'){
    const files={};for(const name of ['supervise.mjs','audit.mjs','PRESEAL.md','INPUTS.json','TOOL.json']){const bytes=read(path.join(root,name));files[name]={bytes:bytes.length,sha256:hash(bytes)};}write('SEAL.json',{at:new Date().toISOString(),files});
    let result=await child('stage-preseal',git,[...options,'add','--',path.relative(repo,root)]);if(result.code!==0)throw Error('stage');result=await child('commit-preseal',git,[...options,'commit','--only','-m','test: preseal ERE producer-only independent audit','--',path.relative(repo,root)]);if(result.code!==0)throw Error('commit');
  }else if(mode==='audit'){
    const seal=JSON.parse(read(path.join(root,'SEAL.json')));for(const [name,pin]of Object.entries(seal.files)){const bytes=read(path.join(root,name));if(bytes.length!==pin.bytes||hash(bytes)!==pin.sha256)throw Error('seal drift');}
    const result=await child('audit',node,[path.join(root,'audit.mjs')],60000);write('EXECUTION.json',{...result,at:new Date().toISOString()});if(result.code!==0)process.exitCode=1;
  }else if(mode==='publish'){
    write('PUBLICATION-LOCATION.json',{capture,at:new Date().toISOString()});
    let bytes=0,entries=0;const files=[];function visit(dir){for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),stat=fs.lstatSync(file);entries++;if(stat.isDirectory())visit(file);else{if(!stat.isFile())throw Error('owned nonregular');bytes+=stat.size;files.push({path:path.relative(root,file),bytes:stat.size,sha256:hash(read(file,16777216))});}}}visit(root);const snapshot=Object.freeze({root,at:new Date().toISOString(),bytes,entries,files});if(bytes>201326592)throw Error('working cap');write('PUBLICATION-SNAPSHOT.json',snapshot);event({event:'immutable-local-snapshot',bytes,entries});
    let result=await child('stage-results',git,[...options,'add','--',path.relative(repo,root)]);if(result.code!==0)throw Error('stage');result=await child('commit-results',git,[...options,'commit','--only','-m','test: publish ERE source and producer binding review','--',path.relative(repo,root)]);if(result.code!==0)throw Error('commit');const commitText=read(result.stdout).toString();result=await child('owned-status',git,[...options,'status','--porcelain=v1','--untracked-files=normal','--',path.relative(repo,root)]);if(result.code!==0)throw Error('status');console.log(JSON.stringify({capture,code:0,commitText,ownedStatus:read(result.stdout).toString(),snapshot:{bytes:snapshot.bytes,entries:snapshot.entries}}));
  }else throw Error('unsupported explicit mode');
}
try{await main();event({event:'owner-complete',mode,pid:process.pid,code:process.exitCode??0});}catch(error){event({event:'primary',present:true,message:String(error),stack:error?.stack});console.error(error);process.exitCode=1;}finally{fs.closeSync(events);}
