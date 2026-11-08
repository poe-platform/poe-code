import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const phase=process.argv[2];
const fd=fs.openSync(root+'/'+phase+'.jsonl','wx');
const log=value=>fs.writeSync(fd,JSON.stringify(value)+'\n');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const read=(file,maximum=2097152,pin)=>{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maximum)throw Error('TYPE_SIZE '+file);const bytes=fs.readFileSync(file);if(bytes.length!==stat.size||(pin&&hash(bytes)!==pin))throw Error('HASH '+file);return bytes;};
const write=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx',mode:0o644});};
const json=value=>JSON.stringify(value,null,2)+'\n';
try{
 log({pid:process.pid,phase,utc:new Date().toISOString()});
 const original=JSON.parse(read(root+'/frozen/CONTROL-SEAL.json',12830,'8fea1b62502ad77f730e68e89a529b339f22b5cb92e121ec6da88b2a09c2172c'));
 const source=JSON.parse(read(root+'/frozen/PRESEAL.json',9140,'60f526f043e7e94b1526f8146d792b342a148efb261ffb3435dfb8b5ea2cc1ff'));
 const tools=[source.canonicalBootstrap.node,source.canonicalBootstrap.zsh,source.canonicalBootstrap.env];
 for(const tool of tools){const stat=fs.lstatSync(tool.path);if(!stat.isFile()||stat.size!==tool.bytes||(stat.mode&4095)!==tool.mode)throw Error('TOOL_STAT');const digest=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(tool.path,{highWaterMark:65536}))digest.update(bytes);if(digest.digest('hex')!==tool.sha256)throw Error('TOOL_HASH');}
 if(phase==='prepare'){
  for(const [name,pin]of Object.entries(original.files))read(root+'/frozen/'+name,pin.bytes,pin.sha256);
  const work=fs.mkdtempSync('/private/tmp/safe-bash-b35-independent-v3-');if(fs.realpathSync(work)!==work)throw Error('CANONICAL');
  const remap=value=>typeof value==='string'?value.replaceAll(original.work,work):Array.isArray(value)?value.map(remap):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[remap(key),remap(item)])):value;
  for(const [file,pin]of Object.entries(original.fixtures)){if(file.endsWith('.trace')||file.endsWith('.role.json'))continue;write(remap(file),read(file,pin.bytes,pin.sha256));}
  const state=remap(original);state.work=work;state.deadline=Date.now()+300000;state.roles=[];
  for(const item of original.roles){const role=remap(JSON.parse(read(item.rolePath,item.rolePin.bytes,item.rolePin.sha256)));const bytes=Buffer.from(json(role));write(role.rolePath,bytes);write(role.trace,Buffer.alloc(0));const row=remap(item);row.rolePin={bytes:bytes.length,sha256:hash(bytes)};row.env.SURFACE_ROLE_BYTES=String(bytes.length);row.env.SURFACE_ROLE_SHA256=hash(bytes);state.roles.push(row);}
  for(const name of ['home','tmp','empty-path','capture'])fs.mkdirSync(work+'/'+name,{recursive:true});write(root+'/STATE.json',json(state));
  const body=read(root+'/frozen/controls.mjs').toString();const begin=body.indexOf(' const check=');const end=body.indexOf(' for(const item of seal.roles)');if(begin<0||end<begin)throw Error('AUTHOR_BLOCK');
  const imports="import assert from 'node:assert/strict';\nimport {readPinned,hash} from './frozen/auth.mjs';\nimport {finalize} from './frozen/finalization.mjs';\nimport {finishOwner} from './frozen/owner-finalization.mjs';\nimport {canonicalRoot,assertOwned} from './frozen/canonical.mjs';\nimport {qualifyDirect} from './frozen/direct-child.mjs';\nimport {validateActivation} from './frozen/activation.mjs';\nimport {preauthRecord} from './frozen/preauth.mjs';\n";
  write(root+'/author-pure.mjs',imports+'export function replay(root,seal,packet,results){\n'+body.slice(begin,end)+'\n}\n');
  const priorRoot=path.resolve(root,'../preexec-v2');const priorSeal=JSON.parse(read(priorRoot+'/INDEPENDENT-PRESEAL.json'));const priorPin=priorSeal.bindings.find(row=>row.path==='pure.mjs');const prior=read(priorRoot+'/pure.mjs',priorPin.bytes,priorPin.sha256).toString();const first=prior.indexOf("check('N01'");const last=prior.indexOf('const ledger=',first);if(first<0||last<first)throw Error('PRIOR_BLOCK');
  write(root+'/prior-eight.mjs',"import assert from 'node:assert/strict';\nimport {wire,finishOwner} from './frozen/owner-finalization.mjs';\nimport {canonicalRoot,assertOwned} from './frozen/canonical.mjs';\nimport {caseArguments} from './frozen/profile.mjs';\nimport {readPinned} from './frozen/auth.mjs';\nimport {validateActivation} from './frozen/activation.mjs';\nexport function replayPrior(state,novel){\nconst check=(id,body)=>{try{body();novel.push({id,pass:true});}catch(error){novel.push({id,pass:false,error:String(error)});}};\nconst valid=()=>({started:state.activationExpected.started,grant:{...structuredClone(state.validGrant),work:state.work},review:structuredClone(state.validReview)});\nconst refuses=(grant,review,work,started)=>{try{validateActivation(grant,review,{...state.activationExpected,work,started});return false;}catch(error){if(!error.message.startsWith('AUTH_'))throw error;return true;}};\n"+prior.slice(first,last)+'\n}\n');
  const entries=[];for(const name of fs.readdirSync(root)){const file=root+'/'+name;if(fs.lstatSync(file).isFile()&&(name.endsWith('.mjs')||name==='STATE.json'||name==='PLAN.md')){const bytes=read(file);entries.push({path:name,bytes:bytes.length,sha256:hash(bytes)});}}
  for(const [name,pin]of Object.entries(original.files))entries.push({path:'frozen/'+name,...pin});
  const seal={schema:1,source:'d97a038f742ac06872a30a7c0dd27ea7ab86b640',evidence:'475d165b49f7fbfef49254d2fbcd8314db3b0f81',tools,work,entries,authorGroups:18,priorGroups:8,readinessChildren:2,actualProduct:0,workerStarts:0};write(root+'/INDEPENDENT-PRESEAL.json',json(seal));log({presealSha256:hash(Buffer.from(json(seal))),work,entries:entries.length});
 }else if(phase==='run'){
  const out=fs.openSync(root+'/child.stdout','wx'),err=fs.openSync(root+'/child.stderr','wx');const seal=JSON.parse(read(root+'/INDEPENDENT-PRESEAL.json',32768,process.argv[3]));const verify=()=>{for(const entry of seal.entries)read(root+'/'+entry.path,entry.bytes,entry.sha256);};verify();
  const child=spawn(original.node.path,['--unhandled-rejections=strict','--max-old-space-size=128',root+'/pure.mjs'],{cwd:root,env:{LANG:'C',LC_ALL:'C',TZ:'UTC'},stdio:['ignore','pipe','pipe']});let count=0,stopped=false,exited,kill;
  const stop=reason=>{if(stopped)return;stopped=true;log({stop:String(reason)});child.kill('SIGTERM');kill=setTimeout(()=>child.kill('SIGKILL'),2000);};
  const retain=descriptor=>bytes=>{count+=bytes.length;if(count>4194304){stop('CAPTURE');return;}try{let offset=0;while(offset<bytes.length){const written=fs.writeSync(descriptor,bytes,offset);if(!written)throw Error('SHORT');offset+=written;}}catch(error){stop(error);}};
  child.stdout.on('data',retain(out));child.stderr.on('data',retain(err));child.on('error',stop);child.on('exit',(code,signal)=>{exited={code,signal};});const timer=setTimeout(()=>stop('DEADLINE'),30000);const closed=await new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal})));clearTimeout(timer);clearTimeout(kill);fs.fsyncSync(out);fs.fsyncSync(err);fs.closeSync(out);fs.closeSync(err);verify();log({child:child.pid,exited,closed,stopped,captureBytes:count,postguards:seal.entries.length});if(stopped)throw Error('STOP');
  const result=JSON.parse(read(root+'/RESULT.json'));if(result.readiness.length!==2||result.readiness.some(row=>!row.qualified))throw Error('RETIREMENT_UNKNOWN');
  const files=[];const visit=folder=>{for(const name of fs.readdirSync(folder)){const file=folder+'/'+name;const stat=fs.lstatSync(file);if(stat.isDirectory())visit(file);else if(stat.isFile()){const bytes=read(file);files.push({path:path.relative(seal.work,file),bytes:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')});}else throw Error('WORK_TYPE');}};visit(seal.work);const archive=Buffer.from(json({work:seal.work,files}));if(archive.length>4194304)throw Error('ARCHIVE_CAP');write(root+'/FIXTURE-ARCHIVE.json',archive);fs.rmSync(seal.work,{recursive:true});log({archiveBytes:archive.length,files:files.length,ownedWorkRemoved:true});if(closed.code!==0)process.exitCode=1;
 }else throw Error('PHASE');
}catch(error){log({error:String(error),stack:error?.stack});process.exitCode=1;}finally{fs.fsyncSync(fd);fs.closeSync(fd);}
