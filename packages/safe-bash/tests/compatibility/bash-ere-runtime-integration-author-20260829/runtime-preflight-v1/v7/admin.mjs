import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {SourceTextModule} from 'node:vm';
const root=path.dirname(new URL(import.meta.url).pathname),repo='/Users/kjopek/Workspace/safe-bash',mode=process.argv[2];
const deadline=Math.floor(fs.statSync('/tmp/core70-v7-author-bootstrap-20260829.stdout').birthtimeMs)+1200000;
const capture=fs.mkdtempSync('/tmp/core70-v7-'+mode+'-'),journal=fs.openSync(capture+'/events.jsonl','wx',0o600);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const log=row=>{fs.writeSync(journal,JSON.stringify({at:new Date().toISOString(),...row})+'\n');fs.fsyncSync(journal);};
function read(file){const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=4194304,file);const bytes=fs.readFileSync(file);assert.equal(bytes.length,stat.size);return bytes;}
function write(name,value){fs.writeFileSync(root+'/'+name,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
const pin=file=>{const stat=fs.lstatSync(file);return{path:file,bytes:stat.size,mode:stat.mode&511,sha256:hash(read(file))};};
async function child(label,exe,args){assert(Date.now()<deadline);const stdout=fs.openSync(capture+'/'+label+'.stdout','wx',0o600),stderr=fs.openSync(capture+'/'+label+'.stderr','wx',0o600);try{const proc=spawn(exe,args,{cwd:repo,stdio:['ignore',stdout,stderr],env:{PATH:'/usr/bin:/bin',HOME:root,TMPDIR:root,LC_ALL:'C',LANG:'C',TZ:'UTC'}});let exited=false;const done=new Promise(resolve=>{proc.on('error',reason=>log({label,error:String(reason)}));proc.on('exit',(code,signal)=>{exited=true;log({event:'exit',label,pid:proc.pid,code,signal});});proc.on('close',(code,signal)=>resolve({code,signal}));});log({event:'start',label,pid:proc.pid,exe,args});const timer=setTimeout(()=>proc.kill('SIGKILL'),Math.min(60000,deadline-Date.now()));const result=await done;clearTimeout(timer);log({event:'close',label,pid:proc.pid,exited,...result});assert(exited&&result.signal===null,'unknown retirement/deadline STOP');fs.fsyncSync(stdout);fs.fsyncSync(stderr);return{...result,pid:proc.pid,stdout:capture+'/'+label+'.stdout',stderr:capture+'/'+label+'.stderr'};}finally{fs.closeSync(stdout);fs.closeSync(stderr);}}
async function git(label,args){const result=await child(label,'/usr/bin/git',['-c','gc.auto=0','-c','maintenance.auto=false','-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','core.abbrev=40',...args]);assert.equal(result.code,0);return read(result.stdout);}
async function main(){assert(Date.now()<deadline);log({event:'owner-start',pid:process.pid,mode});
 if(mode==='seal'){
  const recipe=JSON.parse(read(root+'/BINDING-RECIPE.json'));assert.equal(hash(read(root+'/cell.mjs')),recipe.newCellSha256);assert.equal(hash(read(root+'/dispatch.mjs')),recipe.newDispatchSha256);
  const source=read(root+'/cell.mjs').toString(),body=source.slice(source.indexOf('  const cell = JSON.parse('),source.indexOf('} catch (error) {\n  failures.record'));
  assert.equal(hash(Buffer.from(body)),recipe.unchangedBody.sha256);
  const files=['event-writer.mjs','finalize-cell.mjs','cell.mjs','dispatch.mjs','controls.mjs','admin.mjs'];for(const name of files)new SourceTextModule(read(root+'/'+name).toString(),{identifier:name});
  const node={path:'/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node',bytes:112989184,sha256:'5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011'};const stat=fs.lstatSync(node.path);assert(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,node.bytes);const digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(node.path,{highWaterMark:65536}))digest.update(chunk);assert.equal(digest.digest('hex'),node.sha256);
  write('EXECUTION-SEAL.json',{deadline,node,files:files.map(name=>pin(root+'/'+name)),recipe:pin(root+'/BINDING-RECIPE.json'),oldCell:pin(path.dirname(root)+'/v4/cell-v4.mjs'),expectedGroups:12,maximumHelpers:3,plannedNative:0,plannedWorkers:0,permissionArgs:['--permission','--allow-fs-read='+root,'--allow-fs-read='+path.dirname(root)+'/v4/cell-v4.mjs','--allow-fs-write='+root+'/CONTROL-RESULT.json'],sourceSyntax:files.length,actualProduct:0});
  await git('add',['add','--',path.relative(repo,root)]);const committed=await git('commit',['commit','--only','-m','Author bounded CORE70 v7 event writer and seal controls','--',path.relative(repo,root)]);fs.writeSync(3,committed);
 }
 if(mode==='control'){
  const seal=JSON.parse(read(root+'/EXECUTION-SEAL.json'));for(const row of [...seal.files,seal.recipe,seal.oldCell]){assert.equal(hash(read(row.path)),row.sha256);assert.equal(fs.lstatSync(row.path).size,row.bytes);}
  const result=await child('controls',seal.node.path,[...seal.permissionArgs,root+'/controls.mjs']);write('CONTROL-EXECUTION.json',result);for(const row of [...seal.files,seal.recipe,seal.oldCell])assert.equal(hash(read(row.path)),row.sha256);
  const tests=JSON.parse(read(root+'/CONTROL-RESULT.json'));assert.equal(tests.rows.length,12);write('CONTROL-EVIDENCE.json',{at:new Date().toISOString(),result,tests,sealSha256:hash(read(root+'/EXECUTION-SEAL.json')),bodySha256:JSON.parse(read(root+'/BINDING-RECIPE.json')).unchangedBody.sha256,product:0,Workers:0,native:0});fs.writeSync(3,JSON.stringify({code:result.code,pass:tests.pass,fail:tests.fail,at:new Date().toISOString(),capture})+'\n');if(result.code!==0)process.exitCode=1;
 }
 if(mode==='publish'){
  const raw=root+'/raw';fs.mkdirSync(raw);for(const name of fs.readdirSync('/tmp').sort()){if(!name.startsWith('core70-v7-author-')||(!name.endsWith('.stdout')&&!name.endsWith('.stderr'))||name.includes('publish'))continue;const bytes=read('/tmp/'+name);fs.writeFileSync(raw+'/'+name,bytes,{flag:'wx'});}
  const execution=JSON.parse(read(root+'/CONTROL-EXECUTION.json'));for(const [name,file]of [['controls.stdout',execution.stdout],['controls.stderr',execution.stderr],['control-events.jsonl',path.dirname(execution.stdout)+'/events.jsonl']])fs.writeFileSync(raw+'/'+name,read(file),{flag:'wx'});
  const rows=[];function walk(directory){for(const name of fs.readdirSync(directory).sort()){const file=directory+'/'+name,stat=fs.lstatSync(file);assert(!stat.isSymbolicLink());if(stat.isDirectory())walk(file);else rows.push(pin(file));}}walk(root);const bytes=rows.reduce((sum,row)=>sum+row.bytes,0);assert(bytes<384*1048576);write('PUBLICATION-SNAPSHOT.json',{at:new Date().toISOString(),domain:'current v7 regular files, before this snapshot and active publication tail; Git internal storage excluded',bytes,rows});
  await git('add',['add','--',path.relative(repo,root)]);const committed=await git('commit',['commit','--only','-m','Record CORE70 v7 writer controls and prospective resource bounds','--',path.relative(repo,root)]);const status=await git('status',['status','--porcelain','--untracked-files=all','--',path.relative(repo,root)]);assert.equal(status.length,0);fs.writeSync(3,committed);fs.writeSync(3,JSON.stringify({cleanOwned:true,at:new Date().toISOString(),capture,bytes,sealSha256:hash(read(root+'/EXECUTION-SEAL.json')),evidenceSha256:hash(read(root+'/CONTROL-EVIDENCE.json'))})+'\n');
 }
 log({event:'owner-complete',pid:process.pid,mode});fs.writeSync(3,JSON.stringify({mode,capture,at:new Date().toISOString()})+'\n');
}
try{await main();}catch(reason){log({event:'failure',present:true,reason:String(reason),stack:reason?.stack});console.error(reason);process.exitCode=1;}finally{fs.closeSync(journal);}
