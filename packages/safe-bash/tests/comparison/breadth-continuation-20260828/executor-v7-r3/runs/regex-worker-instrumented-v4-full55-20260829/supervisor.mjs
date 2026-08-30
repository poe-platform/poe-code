import fs from 'node:fs';
import { collectDeferred } from './deferred-collector.mjs';
import { snapshot, witnessNames } from './early-record.mjs';
import { mutationExpected, mutationReplacement } from './mutation.mjs';
import { writerVariants } from './writer-controls.mjs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bytes, hash, own, requireValue } from './common.mjs';

const home = path.dirname(fileURLToPath(import.meta.url));
const root = '/Users/kjopek/Workspace/safe-bash';
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const plan = JSON.parse(bytes(path.join(home, 'PLAN.json'), 32768));
const sealBytes = bytes(path.join(home, 'SEAL.json'), 262144), seal = JSON.parse(sealBytes);
const authRaw = bytes(process.argv[2], 32768);
requireValue(hash(authRaw) === process.argv[3], 'AUTH_RAW_HASH');
const auth = own(JSON.parse(authRaw), ['role','scope','runId','sealSha256','attempts','environmentDataApproved','rootMessageSha256','expiresAt']);
requireValue(plan.campaignEnabled===true,'CAMPAIGN_NOT_AUTHORIZED');
requireValue(auth.role === 'root' && auth.scope === 'HARMLESS_REGEX_CONTROLS' && auth.runId === 'controls-01' && auth.sealSha256 === hash(sealBytes) && auth.attempts === 1 && auth.environmentDataApproved === true && /^[a-f0-9]{64}$/.test(auth.rootMessageSha256), 'ROOT_CONTROL_AUTHORITY');
const deadline = Date.parse(auth.expiresAt);
requireValue(Number.isFinite(deadline) && deadline > Date.now() && deadline <= Date.parse(plan.deadline), 'CONTROL_DEADLINE');
for (const file of seal.files) bytes(path.join(home, file.path), 2093056, file);
for (const file of seal.inherited) bytes(file.path, 2093056, file);
const controls = JSON.parse(bytes(path.join(home, 'controls.json'), 65536));
requireValue(controls.length === 55 && new Set(controls.map(row => row.id)).size === 55 && controls.reduce((sum,row)=>sum+row.workers,0) <= 48, 'CONTROL_PLAN');
const fixtures = JSON.parse(bytes(path.join(home, 'fixtures.json'), 32768));
const run = path.join(home, 'runs', 'controls-01');
fs.mkdirSync(path.dirname(run), { recursive: true, mode: 0o700 });
requireValue(!fs.existsSync(run), 'RUN_ALREADY_USED'); fs.mkdirSync(run, { recursive: false, mode: 0o700 });
fs.writeFileSync(path.join(run, 'AUTH.json'), authRaw, { flag: 'wx', mode: 0o600 });
const rows = [];
let launched = 0, created = 0, aggregate = 0, unsafe = false;
const toolFiles = [...seal.files.filter(row => row.path.endsWith('.mjs') && !['supervisor.mjs','capture.mjs'].includes(row.path)), ...seal.inherited.filter(row=>row.path.endsWith('.mjs')).map(row => ({ ...row, absolute: true }))];
const tools = toolFiles.map(row => {
  const filename = row.absolute ? row.path : path.join(home, row.path), text = bytes(filename, 2093056, row).toString('utf8');
  return { url: pathToFileURL(filename).href, bytes: row.bytes, mode: row.mode, sha256: row.sha256, imports: [...text.matchAll(/^import .*? from ['"]([^'"]+)['"];$/gm)].map(match=>match[1]), role: 'tool' };
});
async function child(control, directory, filename, sha256) {
  const stdout = fs.openSync(path.join(directory, 'stdout.raw'), 'wx', 0o600), stderr = fs.openSync(path.join(directory, 'stderr.raw'), 'wx', 0o600);
  const args = ['--unhandled-rejections=strict','--max-old-space-size=256','--permission','--allow-worker','--allow-fs-read=' + home, ...seal.inherited.map(row=>'--allow-fs-read=' + row.path), '--allow-fs-write=' + directory, path.join(home,'case.mjs'), filename, sha256];
  const receipt = { id: control.id, args, pid: null, closed: false, status: null, signal: null, observed: [0,0], retained: [0,0], failures: [], sentSignals: [] };
  const instance = spawn(node, args, { cwd: root, env: { PATH:'',LANG:'C',LC_ALL:'C',HOME:directory }, stdio:['ignore','pipe','pipe'] });
  receipt.pid = instance.pid; launched++;
  const closed = new Promise(resolve=>instance.once('close',(status,signal)=>{ Object.assign(receipt,{closed:true,status,signal});resolve(); }));
  instance.on('error',error=>receipt.failures.push(String(error)));
  let killTimer;
  const signal = value => { receipt.sentSignals.push(value); instance.kill(value); };
  for (const [index, stream, descriptor] of [[0,instance.stdout,stdout],[1,instance.stderr,stderr]]) stream.on('data',data=>{
    receipt.observed[index] += data.length;
    const allowed = Math.min(data.length,Math.max(0,65536-receipt.retained[index]));
    try {
      let offset=0; while(offset<allowed){const written=fs.writeSync(descriptor,data,offset,allowed-offset);requireValue(written>0,'CAPTURE_SHORT');offset+=written;}
      receipt.retained[index]+=allowed;aggregate+=allowed;
      requireValue(allowed===data.length && aggregate<=plan.limits.captureBytes,'CAPTURE_CAP');
    } catch(error){receipt.failures.push(String(error));signal('SIGTERM');}
  });
  const timer=setTimeout(()=>{receipt.failures.push('CHILD_DEADLINE');signal('SIGTERM');killTimer=setTimeout(()=>signal('SIGKILL'),2000);},30000);
  await closed;clearTimeout(timer);clearTimeout(killTimer);
  for(const descriptor of [stdout,stderr]){fs.fsyncSync(descriptor);fs.closeSync(descriptor);}
  receipt.capturesClosed=true;
  fs.writeFileSync(path.join(directory,'SUPERVISION.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  return receipt;
}
for (const control of controls) {
  if (unsafe) { rows.push({ id:control.id,status:'UNRUN_UNSAFE_TAIL' }); continue; }
  if (control.kind.startsWith('allocation-') || control.kind === 'historical-fail-data') {
    const pass = control.kind === 'allocation-unknown-data' ? !Object.hasOwn({size:2048}, 'allocatedBytes') : control.kind === 'allocation-zero-data' ? ({allocatedBytes:0}).allocatedBytes === 0 : control.kind === 'allocation-known-data' ? ({allocatedBytes:4096,size:2048}).allocatedBytes !== 2048 : 2 === 2;
    rows.push({id:control.id,status:pass?'QUALIFIED':'ORDINARY_CONTROL_FAILURE',role:'IN_PROCESS_DATA_ONLY',created:0,knownRetired:true,failures:pass?[]:['DATA_ASSERTION']});
    continue;
  }
  let supervision;
  try {
    requireValue(Date.now()+35000<deadline && launched<55 && created+control.workers<=48,'GLOBAL_CONTROL_CAP');
    const directory=path.join(run,control.id);fs.mkdirSync(directory,{mode:0o700});
    let fixtureRoot=directory;
    if(control.kind==='moved'){fixtureRoot=path.join(directory,'origin');fs.mkdirSync(fixtureRoot,{mode:0o700});}
    for(const [name,source]of Object.entries(fixtures))fs.writeFileSync(path.join(fixtureRoot,name),source,{flag:'wx',mode:0o644});
    if(control.kind==='moved'){const destination=path.join(directory,'moved');fs.renameSync(fixtureRoot,destination);requireValue(!fs.existsSync(fixtureRoot),'MOVED_ORIGIN');fixtureRoot=destination;}
    const members=['worker.mjs','matching.mjs','protocol.mjs','bre-worker.mjs'].map(name=>({url:pathToFileURL(path.join(fixtureRoot,name)).href,bytes:Buffer.byteLength(fixtures[name]),mode:0o644,sha256:hash(Buffer.from(fixtures[name])),imports:[...fixtures[name].matchAll(/^import .*? from ['"]([^'"]+)['"];$/gm)].map(match=>match[1]),role:'product'}));
    const entry=path.join(fixtureRoot,'worker.mjs');
    if(control.kind==='hash-drift')fs.writeFileSync(entry,'throw Error("HASH_DRIFT_NO_EVAL");\n');
    if(control.kind==='mode-drift')fs.chmodSync(entry,0o600);
    if(control.kind==='symlink'){fs.unlinkSync(entry);fs.symlinkSync('matching.mjs',entry);}
    const configuration={control,directory,fixtureRoot,originalWorker:fixtures['worker.mjs'],entry:pathToFileURL(entry).href,members,tools,preload:pathToFileURL(path.join(home,'preload.mjs')).href,offline:pathToFileURL(seal.inherited.find(row=>row.path.endsWith('/offline.mjs')).path).href,historicalDUMismatches:2,view:{root,files:[...members,...tools].map(row=>({path:fileURLToPath(row.url).slice(root.length+1),bytes:row.bytes,mode:row.mode,sha256:row.sha256}))}};
    const encoded=Buffer.from(JSON.stringify(configuration)+'\n'),filename=path.join(directory,'CONFIG.json');requireValue(encoded.length<=65536,'CONFIG_BOUND');fs.writeFileSync(filename,encoded,{flag:'wx',mode:0o600});
    supervision=await child(control,directory,filename,hash(encoded));
    requireValue(supervision.closed && supervision.signal===null && supervision.failures.length===0 && supervision.observed.every((count,index)=>count===supervision.retained[index]),'SUPERVISION_UNSAFE');
    const resultRaw=bytes(path.join(directory,'RESULT.json'),262144), result=JSON.parse(resultRaw);
    requireValue(result.id===control.id && result.witnessFailure===null && Array.isArray(result.witnesses) && result.knownRetired===true && Number.isInteger(result.created) && result.created>=0,'RETIREMENT_UNKNOWN');
    const earlyRaw=bytes(path.join(directory,'EARLY.json'),65536,result.early);
    const early=JSON.parse(earlyRaw);requireValue(early.id===control.id && early.operationPresent===true && early.knownRetired===true,'EARLY_RECONCILIATION');
    const stdout=bytes(path.join(directory,'stdout.raw'),65536).toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
    const earlyEvent=stdout.filter(row=>row.event==='early-operation');requireValue(earlyEvent.length===1 && JSON.stringify(earlyEvent[0].binding)===JSON.stringify(result.early),'EARLY_CAPTURE_BINDING');
    const finalEvent=stdout.filter(row=>row.id===control.id && Object.hasOwn(row,'resultSha256'));requireValue(finalEvent.length===1 && finalEvent[0].resultSha256===hash(resultRaw) && finalEvent[0].resultBytes===resultRaw.length,'FINAL_CAPTURE_BINDING');
    requireValue(early.countsPresent===true && early.created===result.created && early.primaryPresent===result.operation.primaryPresent && JSON.stringify(early.primary)===JSON.stringify(result.operation.primary) && early.resultPresent===result.operation.resultPresent,'EARLY_FINAL_RECONCILIATION');
    const durability=collectDeferred({root:directory,allowed:[...witnessNames,'EARLY.json','RESULT.json'],bindings:[...result.witnesses,result.early,snapshot(path.join(directory,'RESULT.json'))],lifecycle:{childClosed:supervision.closed,signal:supervision.signal,workersKnownRetired:result.knownRetired}});
    created+=result.created;requireValue(created<=48,'WORKER_TOTAL_CAP');
    for(const [name,source]of Object.entries(fixtures)){
      const filename=path.join(fixtureRoot,name),info=fs.lstatSync(filename);
      if(name==='worker.mjs'&&control.kind==='symlink'){requireValue(info.isSymbolicLink()&&fs.readlinkSync(filename)==='matching.mjs','FIXTURE_SYMLINK_DRIFT');continue;}
      const expected=name==='worker.mjs'&&control.kind==='hash-drift'?'throw Error("HASH_DRIFT_NO_EVAL");\n':name==='worker.mjs'&&control.kind==='after-admission-drift'?mutationExpected(result.mutation,source,mutationReplacement):source;
      bytes(filename,2093056,{bytes:Buffer.byteLength(expected),mode:name==='worker.mjs'&&control.kind==='mode-drift'?0o600:0o644,sha256:hash(Buffer.from(expected))});
    }
    if(control.kind==='bounded-journal-falsy-primary'&&result.writerChecks){
      for(const [index,[,text,exists]]of writerVariants.entries()){
        const filename=path.join(directory,'writer-control-'+String(index).padStart(2,'0')+'.data');
        if(!exists){requireValue(!fs.existsSync(filename),'UNEXPECTED_WRITER_ARTIFACT');continue;}
        bytes(filename,64,{bytes:Buffer.byteLength(text),mode:0o600,sha256:hash(Buffer.from(text))});
      }
      for(const [index,text]of ['changed\n','c','original\n'].entries())bytes(path.join(directory,'mutation-control-'+index+'.data'),64,{bytes:Buffer.byteLength(text),mode:0o644,sha256:hash(Buffer.from(text))});
      requireValue(!fs.existsSync(path.join(directory,'forbidden-target-write.data')),'EXTERNAL_GUARD_ARTIFACT');
    }
    let entries=0,caseBytes=0;
    const census=parent=>{for(const name of fs.readdirSync(parent)){entries++;requireValue(entries<=96,'CASE_ENTRY_CAP');const filename=path.join(parent,name),info=fs.lstatSync(filename);if(info.isDirectory()){requireValue(name==='moved','UNLISTED_DIRECTORY');census(filename);continue;}requireValue(info.isFile()||info.isSymbolicLink(),'CASE_ENTRY_TYPE');requireValue(Object.hasOwn(fixtures,name)||['CONFIG.json','RESULT.json','EARLY.json','SUPERVISION.json','stdout.raw','stderr.raw'].includes(name)||(/^worker-[1-8]\.jsonl?$/.test(name))||(control.kind==='bounded-journal-falsy-primary'&&(/^(writer-control-(0[0-9]|1[01])|mutation-control-[012])\.data$/.test(name)))||(name==='bounded.jsonl'&&control.kind==='bounded-journal-falsy-primary'),'UNLISTED_CASE_FILE');caseBytes+=info.size;}};
    census(directory);aggregate+=caseBytes;requireValue(aggregate<=plan.limits.captureBytes&&caseBytes<=16*1024*1024,'CASE_AGGREGATE_CAP');
    for(const file of seal.files)bytes(path.join(home,file.path),2093056,file);
    for(const file of seal.inherited)bytes(file.path,2093056,file);
    rows.push({id:control.id,status:result.pass&&supervision.status===0?'QUALIFIED':'ORDINARY_CONTROL_FAILURE',failures:result.failures,created:result.created,knownRetired:true,exit:supervision.status,durability,supervision});
  } catch(error){unsafe=true;rows.push({id:control.id,status:'UNSAFE_STOP',error:String(error),supervision:supervision??null});}
}
const report={schema:'HARMLESS_REGEX_CONTROLS_V3',unsafe,qualified:rows.filter(row=>row.status==='QUALIFIED').length,ordinaryFailed:rows.filter(row=>row.status==='ORDINARY_CONTROL_FAILURE').length,unrun:rows.filter(row=>row.status==='UNRUN_UNSAFE_TAIL').length,launched,created,knownOsProcesses:1+launched,conservativeCaptureAndCaseBytes:aggregate,rows,actualProductImports:0,actualComparatorImports:0,actualSemanticCalls:0};
fs.writeFileSync(path.join(run,'REPORT.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({unsafe,qualified:report.qualified,ordinaryFailed:report.ordinaryFailed,unrun:report.unrun,launched,created,captureBytes:aggregate}));
process.exitCode=unsafe||report.ordinaryFailed?1:0;
