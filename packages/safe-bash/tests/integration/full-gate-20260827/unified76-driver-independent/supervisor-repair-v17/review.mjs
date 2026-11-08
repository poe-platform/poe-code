import assert from 'node:assert/strict';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import * as fs from 'node:fs';
import * as paths from 'node:path';
import * as urls from 'node:url';
import * as crypto from 'node:crypto';
import * as children from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const [stage, output, writeRoot] = process.argv.slice(2);
const bindings = JSON.parse(fs.readFileSync(paths.join(stage, 'BINDINGS.json')));
const node = bindings.tools[0].path;
const observerArgs = bindings.observerArgv;
const exactEnv = {PATH:'/dev/null', LANG:'C', LC_ALL:'C', TZ:'UTC'};
const results = [];
const loaded = [];
const owned = [];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const realObserve = () => children.execFileSync('/bin/ps', observerArgs, {env:exactEnv, encoding:'utf8', timeout:2000, maxBuffer:8*1024*1024});
const rows = text => text.split('\n').filter(Boolean).map(line => {
  const parts = line.trim().split(/\s+/u);
  return {pid:Number(parts[0]), parent:Number(parts[1]), group:Number(parts[2]), born:parts.slice(3,8).join(' '), command:parts.slice(8).join(' ')};
});

function authenticate() {
  for (const tool of bindings.tools) {
    assert.equal(fs.realpathSync(tool.path), tool.realpath);
    assert.equal(fs.lstatSync(tool.path).isSymbolicLink(), false);
    assert.equal(hash(fs.readFileSync(tool.path)), tool.sha256);
  }
}

async function linked(name, globals, dependencies, expected) {
  const file = paths.join(stage, name);
  const bytes = fs.readFileSync(file);
  assert.equal(hash(bytes), expected);
  const context = vm.createContext(globals);
  const module = new vm.SourceTextModule(bytes.toString('utf8'), {
    context, identifier:urls.pathToFileURL(file).href,
    initializeImportMeta(meta) { meta.url = urls.pathToFileURL(file).href; },
    importModuleDynamically() { throw new Error('dynamic import forbidden'); }
  });
  const imports = [];
  await module.link(specifier => {
    assert.ok(Object.hasOwn(dependencies, specifier), 'unbound import ' + specifier);
    imports.push(specifier);
    const values = dependencies[specifier];
    return new vm.SyntheticModule(Object.keys(values), function() {
      for (const [key,value] of Object.entries(values)) this.setExport(key,value);
    }, {context, identifier:'independent-bound-dependency:'+specifier});
  });
  await module.evaluate({timeout:1000});
  loaded.push({file, sha256:expected, imports, wholeModule:true});
  return module.namespace;
}

const supervisorHash = bindings.files.find(row => row.path.endsWith('/supervise.mjs')).sha256;
const fenceHash = bindings.files.find(row => row.path.endsWith('/os-instruction-fence.mjs')).sha256;
const basicDeps = {'node:assert/strict':{default:assert}, 'node:path':{dirname:paths.dirname}};

