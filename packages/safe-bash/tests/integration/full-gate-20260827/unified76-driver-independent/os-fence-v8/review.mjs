import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,openSync,closeSync,lstatSync,readdirSync,existsSync,copyFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const owned=dirname(fileURLToPath(import.meta.url)),binding=JSON.parse(readFileSync(join(owned,'BINDINGS.json')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const[name,identity]of Object.entries(binding.files))assert.equal(sha(readFileSync(join(binding.driver,name))),identity.sha256);
for(const[path,identity]of Object.entries(binding.tools))assert.equal(sha(readFileSync(path)),identity.sha256);
const temporary=binding.temporary,raw=join(temporary,'raw');mkdirSync(raw);
const canary=join(temporary,'outside-canary');writeFileSync(canary,'outside-canary',{flag:'wx'});
const outsideDirectory=join(temporary,'outside-directory');mkdirSync(outsideDirectory);writeFileSync(join(outsideDirectory,'benign'),'outside-dir');
const canaryStat=lstatSync(canary),descriptor=openSync(canary,'r+');
const phases=['ordinary','names','imports','descendants','shipping-fds'];
const config={driver:binding.driver,probe:join(owned,'probe.mjs'),guard:join(temporary,'guard.mjs'),canary,canaryIdentity:{device:canaryStat.dev,inode:canaryStat.ino},outsideDirectory,outsideTarget:join(temporary,'outside-publication'),phases};
const git='/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const guard=spawnSync(git,['--no-replace-objects','show',binding.candidate+':tests/integration/full-gate-20260827/combined-8670ebe8/import-guard.mjs'],{cwd:'/Users/kjopek/Workspace/safe-bash',encoding:'buffer',timeout:10000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});assert.equal(guard.status,0);writeFileSync(config.guard,guard.stdout);
writeFileSync(join(temporary,'input.json'),JSON.stringify(config));
const load=name=>import(pathToFileURL(join(binding.driver,name)).href);
const {superviseFencedWorker}=await load('fenced-supervisor.mjs');
const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{},detached:true,stdio:'ignore'});
const result={startedAt:new Date().toISOString(),binding:{source:binding.source,evidence:binding.evidence,driver:binding.normalizedDriverSha256},canary:{path:canary,parentDescriptor:descriptor,before:sha(readFileSync(canary))},sentinel:{pid:sentinel.pid},controls:[],fullGate:false,stopped:false};
try{
  const output='/tmp/unified76-build-types-review-independent-os-v8-'+process.pid;
  const outer=join(raw,'outer');mkdirSync(outer);
  const receipt=await superviseFencedWorker({output,outer,script:join(owned,'worker.mjs'),args:[join(temporary,'input.json')],cwd:temporary,environment:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},phases,limits:{timeoutMs:120000,maxOutputBytes:1048576,observeSockets:true}});
  result.shipping=receipt;process.kill(sentinel.pid,0);result.sentinel.survived=true;
  result.canary.afterShipping=sha(readFileSync(canary));assert.equal(result.canary.before,result.canary.afterShipping);
  const innerFile=join(output,'INDEPENDENT-WORKER.json');if(existsSync(innerFile))result.worker=JSON.parse(readFileSync(innerFile));
  for(const phase of phases){const stdout=join(output,phase+'.stdout'),stderr=join(output,phase+'.stderr');if(existsSync(stdout))result.controls.push({id:phase,status:receipt.phaseReceipt.events.find(row=>row.label===phase)?.result?.status,stdout:readFileSync(stdout,'utf8'),stderr:readFileSync(stderr,'utf8')});}
  assert.ok(receipt.clean&&receipt.result.status===0,'shipping component cohort is not clean');
  const {instructionFenceInvocation}=await load('os-instruction-fence.mjs');
  const invocation=instructionFenceInvocation(receipt.envelope,process.execPath,['-e',"require('node:fs').writeSync(3,Buffer.from('FD-ESCAPE'),0,9,0);console.log('outside ordinary FD write completed')"],{});
  const direct=spawnSync(invocation.executable,invocation.args,{env:invocation.env,stdio:['ignore','pipe','pipe',descriptor],encoding:'utf8',timeout:10000,maxBuffer:65536});
  result.fdLimitation={status:direct.status,signal:direct.signal,stdout:direct.stdout,stderr:direct.stderr,after:sha(readFileSync(canary)),bytes:readFileSync(canary,'utf8'),qualification:'Deliberately unsafe raw descriptor route; not shipping stdio. Do not use this route for archive/product.'};
  assert.equal(direct.status,0);assert.notEqual(result.fdLimitation.after,result.canary.before);
  result.status='COMPONENT_CONTROLS_PASS_WITH_EXPLICIT_FD_LIMITATION';
}catch(error){result.status='HOLD';result.stopped=true;result.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
  closeSync(descriptor);sentinel.kill('SIGTERM');await new Promise(resolve=>sentinel.once('close',(code,signal)=>{result.sentinel.close={code,signal};resolve();}));
  result.canary.final=sha(readFileSync(canary));result.finishedAt=new Date().toISOString();
  const files=[];let total=0;function walk(root){for(const name of readdirSync(root)){const path=join(root,name),stat=lstatSync(path);if(stat.isDirectory())walk(path);else if(stat.isFile()){total+=stat.size;assert.ok(total<=16777216);files.push({path,bytes:stat.size,sha256:sha(readFileSync(path))});}}}walk(raw);result.raw=files;
  writeFileSync(join(owned,'COMPONENT-RESULTS.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:result.status,controls:result.controls.map(row=>({id:row.id,status:row.status})),error:result.error,sentinel:result.sentinel,temporary}));
}
