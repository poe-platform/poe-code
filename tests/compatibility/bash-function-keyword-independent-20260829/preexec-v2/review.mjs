import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const phase=process.argv[2];
const capture=fs.openSync(root+'/'+phase+'.jsonl','wx');
const log=value=>fs.writeSync(capture,JSON.stringify(value)+'\n');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const read=(file,maximum=131072,pin)=>{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maximum)throw Error('READ_TYPE_SIZE '+file);const bytes=fs.readFileSync(file);if(bytes.length!==stat.size||(pin&&hash(bytes)!==pin))throw Error('READ_HASH '+file);return bytes;};
const write=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx',mode:0o644});};
const json=value=>JSON.stringify(value,null,2)+'\n';
try{
 log({pid:process.pid,phase,started:Date.now()});
 const original=JSON.parse(read(root+'/frozen/CONTROL-PRESEAL-v3.json',11857,'bb0771c8bc25f3de389e592322696730d76540cd58415fa07d103930b49c943a'));
 const node=original.node;const stat=fs.lstatSync(node.path);if(!stat.isFile()||stat.size!==node.bytes||(stat.mode&4095)!==node.mode)throw Error('NODE_STAT');const digest=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(node.path,{highWaterMark:65536}))digest.update(bytes);if(digest.digest('hex')!==node.sha256)throw Error('NODE_HASH');
 if(phase==='prepare'){
  const work=fs.mkdtempSync('/private/tmp/safe-bash-b35-independent-v2-');if(fs.realpathSync(work)!==work)throw Error('CANONICAL');
  const remap=value=>typeof value==='string'?value.replaceAll(original.work,work):Array.isArray(value)?value.map(remap):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[remap(key),remap(item)])):value;
  const roles=[];
  for(const [file,pin]of Object.entries(original.fixtures)){
   if(file.endsWith('.trace')||file.endsWith('.role.json'))continue;
   const bytes=read(file,pin.bytes,pin.sha256);write(remap(file),bytes);
  }
  for(const item of original.roles){const role=remap(JSON.parse(read(item.rolePath,item.rolePin.bytes,item.rolePin.sha256)));const bytes=Buffer.from(json(role));write(role.rolePath,bytes);write(role.trace,Buffer.alloc(0));const mapped=remap(item);roles.push({...mapped,env:{...mapped.env,SURFACE_ROLE_BYTES:String(bytes.length),SURFACE_ROLE_SHA256:hash(bytes)},rolePin:{bytes:bytes.length,sha256:hash(bytes)}});}
  for(const name of ['home','tmp','empty-path','capture'])fs.mkdirSync(work+'/'+name,{recursive:true});
  const controls=read(root+'/frozen/controls-v2.mjs');const text=controls.toString();const begin=text.indexOf(' const check=');const end=text.indexOf(' for(const item of seal.roles)');if(begin<0||end<begin)throw Error('BLOCK');
  const block="import assert from 'node:assert/strict';\nimport {readPinned,hash} from './frozen/auth.mjs';\nimport {finalize} from './frozen/finalization.mjs';\nimport {finishOwner} from './frozen/owner-finalization.mjs';\nimport {canonicalRoot,assertOwned} from './frozen/canonical.mjs';\nimport {qualifyDirect} from './frozen/direct-child.mjs';\nexport function replay(root,seal,packet,results){\n"+text.slice(begin,end)+'\n}\n';write(root+'/author-pure.mjs',block);
  const outer=read(root+'/frozen/outer.mjs').toString();const start=outer.indexOf("if(grant.decision!=='GO'");const finish=outer.indexOf("throw Error('ACTIVATION_PENDING_OR_EXPIRED');",start);if(start<0||finish<start)throw Error('PREDICATE');const expression=outer.slice(start+3,finish-1);write(root+'/predicate.mjs',`export function refuses(grant,review,work,started){return (${expression});}\n`);
  const state={schema:1,work,node,roles,packageBoundary:original.packageBoundary,finalizationSha256:original.finalizationSha256,files:original.files,originalControlSealSha256:'bb0771c8bc25f3de389e592322696730d76540cd58415fa07d103930b49c943a',deadline:Date.now()+180000};write(root+'/STATE.json',json(state));
  const bindings=[];for(const folder of ['', 'frozen/'])for(const name of fs.readdirSync(root+'/'+folder)){const file=root+'/'+folder+name;const info=fs.lstatSync(file);if(!info.isFile()||(!name.endsWith('.mjs')&&!['PLAN.md','STATE.json','PRESEAL.json','fixture-package.json.data','CASES-v2.json','COMMAND-PLAN.json','COMMAND.template.txt','GO.template.json','REVIEW.template.json'].includes(name)))continue;const bytes=read(file);bindings.push({path:folder+name,bytes:bytes.length,sha256:hash(bytes)});}
  write(root+'/INDEPENDENT-PRESEAL.json',json({schema:1,node,bindings,work,authorGroups:12,novelGroups:8,readinessChildren:2,workerStarts:0,productImports:0}));log({prepared:true,work,bindings:bindings.length,presealSha256:hash(read(root+'/INDEPENDENT-PRESEAL.json'))});
 }else if(phase==='bind-relocation'){
  const state=JSON.parse(read(root+'/STATE.json'));const seal=JSON.parse(read(root+'/INDEPENDENT-PRESEAL.json'));
  fs.renameSync(root+'/STATE.json',root+'/STATE-unexecuted-draft.json');fs.renameSync(root+'/INDEPENDENT-PRESEAL.json',root+'/INDEPENDENT-PRESEAL-unexecuted-draft.json');
  for(const item of state.roles){const bytes=read(item.rolePath,item.rolePin.bytes,item.rolePin.sha256);item.env.SURFACE_ROLE_BYTES=String(bytes.length);item.env.SURFACE_ROLE_SHA256=hash(bytes);}
  state.deadline=Date.now()+120000;write(root+'/STATE.json',json(state));
  seal.bindings=seal.bindings.map(row=>{const bytes=read(root+'/'+row.path);return {...row,bytes:bytes.length,sha256:hash(bytes)};});
  write(root+'/INDEPENDENT-PRESEAL.json',json({...seal,draftCorrection:'Before execution: relocated role bytes/hash propagated to exact SURFACE_ROLE metadata; unexecuted draft retained.'}));
  log({presealSha256:hash(read(root+'/INDEPENDENT-PRESEAL.json')),correctedRoles:2});
 }else if(phase==='run'){
  const out=fs.openSync(root+'/child.stdout','wx');const err=fs.openSync(root+'/child.stderr','wx');
  const seal=JSON.parse(read(root+'/INDEPENDENT-PRESEAL.json',32768,process.argv[3]));const verify=()=>{for(const row of seal.bindings)read(root+'/'+row.path,row.bytes,row.sha256);};verify();
  const child=spawn(node.path,['--unhandled-rejections=strict','--max-old-space-size=128',root+'/pure.mjs'],{cwd:root,env:{LANG:'C',LC_ALL:'C',TZ:'UTC',B35_PRESEAL_SHA256:'3099f59a5518757a4fa80f203758536b5101fb8ad8e600c792b338bd5d83539d'},stdio:['ignore','pipe','pipe']});let total=0;let stopped=false;let exited;let kill;
  const stop=reason=>{if(!stopped){stopped=true;log({stop:String(reason)});child.kill('SIGTERM');kill=setTimeout(()=>child.kill('SIGKILL'),2000);}};
  const retain=fd=>bytes=>{total+=bytes.length;if(total>4194304){stop('CAPTURE');return;}try{let offset=0;while(offset<bytes.length){const count=fs.writeSync(fd,bytes,offset);if(!count)throw Error('SHORT');offset+=count;}}catch(error){stop(error);}};
  child.stdout.on('data',retain(out));child.stderr.on('data',retain(err));child.on('error',stop);child.on('exit',(code,signal)=>{exited={code,signal};});const timer=setTimeout(()=>stop('DEADLINE'),30000);const closed=await new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal})));clearTimeout(timer);clearTimeout(kill);fs.fsyncSync(out);fs.fsyncSync(err);fs.closeSync(out);fs.closeSync(err);verify();
  log({child:child.pid,exited,closed,stopped,total,postguards:seal.bindings.length});if(stopped)throw Error('STOP');
  const result=JSON.parse(read(root+'/RESULT.json'));if(result.readiness.some(row=>!row.qualified))throw Error('RETIREMENT');
  const entries=[];const visit=folder=>{for(const name of fs.readdirSync(folder)){const file=folder+'/'+name;const stat=fs.lstatSync(file);if(stat.isDirectory())visit(file);else if(stat.isFile()){const bytes=read(file,1048576);entries.push({path:path.relative(seal.work,file),bytes:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')});}else throw Error('WORK_TYPE');}};visit(seal.work);const archive=Buffer.from(json({work:seal.work,entries}));if(archive.length>4194304)throw Error('ARCHIVE_CAP');write(root+'/FIXTURE-ARCHIVE.json',archive);fs.rmSync(seal.work,{recursive:true});log({archiveBytes:archive.length,files:entries.length,ownedWorkRemoved:true});
  if(closed.code!==0)process.exitCode=1;
 }else throw Error('PHASE');
}catch(error){log({error:String(error),stack:error?.stack});process.exitCode=1;}finally{fs.fsyncSync(capture);fs.closeSync(capture);}
