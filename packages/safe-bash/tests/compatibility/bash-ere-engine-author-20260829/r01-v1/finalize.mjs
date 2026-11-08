import assert from 'node:assert/strict';
import { open,lstat,readFile,writeFile,readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname,join,resolve,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const own=dirname(fileURLToPath(import.meta.url)),root=resolve(own,'../../../..'),outer=await open(join(own,'FINALIZE.outer.jsonl'),'wx');
const started=Date.now(),children=[];let captured=0;
const event=value=>outer.write(JSON.stringify({at:new Date().toISOString(),...value})+'\n');
await event({event:'start',pid:process.pid,role:'DATA-publication-only'});
async function hash(path){const stat=await lstat(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=128*1024*1024);const digest=createHash('sha256');let size=0;for await(const chunk of createReadStream(path,{highWaterMark:65536})){size+=chunk.length;assert.ok(size<=stat.size);digest.update(chunk);}assert.equal(size,stat.size);return{path,size,mode:stat.mode&511,sha256:digest.digest('hex')};}
async function text(path){const stat=await lstat(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=2*1024*1024);return readFile(path,'utf8');}
async function bound(row){assert.deepEqual(await hash(row.path),row,'SAFETY retained input/output identity');}
async function git(args,name){
 assert.ok(children.length<8&&Date.now()-started<300000);const stdout=await open(join(own,`final-${name}.stdout`),'wx'),stderr=await open(join(own,`final-${name}.stderr`),'wx');
 const row={name,args,pid:null,closed:false,code:null,signal:null},chunks=[];let fault,writing=Promise.resolve();
 const child=spawn('/usr/bin/git',['-c','gc.auto=0','-c','maintenance.auto=false','-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false',...args],{cwd:root,env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME,LANG:'C',LC_ALL:'C'},stdio:['ignore','pipe','pipe']});children.push(row);row.pid=child.pid??null;
 const closed=new Promise(resolveClose=>{child.once('error',error=>{fault=error;});child.once('close',(code,signal)=>{row.closed=true;row.code=code;row.signal=signal;resolveClose();});});
 const accept=(target,chunk,save)=>{captured+=chunk.length;if(captured>8*1024*1024){fault=new Error('capture cap');child.kill('SIGKILL');return;}if(save)chunks.push(chunk);writing=writing.then(()=>target.write(chunk)).catch(error=>{fault=error;child.kill('SIGKILL');});};
 child.stdout.on('data',chunk=>accept(stdout,chunk,true));child.stderr.on('data',chunk=>accept(stderr,chunk,false));const timer=setTimeout(()=>{fault=new Error('Git deadline');child.kill('SIGKILL');},30000);
 await closed;clearTimeout(timer);await writing;await stdout.close();await stderr.close();await event(row);if(fault||row.signal||row.code!==0)throw fault??new Error('Git publication failure');return Buffer.concat(chunks);
}
try{
 const sealPath=join(own,'SEAL.json'),sealBinding=await hash(sealPath);assert.equal(sealBinding.sha256,'c87cadc0ca841bc3c07bd4110fbce3419b696ecae331ed433bc7bb1a0f5945b0');const seal=JSON.parse(await text(sealPath)),resultPath=join(own,'ACTUAL-01/RESULT.json'),result=JSON.parse(await text(resultPath));
 for(const row of [...seal.sources,...seal.fixtures,...seal.originals,...result.finalCensus])await bound(row);
 assert.equal(result.children,28);assert.equal(result.active,0);assert.ok(result.receipts.every(row=>row.closed&&row.signal===null));
 const main=result.rows.filter(row=>!row.mutated&&!row.role.endsWith('-restored'));assert.equal(main.reduce((sum,row)=>sum+row.observed.pass,0),354);assert.ok(main.every(row=>row.observed.fail===0));assert.ok(result.mutants.every(row=>row.loaded&&row.activated&&row.killed&&row.restored));
 const paths=[],raw=[];for(const name of(await readdir(join(own,'ACTUAL-01'))).sort()){const path=join(own,'ACTUAL-01',name);if(name==='work')continue;const row=await hash(path);raw.push(row);paths.push(relative(root,path));}
 const snapshots=result.finalCensus.filter(row=>row.path.includes('/source/')||row.path.includes('/emitted/')||row.path.includes('/physically-moved-app/artifact/'));for(const row of snapshots)paths.push(relative(root,row.path));
 const report={sourceCommit:'72187e5abc1179883f85a63e1ef558f2e141c542',sourceBindings:seal.sources,seal:sealBinding,result:await hash(resultPath),raw,snapshots,perLayout:{author66:66,checkpoints:8,empty:4,independentPolicy:24,nativeVisible:12,targeted:4,total:118},layoutPasses:354,types:result.types,declarations:result.declarations,mutants:result.mutants,guards:result.guards,children:result.receipts,elapsedMs:result.elapsedMs,captureBytes:result.captureBytes,workBytes:result.workBytes,runtimeRestrictions:{workers:0,loaders:0,transport:0,shellEre:0,native:0,network:0,private:0},status:'AUTHOR ONLY; different verifier required'};
 await writeFile(join(own,'SUMMARY.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 for(const name of ['HANDOFF.md','SUMMARY.json','finalize.mjs','PRESEAL-COMMIT.log','ACTUAL-LAUNCH.log','ACTUAL-DATA-READ.log','ACTUAL.stdout','ACTUAL.stderr','run-ACTUAL-01.outer.jsonl','FINALIZE-EDIT.log','FINALIZE-LAUNCH.log'])paths.push(relative(root,join(own,name)));
 const before=await git(['diff','--cached','--raw','--no-abbrev','-z'],'index-before');const preindex=await readFile(join(own,'PREINDEX.nul'));await event({event:'index-before',matchesPreseal:Buffer.compare(before,preindex)===0,qualification:'concurrent foreign staging is not owned or modified; immediate before/after publication is checked separately'});
 await git(['add','--',...paths],'add');await git(['commit','--only','-m','test: preserve R01 reporting author validation and policy lineage','--',...paths],'commit');
 const commit=(await git(['rev-parse','HEAD'],'identity')).toString('utf8').trim(),after=await git(['diff','--cached','--raw','--no-abbrev','-z'],'index-after');assert.equal(Buffer.compare(before,after),0,'foreign index preservation');
 for(const row of seal.sources)await bound(row);for(const row of raw)await bound(row);
 const finish={commit,completed:new Date().toISOString(),children:children.length,retired:children.filter(row=>row.closed).length,captureBytes:captured,elapsedMs:Date.now()-started,foreignIndexUnchanged:true,sourcesAndRawUnchanged:true};await writeFile(join(own,'FINALIZE-RESULT.json'),JSON.stringify(finish,null,2)+'\n',{flag:'wx'});await event({event:'complete',...finish});console.log(JSON.stringify(finish));
}catch(error){await event({event:'STOP',reason:String(error?.stack??error),children});console.error(String(error?.stack??error));process.exitCode=1;}finally{await outer.close();}