async function synthetic(id) {
  const events = [], signals = [], captures = [], observerFaults = [];
  const primary = new Error('same-message'), secondary = new Error('same-message'), later = new Error('later-observer');
  const start = Date.now();
  const timers = new Set(), intervals = new Set();
  const fakeProcess = new EventEmitter();
  Object.assign(fakeProcess, {pid:8000, ppid:7999, kill(pid, signal) {signals.push({pid,signal,via:'identity'});}});
  const clock = {now:() => 1000000+(Date.now()-start)*20};
  const timer = (callback, milliseconds, ...args) => {
    const handle = setTimeout(callback, Math.max(1, milliseconds/20), ...args);timers.add(handle);return handle;
  };
  const clear = handle => {clearTimeout(handle);timers.delete(handle);};
  const interval = (callback,milliseconds) => {const handle=setInterval(callback,Math.max(1,milliseconds/20));intervals.add(handle);return handle;};
  const clearRepeat = handle => {clearInterval(handle);intervals.delete(handle);};
  const child = new EventEmitter();
  child.pid = id==='S10' ? undefined : 9001;
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  for (const input of [child.stdout, child.stderr]) {
    input.pause=()=>events.push('pause');input.resume=()=>events.push('resume');input.destroy=()=>events.push('input-destroy');
  }
  if (id==='S07') child.stdout.removeListener=()=>{events.push('remove-throws');throw secondary;};
  let active=true, observation=0, closed=false;
  const close = (status,signal) => {
    if(closed)return;closed=true;active=false;events.push('child-close');
    child.emit('exit',status,signal);child.emit('close',status,signal);
  };
  child.kill = signal => {
    events.push('kill:'+signal);signals.push({pid:child.pid,signal,via:'handle'});
    if(id!=='S08' && (id!=='S02'||signal==='SIGKILL'))queueMicrotask(()=>close(null,signal));
    return true;
  };
  function observe() {
    observation++;events.push('observe:'+observation);
    let value, fail=false;
    if(['S02','S03','S04','S05','B01'].includes(id)) {
      fail=true;
      value=observation===1 ? (id==='S03'?null:id==='S04'?undefined:primary) : observation===2?secondary:later;
    }
    if(id==='S06'&&!active){fail=true;value=primary;}
    if(fail){observerFaults.push(value);throw value;}
    return active&&child.pid ? '9001 8000 9001 Fri Aug 28 00:00:00 2026 owned-fixture\n' : '';
  }
  const createCapture = file => {
    const capture = new EventEmitter();capture.closed=false;capture.bytes=[];capture.label=paths.basename(file);
    capture.write = bytes => {events.push(capture.label+':write');if(id==='S07'&&capture.label==='stdout')throw primary;capture.bytes.push(Buffer.from(bytes));return true;};
    capture.end = callback => {
      events.push(capture.label+':end');
      if(id==='S11'&&capture.label==='stdout')throw secondary;
      queueMicrotask(()=>{capture.closed=true;capture.emit('close');callback?.();});
    };
    capture.destroy=()=>{events.push(capture.label+':destroy');capture.closed=true;queueMicrotask(()=>capture.emit('close'));};
    captures.push(capture);return capture;
  };
  const spawn = () => {
    events.push('spawn');
    if(id==='S10')timer(()=>{child.emit('error',primary);close(-2,null);},10);
    else if(['S01','S06','S07'].includes(id))timer(()=>{child.stdout.emit('data',Buffer.from('out\n'));child.stderr.emit('data',Buffer.from('err\n'));if(id!=='S07')close(0,null);},40);
    return child;
  };
  const abort = new AbortController();
  const namespace = await linked(id==='B01'?'old-supervise.mjs':'supervise.mjs', {
    process:fakeProcess, Date:clock, setTimeout:timer, clearTimeout:clear, setInterval:interval, clearInterval:clearRepeat
  }, {...basicDeps, 'node:child_process':{spawn,execFileSync:observe},
    'node:fs':{createWriteStream:createCapture,mkdirSync:()=>events.push('mkdir'),existsSync:()=>true},
    'node:timers/promises':{setTimeout:milliseconds=>new Promise(resolve=>timer(resolve,milliseconds))}
  }, id==='B01'?bindings.oldSupervisorSha256:supervisorHash);
  let receipt, thrown, didThrow=false;
  try {
    receipt=await namespace.supervise('/synthetic/owned-node',[],{
      cwd:'/synthetic',env:{},stdout:'/synthetic/stdout',stderr:'/synthetic/stderr',maxOutputBytes:1024,timeoutMs:id==='S08'?100:3000,signal:abort.signal,
      onSpawn(){if(id==='S09')timer(()=>abort.abort(primary),40);if(id==='S11')throw primary;}
    });
  }catch(error){didThrow=true;thrown=error;}
  finally{for(const handle of timers)clearTimeout(handle);for(const handle of intervals)clearInterval(handle);}
  const causes=receipt?.faultCauses??[];
  const raw={receipt,didThrow,thrownIdentity:thrown===primary?'primary':thrown===secondary?'secondary':String(thrown),events,signals,
    faultIdentities:causes.map(value=>value===primary?'primary':value===secondary?'secondary':value===later?'later':value===null?'null':value===undefined?'undefined':'other'),
    output:captures.map(capture=>({label:capture.label,closed:capture.closed,bytes:Buffer.concat(capture.bytes).toString('base64')})), clocks:'20x controlled timer/Date dependency; no OS timing proof'};
  let error;
  try {
    if(id==='B01'){assert.equal(didThrow,true);assert.equal(thrown,secondary);assert.equal(signals.length,0);assert.equal(events.some(event=>event.endsWith(':end')),false);}
    else {
      assert.equal(didThrow,false);assert.equal(receipt.teardownAttempted,true);assert.ok(events.includes('stderr:end'));
      if(id==='S01'){assert.equal(receipt.status,0);assert.equal(receipt.clean,true);assert.equal(receipt.captureClosed,true);assert.deepEqual(raw.output.map(row=>Buffer.from(row.bytes,'base64').toString()),['out\n','err\n']);}
      else {assert.equal(receipt.clean,false);assert.ok(receipt.faultCount>0);}
      if(['S02','S03','S04','S05'].includes(id)){
        assert.equal(causes[0],id==='S03'?null:id==='S04'?undefined:primary);assert.equal(causes[1],secondary);
        assert.ok(signals.some(row=>row.signal==='SIGTERM'));assert.equal(receipt.closed,true);assert.equal(receipt.captureClosed,true);
        if(id==='S02'){assert.ok(causes.includes(later));assert.ok(signals.some(row=>row.signal==='SIGKILL'));}
      }
      if(id==='S06'){assert.equal(receipt.status,0);assert.equal(receipt.observability,'UNKNOWN');assert.equal(receipt.survivorsKnown,false);}
      if(id==='S07'){assert.ok(causes.includes(primary));assert.ok(causes.includes(secondary));assert.ok(events.includes('stdout:end'));assert.equal(receipt.captureClosed,true);}
      if(id==='S08'){assert.equal(receipt.timedOut,true);assert.equal(receipt.closed,false);assert.ok(signals.some(row=>row.signal==='SIGKILL'));assert.ok(receipt.faults.some(row=>row.stage==='child-close-deadline'));}
      if(id==='S09'){assert.ok(causes.includes(primary));assert.ok(receipt.faults.some(row=>row.stage==='abort'));assert.equal(receipt.closed,true);}
      if(id==='S10'){assert.ok(causes.includes(primary));assert.equal(signals.length,0);assert.ok(receipt.spawnError);}
      if(id==='S11'){assert.equal(causes[0],primary);assert.ok(causes.includes(secondary));assert.ok(events.includes('stdout:destroy'));assert.ok(events.includes('stderr:end'));}
    }
  }catch(failure){error=failure.stack;}
  return {id,method:id==='B01'?'SYNTHETIC_OLD_SENSITIVITY':'SYNTHETIC',verdict:error?'FAIL':'PASS',error,raw};
}

