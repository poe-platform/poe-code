import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,openSync,closeSync,lstatSync,linkSync,unlinkSync,renameSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const owned=dirname(fileURLToPath(import.meta.url)),binding=JSON.parse(readFileSync(join(owned,'BINDINGS.json'))),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const[name,identity]of Object.entries(binding.files))assert.equal(sha(readFileSync(join(binding.driver,name))),identity.sha256);
for(const[path,identity]of Object.entries(binding.tools))assert.equal(sha(readFileSync(path)),identity.sha256);
const temporary=binding.temporary,raw=join(temporary,'raw');mkdirSync(raw);const canary=join(temporary,'outside-canary');writeFileSync(canary,'outside-canary',{flag:'wx'});
const outsideDirectory=join(temporary,'outside-directory');mkdirSync(outsideDirectory);writeFileSync(join(outsideDirectory,'benign'),'outside-directory-canary');
const preconditions={};linkSync(canary,join(temporary,'benign-hardlink'));preconditions.hardlink=lstatSync(canary).ino===lstatSync(join(temporary,'benign-hardlink')).ino;unlinkSync(join(temporary,'benign-hardlink'));const directoryInode=lstatSync(outsideDirectory).ino;renameSync(outsideDirectory,outsideDirectory+'-renamed');renameSync(outsideDirectory+'-renamed',outsideDirectory);preconditions.directoryRename=lstatSync(outsideDirectory).ino===directoryInode;assert.ok(preconditions.hardlink&&preconditions.directoryRename);
const canaryStat=lstatSync(canary),descriptor=openSync(canary,'r+'),phases=['outside-links','alias-targets','physical-imports','descendants','shipping-fds'];
const config={driver:binding.driver,probe:join(owned,'probe.mjs'),guard:join(temporary,'guard.mjs'),canary,canaryIdentity:{device:canaryStat.dev,inode:canaryStat.ino},outsideDirectory,outsideTarget:join(temporary,'outside-publication'),phases};
const guard=spawnSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git',['--no-replace-objects','show',binding.candidate+':tests/integration/full-gate-20260827/combined-8670ebe8/import-guard.mjs'],{cwd:'/Users/kjopek/Workspace/safe-bash',encoding:'buffer',timeout:10000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});assert.equal(guard.status,0);writeFileSync(config.guard,guard.stdout);writeFileSync(join(temporary,'input.json'),JSON.stringify(config));
const {superviseFencedWorker}=await import(pathToFileURL(join(binding.driver,'fenced-supervisor.mjs')).href);
const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{},detached:true,stdio:'ignore'});
const result={startedAt:new Date().toISOString(),source:binding.source,policySha256:sha(readFileSync(join(owned,'POLICY.json'))),preconditions,canary:{path:canary,parentDescriptor:descriptor,before:sha(readFileSync(canary))},sentinel:{pid:sentinel.pid},controls:[],fullGate:false};
try{
  const output='/tmp/unified76-build-types-review-resolved-write-v9-'+process.pid,outer=join(raw,'outer');mkdirSync(outer);
  result.shipping=await superviseFencedWorker({output,outer,script:join(owned,'worker.mjs'),args:[join(temporary,'input.json')],cwd:temporary,environment:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},phases,limits:{timeoutMs:180000,maxOutputBytes:1048576,observeSockets:true}});
  process.kill(sentinel.pid,0);result.sentinel.survived=true;result.canary.after=sha(readFileSync(canary));assert.equal(result.canary.before,result.canary.after);
  if(existsSync(join(output,'INDEPENDENT-WORKER.json')))result.worker=JSON.parse(readFileSync(join(output,'INDEPENDENT-WORKER.json')));
  for(const phase of phases)if(existsSync(join(output,phase+'.stdout')))result.controls.push({id:phase,status:result.shipping.phaseReceipt.events.find(row=>row.label===phase)?.result?.status,stdout:readFileSync(join(output,phase+'.stdout'),'utf8'),stderr:readFileSync(join(output,phase+'.stderr'),'utf8')});
  assert.ok(result.shipping.clean&&result.shipping.result.status===0,'resolved-write safety cohort failed');result.status='SCOPED_RESOLVED_WRITE_SAFETY_PASS';
}catch(error){result.status='HOLD_STOP_ARCHIVE_AND_A10';result.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{closeSync(descriptor);sentinel.kill('SIGTERM');await new Promise(resolve=>sentinel.once('close',(code,signal)=>{result.sentinel.close={code,signal};resolve();}));result.finishedAt=new Date().toISOString();writeFileSync(join(owned,'SAFETY-RESULTS.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:result.status,controls:result.controls.map(row=>({id:row.id,status:row.status})),error:result.error,sentinel:result.sentinel}));}