function role(role, executable, args, env) {
  assert.deepEqual(env,exactEnv);
  if(role==='observer'){assert.equal(executable,'/bin/ps');assert.deepEqual(args,observerArgs);}
  else if(role==='node'){assert.equal(executable,node);assert.equal(Array.isArray(args),true);assert.ok(args.every(value=>typeof value==='string'));assert.equal(args[0],'--permission');}
  else throw new Error('unknown role');
  const tool=bindings.tools.find(row=>row.path===executable);assert.ok(tool);assert.equal(hash(fs.readFileSync(executable)),tool.sha256);
}

authenticate();
const roleCases=[];
for(const [label,operation,rejected] of [
  ['exact-observer',()=>role('observer','/bin/ps',observerArgs,exactEnv),false],
  ['unknown-role',()=>role('other','/bin/ps',observerArgs,exactEnv),true],
  ['wrong-executable',()=>role('observer','/usr/bin/otool',observerArgs,exactEnv),true],
  ['wrong-argv',()=>role('observer','/bin/ps',['-p','1'],exactEnv),true],
  ['extra-argv',()=>role('observer','/bin/ps',[...observerArgs,'extra'],exactEnv),true],
  ['ambient-env',()=>role('observer','/bin/ps',observerArgs,{...exactEnv,HOME:'/ambient'}),true]
]) {
  let rejectedActual=false;try{operation();}catch{rejectedActual=true;}
  roleCases.push({label,expectedRejected:rejected,rejected:rejectedActual,pass:rejected===rejectedActual});
}
assert.ok(roleCases.every(row=>row.pass));
results.push({id:'M01',method:'STATIC_DATA',verdict:'PASS',files:41,unchanged:39});
results.push({id:'M02',method:'DATA_ROLE',verdict:'PASS',roleCases,qualification:'Independent dispatch guard, not reexecution of shipping route admission; actual tools hash-authenticated before use.'});
results.push({id:'M03',method:'STATIC',verdict:'PASS',qualification:'OS fence/routes/permissions byte-identical to e35, effective profile unchanged. H06 source-qualified only; successful terminal persistence required; no inherited GO.'});
for(const id of ['S01','S02','S03','S04','S05','S06','S07','S08','S09','S10','S11','B01']) {
  let timer,row;
  try{row=await Promise.race([synthetic(id),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('synthetic deadline '+id)),10000);})]);}
  finally{clearTimeout(timer);}
  results.push(row);fs.writeFileSync(paths.join(output,id+'.json'),JSON.stringify(row,null,2)+'\n',{flag:'wx'});emit({kind:'case',id,verdict:row.verdict});
}

const routes=JSON.parse(fs.readFileSync(paths.join(stage,'TOOL-ROUTES.json')));
const fence=await linked('os-instruction-fence.mjs',{process}, {
  'node:assert/strict':{default:assert},'node:crypto':{createHash:crypto.createHash},
  'node:fs':Object.fromEntries(['lstatSync','mkdirSync','mkdtempSync','readFileSync','readdirSync','realpathSync'].map(name=>[name,fs[name]])),
  'node:path':Object.fromEntries(['basename','dirname','join','resolve'].map(name=>[name,paths[name]])),
  'node:url':{fileURLToPath:urls.fileURLToPath},
  './tool-routing.mjs':{toolRoutes:()=>routes,inspectLinkage:()=>{throw new Error('live linkage inspection forbidden');}}
},fenceHash);
const envelope={schema:'unified76-os-instruction-fence/1',roots:[{path:writeRoot},{path:output}]};
const profile=fence.renderInstructionFence(envelope);
fs.writeFileSync(paths.join(output,'PROFILE.txt'),profile,{flag:'wx'});

for(const id of ['A01','A02','A03']) {
  authenticate();
  let actualChild, actualClosed=false, initialIdentity, observeCount=0;
  const secondary=new Error('A02-secondary');
  const childCode=id==='A02' ? 'process.stdout.write("owned-out\\n");process.stderr.write("owned-err\\n");setTimeout(()=>process.exit(0),2000);' : 'process.stdout.write("owned-out\\n");process.stderr.write("owned-err\\n");setTimeout(()=>process.exit(0),100);';
  const childArgs=['--permission','--eval',childCode];
  role('node',node,childArgs,exactEnv);
  emit({kind:'reserve',id,intrinsicLifetimeMs:2000,outerRescueAfterMs:8000});
  const namespace=await linked('supervise.mjs', {process,setTimeout,clearTimeout,setInterval,clearInterval,Date}, {
    ...basicDeps,'node:fs':{createWriteStream:fs.createWriteStream,mkdirSync:fs.mkdirSync,existsSync:fs.existsSync},
    'node:timers/promises':{setTimeout:delay},
    'node:child_process':{
      spawn(executable,args,options) {
        assert.equal(executable,node);assert.deepEqual(args,childArgs);assert.deepEqual(options.env,exactEnv);
        assert.deepEqual(options.stdio,['ignore','pipe','pipe']);assert.equal(options.detached,true);
        actualChild=children.spawn('/usr/bin/sandbox-exec',['-p',profile,executable,...args],options);
        actualChild.once('close',()=>{actualClosed=true;});
        initialIdentity=rows(realObserve()).find(row=>row.pid===actualChild.pid);
        assert.ok(initialIdentity);assert.equal(initialIdentity.parent,process.pid);assert.equal(initialIdentity.group,actualChild.pid);
        owned.push({id,...initialIdentity});emit({kind:'registered',id,identity:initialIdentity});
        return actualChild;
      },
      execFileSync(executable,args,options) {
        role('observer',executable,args,exactEnv);observeCount++;
        if(id==='A02'){if(observeCount===1)throw null;if(observeCount===2)throw undefined;throw secondary;}
        if(id==='A03'&&actualClosed)throw secondary;
        return children.execFileSync(executable,args,{...options,env:exactEnv});
      }
    }
  },supervisorHash);
  let receipt,error;
  const stdout=paths.join(output,id+'.stdout'),stderr=paths.join(output,id+'.stderr');
  try {
    receipt=await namespace.supervise(node,childArgs,{cwd:writeRoot,env:exactEnv,stdout,stderr,timeoutMs:3000,maxOutputBytes:65536});
    assert.equal(receipt.closed,true);assert.equal(receipt.captureClosed,true);
    assert.equal(rows(realObserve()).some(row=>row.pid===initialIdentity.pid&&row.born===initialIdentity.born),false);
    if(id==='A01'){assert.equal(receipt.status,0);assert.equal(receipt.signal,null);assert.equal(receipt.clean,true);assert.equal(fs.readFileSync(stdout,'utf8'),'owned-out\n');assert.equal(fs.readFileSync(stderr,'utf8'),'owned-err\n');}
    if(id==='A02'){assert.equal(receipt.faultCauses[0],null);assert.equal(receipt.faultCauses[1],undefined);assert.ok(receipt.faultCauses.includes(secondary));assert.equal(receipt.observability,'UNKNOWN');assert.equal(receipt.clean,false);assert.ok(receipt.signals.some(row=>row.target==='owned-child-handle'&&row.delivered));}
    if(id==='A03'){assert.equal(receipt.status,0);assert.equal(receipt.signal,null);assert.equal(receipt.observability,'UNKNOWN');assert.equal(receipt.clean,false);assert.equal(receipt.signals.length,0);}
  }catch(failure){error=failure?.stack??String(failure);}
  const raw={receipt,identity:initialIdentity,observeCount,profileSha256:hash(profile),fenceModuleSha256:fenceHash,
    actualExecutable:'/usr/bin/sandbox-exec',argv:['-p','<PROFILE.txt>',node,...childArgs],env:exactEnv,
    stdout:fs.existsSync(stdout)?fs.readFileSync(stdout).toString('base64'):null,stderr:fs.existsSync(stderr)?fs.readFileSync(stderr).toString('base64'):null,
    actualClosed,qualification:'Whole supervisor linked spawn delegates through identical shipping renderInstructionFence. Not full superviseFencedWorker/phase IPC integration or fresh external-linkage/OS attestation.'};
  results.push({id,method:'ACTUAL_FENCED_OWNED_CHILD',verdict:error?'FAIL':'PASS',error,raw});
  fs.writeFileSync(paths.join(output,id+'.json'),JSON.stringify(results.at(-1),null,2)+'\n',{flag:'wx'});
  emit({kind:'case',id,verdict:error?'FAIL':'PASS'});
  if(!actualClosed)throw new Error('owned child closure breach; stop affected cohort');
}
authenticate();
const absence=owned.map(identity=>({...identity,absent:!rows(realObserve()).some(row=>row.pid===identity.pid&&row.born===identity.born)}));
assert.ok(absence.every(row=>row.absent));
const report={schema:1,source:bindings.source,results,loaded,absence,profileSha256:hash(profile),scope:'One independent focused cohort; no full gate/private/build/native oracle; no old40 rescore.'};
fs.writeFileSync(paths.join(output,'RESULTS.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
emit({kind:'complete',pass:results.filter(row=>row.verdict==='PASS').length,fail:results.filter(row=>row.verdict==='FAIL').length});
process.exitCode=results.every(row=>row.verdict==='PASS')?0:1;
