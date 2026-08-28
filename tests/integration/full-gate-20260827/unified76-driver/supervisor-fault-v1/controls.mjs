import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as timers from 'node:timers/promises';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

const directory=path.dirname(fileURLToPath(import.meta.url)),launcher=path.resolve(directory,'../launcher-v3');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=fs.readFileSync(path.join(launcher,'supervise.mjs'),'utf8');
const baseline=fs.readFileSync(path.join(directory,'BASELINE-SUPERVISE.mjs.fixture'),'utf8');
const node='/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node';
const nodeHash='4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0';
const psHash='1e46cdb824858eb32e4c85ca920ba31b4541a814a133980d8b3484f39942276c';
const psArgs=['-axo','pid=,ppid=,pgid=,lstart=,command='];
const plain=value=>JSON.parse(JSON.stringify(value));
const output=process.argv[2];
assert.ok(output?.startsWith('/tmp/supervisor-fault-author-')&&!fs.existsSync(output),'unique explicit author output');
fs.mkdirSync(output,{mode:0o700});
const report={schema:1,startedAt:new Date().toISOString(),sourceSha256:hash(source),baselineSha256:hash(baseline),cases:[],real:[],status:'RUNNING',realProductExecutions:0};
const liveChildren=new Set();let deadlineExceeded=false;
const wholeDeadline=setTimeout(()=>{deadlineExceeded=true;report.deadlineExceeded=true;report.deadlineSignals=[];for(const child of liveChildren){try{report.deadlineSignals.push({pid:child.pid,signal:'SIGKILL',delivered:child.kill('SIGKILL')});}catch(error){report.deadlineSignals.push({pid:child.pid,error:error?.message??String(error)});}}},45000);
assert.equal(report.baselineSha256,'87837c2ff91182fc7b1b45f3d0b0ae54b7e1af66f289bd581d20a6cb5938773b');
const record=(id,fn)=>Promise.resolve().then(fn).then(details=>report.cases.push({id,status:'PASS',details}),error=>{report.cases.push({id,status:'FAIL',error:{message:error?.message??String(error),stack:error?.stack}});throw error;});
const save=()=>{const text=JSON.stringify(report,null,2)+'\n';assert.ok(Buffer.byteLength(text)<=2*1024*1024,'cohort capture bound');fs.writeFileSync(path.join(output,'REPORT.json'),text,{flag:'wx'});};

async function linked(text,dependencies,globals){
  const context=createContext({...globals,Buffer,console});
  const module=new SourceTextModule(text,{context,identifier:'authenticated:whole-shipping-supervise.mjs'});
  const permitted=new Set(['node:assert/strict','node:child_process','node:fs','node:path','node:timers/promises']);
  await module.link(specifier=>{
    assert.ok(permitted.has(specifier),'unknown module dependency');
    const exports=specifier==='node:assert/strict'?{default:assert}:specifier==='node:path'?{dirname:path.dirname}:dependencies[specifier];
    assert.ok(exports,'missing fixed dependency');
    return new SyntheticModule(Object.keys(exports),function(){for(const [name,value]of Object.entries(exports))this.setExport(name,value);},{context});
  });
  await module.evaluate();return module.namespace;
}

function synthetic(configuration={}){
  let now=0,nextTimer=0,psCalls=0,childClosed=false,rootExited=false;
  const pending=new Map(),events=[],captures=[],errors=[],globalProcess=new EventEmitter(),descendants=new Map();
  const arm=(callback,ms,interval=false)=>{const id=++nextTimer;pending.set(id,{callback,at:now+ms,ms,interval});return id;};
  const clear=id=>pending.delete(id);
  const closeChild=(status=0,signal=null)=>{if(childClosed)return;rootExited=true;child.emit('exit',status,signal);childClosed=true;child.emit('close',status,signal);events.push(['close',now,status,signal]);};
  const child=new EventEmitter();child.pid=1001;
  const input=()=>{const stream=new EventEmitter();stream.pause=()=>events.push(['pause']);stream.resume=()=>events.push(['resume']);stream.destroy=()=>events.push(['input-destroy']);return stream;};
  child.stdout=input();child.stderr=input();
  child.kill=signal=>{
    events.push(['child-kill',now,signal]);if(configuration.killError!==undefined)throw configuration.killError;
    if(!configuration.unresolved&&!(configuration.ignoreTerm&&signal==='SIGTERM'))arm(()=>closeChild(null,signal),0);
    return true;
  };
  globalProcess.pid=9000;globalProcess.ppid=8000;
  globalProcess.kill=(pid,signal)=>{events.push(['pid-kill',now,pid,signal]);assert.equal(pid,1002,'no foreign signals');descendants.delete(pid);return true;};
  const rows=()=>[
    ...(!rootExited?[{pid:1001,parent:9000,group:1001,born:'Fri Aug 28 07:00:00 2026',command:'owned-node'}]:[]),
    ...descendants.values(),{pid:2002,parent:8000,group:2002,born:'Fri Aug 28 07:00:01 2026',command:'foreign-node'},
  ].map(row=>`${row.pid} ${row.parent} ${row.group} ${row.born} ${row.command}`).join('\n')+'\n';
  const dependencies={
    'node:child_process':{
      spawn(){events.push(['spawn',now]);if(configuration.descendant)descendants.set(1002,{pid:1002,parent:1001,group:1001,born:'Fri Aug 28 07:00:02 2026',command:'owned-descendant'});
        if(configuration.reuseDescendant)arm(()=>{const row=descendants.get(1002);if(row)Object.assign(row,{born:'Fri Aug 28 07:00:03 2026',parent:8000,group:2002});},5);
        if(configuration.natural!==false)arm(()=>closeChild(),configuration.naturalAt??40);
        if(configuration.data)arm(()=>child.stdout.emit('data',Buffer.from(configuration.data)),10);
        if(configuration.captureError)arm(()=>captures[0].emit('error',configuration.captureError),10);
        if(configuration.abort)arm(configuration.abort,10);
        return child;
      },
      execFileSync(command,args){
        if(command==='/usr/sbin/lsof'){events.push(['lsof']);return '';}assert.equal(command,'/bin/ps');assert.deepEqual(plain(args),psArgs);
        psCalls++;events.push(['observe',now,psCalls]);
        if(configuration.psFault)configuration.psFault(psCalls,{closed:childClosed,rootExited});
        return rows();
      },
    },
    'node:fs':{
      mkdirSync(){events.push(['mkdir',now]);},existsSync(){return configuration.sentinel??false;},
      createWriteStream(){
        const label=captures.length?'stderr':'stdout',stream=new EventEmitter();stream.closed=false;stream.bytes=[];
        stream.write=chunk=>{events.push(['write',label,now]);if(configuration.writeError!==undefined)throw configuration.writeError;stream.bytes.push(Buffer.from(chunk));if(configuration.backpressure){arm(()=>stream.emit('drain'),1);return false;}return true;};
        stream.end=callback=>{events.push(['end',label,now,pending.size]);if(configuration.endError!==undefined&&label==='stdout')throw configuration.endError;if(!configuration.unclosedStream)arm(()=>{stream.closed=true;stream.emit('close');callback?.();},0);};
        stream.destroy=()=>{events.push(['destroy',label,now]);stream.closed=true;stream.emit('close');};
        captures.push(stream);return stream;
      },
    },
    'node:timers/promises':{setTimeout:ms=>new Promise(resolve=>arm(resolve,ms))},
  };
  const globals={process:globalProcess,Date:class extends Date{static now(){return now;}},setTimeout:(fn,ms)=>arm(fn,ms),clearTimeout:clear,setInterval:(fn,ms)=>arm(fn,ms,true),clearInterval:clear};
  async function run(text=source,options={}){
    const module=await linked(text,dependencies,globals);assert.equal(events.length,0,'module import must be inert');
    let settled=false,value,rejection,rejected=false;
    module.supervise('synthetic-node',[],{cwd:'/synthetic',stdout:'/synthetic/out',stderr:'/synthetic/err',timeoutMs:1000,...options}).then(result=>{value=result;settled=true;},error=>{rejection=error;rejected=true;settled=true;});
    for(let step=0;step<800&&!settled;step++){
      for(let flush=0;flush<12;flush++)await Promise.resolve();
      if(settled)break;
      const selected=[...pending].sort((left,right)=>left[1].at-right[1].at)[0];assert.ok(selected,'synthetic await has no owned timer');
      const[id,timer]=selected;pending.delete(id);now=timer.at;
      if(timer.interval)pending.set(id,{...timer,at:now+timer.ms});
      try{timer.callback();}catch(error){errors.push(error);}
    }
    assert.equal(settled,true,'bounded synthetic settlement');
    return{value,rejection,rejected,events,errors,childClosed,now,pending:[...pending],listeners:globalProcess.eventNames().map(name=>[name,globalProcess.listenerCount(name)]),inputListeners:[child.stdout.listenerCount('data'),child.stderr.listenerCount('data')],captures:captures.map(stream=>Buffer.concat(stream.bytes).toString())};
  }
  return{run,globalProcess,child,events};
}

async function syntheticControls(){
  await record('S01',async()=>{
    const first=new Error('first-observer'),second=new Error('finally-observer');
    const run=await synthetic({natural:false,psFault:call=>{throw call===1?first:second;}}).run(baseline);
    assert.equal(run.rejected,true);assert.equal(run.rejection,second);assert.equal(run.childClosed,false);
    assert.equal(run.events.some(row=>row[0]==='child-kill'||row[0]==='pid-kill'||row[0]==='end'),false);
    return{qualification:'original WHOLE module linked to fakes only; no actual survivor',replacedFirst:true,teardownAbsent:true};
  });
  await record('S02',async()=>{
    const run=await synthetic({natural:false,psFault:call=>{throw call===1?null:undefined;}}).run();
    assert.equal(run.rejected,false);assert.equal(run.value.faultCauses[0],null);assert.equal(run.value.faultCauses[1],undefined);
    assert.equal(run.value.closed,true);assert.equal(run.value.captureClosed,true);assert.equal(run.value.clean,false);assert.equal(run.value.observability,'UNKNOWN');
    assert.ok(run.events.some(row=>row[0]==='child-kill'));assert.equal(run.errors.length,0);
    return{receipt:plain(run.value),events:run.events};
  });
  await record('S03',async()=>{
    const run=await synthetic({natural:false,descendant:true,reuseDescendant:true,psFault:call=>{if(call>1)throw new Error('later ps failure');}}).run();
    assert.equal(run.value.clean,false);assert.ok(run.childClosed);assert.equal(run.events.some(row=>row[0]==='pid-kill'),false);
    return{receipt:plain(run.value),events:run.events};
  });
  await record('S04',async()=>{
    const run=await synthetic({data:'exact bytes\n',backpressure:true}).run();assert.equal(run.value.clean,true);assert.equal(run.value.status,0);assert.equal(run.value.signals.length,0);assert.equal(run.captures[0],'exact bytes\n');return{receipt:plain(run.value),events:run.events};
  });
  await record('S05',async()=>{
    const first=new Error('onSpawn'),second=new Error('cleanup observer');
    const run=await synthetic({natural:false,psFault:call=>{if(call>1)throw second;}}).run(source,{onSpawn(){throw first;}});
    assert.equal(run.value.faultCauses[0],first);assert.equal(run.value.faultCauses[1],second);assert.equal(run.value.closed,true);assert.equal(run.value.clean,false);return{receipt:plain(run.value),events:run.events};
  });
  await record('S06',async()=>{
    const results=[];for(const configuration of [{data:'bytes',writeError:new Error('write failed')},{captureError:new Error('capture failed')},{endError:new Error('end failed')}]){
      const run=await synthetic(configuration).run();assert.equal(run.value.closed,true);assert.equal(run.value.clean,false);assert.ok(run.events.filter(row=>row[0]==='end').length===2);results.push({receipt:plain(run.value),events:run.events});
    }return results;
  });
  await record('S07',async()=>{
    const controller=new AbortController(),reason={abort:'identity'};
    const aborted=await synthetic({natural:false,abort:()=>controller.abort(reason)}).run(source,{signal:controller.signal});
    assert.equal(aborted.value.faultCauses[0],reason);assert.ok(aborted.value.closed);assert.equal(aborted.value.clean,false);
    const timeout=await synthetic({natural:false}).run(source,{timeoutMs:150});assert.equal(timeout.value.timedOut,true);assert.ok(timeout.childClosed);
    const setup=await synthetic({natural:false}).run(source,{setupSentinel:'/synthetic/sentinel',setupTimeoutMs:50});assert.equal(setup.value.clean,false);assert.ok(setup.childClosed);
    return[aborted,timeout,setup].map(run=>({receipt:plain(run.value),events:run.events}));
  });
  await record('S08',async()=>{
    const run=await synthetic({natural:false,ignoreTerm:true,psFault:call=>{if(call>1)throw undefined;}}).run(source,{timeoutMs:100});
    assert.equal(run.errors.length,0);assert.ok(run.childClosed);assert.equal(run.value.clean,false);assert.ok(run.value.signals.some(row=>row.signal==='SIGKILL'));
    const failed=await synthetic({naturalAt:200,killError:new Error('signal rejected'),psFault:()=>{throw null;}}).run();assert.ok(failed.value.faults.some(row=>row.stage==='signal-child'));assert.ok(failed.childClosed);
    return[run,failed].map(value=>({receipt:plain(value.value),events:value.events}));
  });
  await record('S09',async()=>{
    const run=await synthetic({natural:false,unresolved:true,unclosedStream:true,psFault:()=>{throw null;}}).run();
    assert.equal(run.value.closed,false);assert.equal(run.value.clean,false);assert.equal(run.value.survivorsKnown,false);assert.ok(run.now<=5100);assert.ok(run.value.teardownAttempted);
    return{receipt:plain(run.value),events:run.events,qualification:'unresolved FAKE child only; no actual child'};
  });
  await record('S10',async()=>{
    const recovered=await synthetic({natural:false,psFault:call=>{if(call===1)throw new Error('initial failed');}}).run();assert.equal(recovered.value.clean,false);assert.equal(recovered.value.observability,'FINAL_SNAPSHOT_OBSERVED');
    const final=await synthetic({psFault:(_call,state)=>{if(state.closed)throw new Error('final failed');}}).run();assert.equal(final.value.status,0);assert.equal(final.value.clean,false);assert.equal(final.value.observability,'UNKNOWN');return[recovered,final].map(run=>({receipt:plain(run.value),events:run.events}));
  });
  await record('S11',async()=>{
    const results=[];for(const cause of [null,undefined,0,false,'',Symbol('fault'),{plain:true},new Error('exact')]){
      const run=await synthetic({psFault:()=>{throw cause;}}).run();assert.equal(run.value.faultCauses[0],cause);assert.equal(run.value.faults[0].type,cause===null?'null':typeof cause);assert.equal(run.value.clean,false);results.push(plain(run.value));
    }return results;
  });
  await record('S12',async()=>{
    const run=await synthetic({natural:false,psFault:()=>{throw null;}}).run();assert.deepEqual(run.listeners,[]);assert.deepEqual(run.inputListeners,[0,0]);assert.equal(run.pending.length,0);assert.equal(run.errors.length,0);
    assert.ok(run.events.filter(row=>row[0]==='end').every(row=>row[3]>0),'watchdogs retained through capture attempts');
    assert.equal(run.events.some(row=>row[0]==='pid-kill'&&(row[2]===9000||row[2]===8000||row[2]===2002)),false);return{events:run.events};
  });
  await record('S13',async()=>{
    const old=JSON.parse(fs.readFileSync(path.join(directory,'BASELINE-DRIVER.json'))),seal=JSON.parse(fs.readFileSync(path.join(launcher,'DRIVER.json')));
    assert.deepEqual(Object.keys(seal.files),Object.keys(old.files));
    for(const[file,expected]of Object.entries(old.files))if(file!=='supervise.mjs')assert.equal(hash(fs.readFileSync(path.join(launcher,file))),expected,file);
    for(const[file,expected]of Object.entries(seal.files))assert.equal(hash(fs.readFileSync(path.join(launcher,file))),expected,file);
    assert.equal(seal.profileSha256,old.profileSha256);assert.equal(seal.candidate,old.candidate);
    return{driverSha256:hash(JSON.stringify(seal)),unchangedMembers:Object.keys(old.files).length-1,changed:['supervise.mjs'],product:seal.candidate};
  });
}

function ps(){return childProcess.execFileSync('/bin/ps',psArgs,{encoding:'utf8',timeout:2000,maxBuffer:8*1024*1024});}
function parsePs(text){return text.split('\n').filter(Boolean).map(line=>{const parts=line.trim().split(/\s+/u);return{pid:Number(parts[0]),parent:Number(parts[1]),group:Number(parts[2]),born:parts.slice(3,8).join(' ')};});}
async function hashFile(file){const digest=createHash('sha256');for await(const chunk of fs.createReadStream(file))digest.update(chunk);return digest.digest('hex');}
async function realControls(){
  assert.equal(process.execPath,node);assert.equal(process.version,'v24.11.1');
  assert.equal(await hashFile(node),nodeHash);assert.equal(await hashFile('/bin/ps'),psHash);
  const manifest=JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(path.join(launcher,'EXTERNAL.json.gz.base64'),'utf8').trim(),'base64')));
  const validateTools=input=>{assert.ok(Array.isArray(input.tools));for(const [file,expected]of [[node,nodeHash],['/bin/ps',psHash]]){const rows=input.tools.filter(row=>row.origin===file);assert.equal(rows.length,1);assert.equal(rows[0].physical,file);assert.equal(rows[0].sha256,expected);const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,rows[0].bytes);assert.equal(stat.mode&0o777,rows[0].mode);}};
  validateTools(manifest);
  for(const tools of [manifest.tools.filter(row=>row.origin!==node),[...manifest.tools,manifest.tools.find(row=>row.origin===node)],manifest.tools.map(row=>row.origin===node?{...row,sha256:'changed'}:row),manifest.linkage])assert.throws(()=>validateTools({...manifest,tools}));
  report.toolRoleControls={positive:1,negative:4,selection:'EXTERNAL.tools exact executable identities; linkage is not an executable record'};
  for(const id of ['R01','R02','R03']){
    assert.equal(deadlineExceeded,false,'no new actual child after outer deadline');
    const root=path.join(output,id);fs.mkdirSync(root,{mode:0o700});fs.mkdirSync(path.join(root,'home'));fs.mkdirSync(path.join(root,'tmp'));
    const environment={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TZ:'UTC',HOME:path.join(root,'home'),TMPDIR:path.join(root,'tmp')};
    const program=id==='R01'?"process.stdout.write('owned-positive\\n');setTimeout(()=>{},40)":"setTimeout(()=>process.exit(0),500)";
    const trace=[],state={closed:false},beforeListeners={SIGINT:process.listenerCount('SIGINT'),SIGTERM:process.listenerCount('SIGTERM')};
    let owned,birth,rescue,closedPromise,observationCalls=0,result;
    const invokeKill=(child,original,signal,origin)=>{trace.push({operation:'signal',origin,pid:child.pid,signal,closed:state.closed});assert.equal(child,owned);if(state.closed)return false;return original(signal);};
    const dependencies={
      'node:child_process':{
        spawn(executable,args,options){
          assert.equal(executable,node);assert.deepEqual(plain(args),['-e',program]);assert.deepEqual(plain(options.env),environment);assert.equal(options.detached,true);
          owned=childProcess.spawn(executable,args,options);liveChildren.add(owned);const original=owned.kill.bind(owned);
          closedPromise=new Promise(resolve=>{owned.once('close',(status,signal)=>{state.closed=true;liveChildren.delete(owned);trace.push({operation:'close',pid:owned.pid,status,signal});resolve({status,signal});});});
          owned.once('exit',(status,signal)=>trace.push({operation:'exit',pid:owned.pid,status,signal}));
          owned.kill=signal=>invokeKill(owned,original,signal,'shipping-child-handle');
          rescue=setTimeout(()=>{if(!state.closed)invokeKill(owned,original,'SIGKILL','outer-rescue');},2000);
          birth=parsePs(ps()).find(row=>row.pid===owned.pid);assert.ok(birth,'outer binds exact owned child before returning');assert.equal(birth.parent,process.pid);assert.equal(birth.group,owned.pid);trace.push({operation:'outer-birth',identity:birth});
          return owned;
        },
        execFileSync(command,args,options){
          assert.equal(command,'/bin/ps');assert.deepEqual(plain(args),psArgs);assert.ok(options.timeout>0&&options.timeout<=2000);assert.equal(options.maxBuffer,8*1024*1024);
          observationCalls++;trace.push({operation:'shipping-observation',call:observationCalls,closed:state.closed});
          if(id==='R02')throw observationCalls===1?null:undefined;
          if(id==='R03'&&state.closed)throw new Error('post-close observation failed');
          return childProcess.execFileSync(command,args,options);
        },
      },
      'node:fs':{createWriteStream:fs.createWriteStream,mkdirSync:fs.mkdirSync,existsSync:fs.existsSync},
      'node:timers/promises':{setTimeout:timers.setTimeout},
    };
    const scopedProcess={pid:process.pid,ppid:process.ppid,once:process.once.bind(process),removeListener:process.removeListener.bind(process),kill(pid,signal){assert.equal(pid,owned?.pid,'no other process/group can be signaled');assert.equal(state.closed,false);return process.kill(pid,signal);}};
    try{
      const module=await linked(source,dependencies,{process:scopedProcess,Date,setTimeout,clearTimeout,setInterval,clearInterval});
      result=await module.supervise(node,['-e',program],{cwd:root,env:environment,stdout:path.join(root,'stdout'),stderr:path.join(root,'stderr'),timeoutMs:1500,maxOutputBytes:65536});
      assert.ok(state.closed,'actual owned close before supervisor settlement');assert.equal(result.closed,true);assert.equal(result.captureClosed,true);
      if(id==='R01'){assert.equal(result.clean,true);assert.equal(result.status,0);assert.equal(fs.readFileSync(path.join(root,'stdout'),'utf8'),'owned-positive\n');assert.equal(result.signals.length,0);}
      if(id==='R02'){assert.equal(result.clean,false);assert.equal(result.observability,'UNKNOWN');assert.equal(result.faultCauses[0],null);assert.equal(result.faultCauses[1],undefined);assert.ok(result.signals.length>0);}
      if(id==='R03'){assert.equal(result.clean,false);assert.equal(result.status,0);assert.equal(result.observability,'UNKNOWN');assert.equal(result.signals.length,0);}
      assert.equal(trace.some(row=>row.origin==='outer-rescue'),false);
      report.real.push({id,status:'PASS',identity:birth,trace,receipt:plain(result),qualification:'whole module with observer-fault dependency injection; harmless direct Node child only, not shipping OS-fence or arbitrary descendant proof'});
    }catch(error){report.real.push({id,status:'FAIL',identity:birth,trace,receipt:result?plain(result):null,error:{message:error?.message??String(error),stack:error?.stack}});throw error;}
    finally{
      if(owned&&!state.closed)owned.kill('SIGKILL');
      if(closedPromise){let deadline;try{await Promise.race([closedPromise,new Promise((_resolve,reject)=>{deadline=setTimeout(()=>reject(new Error('outer owned close deadline')),7000);})]);}finally{clearTimeout(deadline);}}
      clearTimeout(rescue);
      const observed=parsePs(ps());assert.ok(!observed.some(row=>row.pid===birth?.pid&&row.born===birth.born),'owned PID/birth must be absent');
      assert.equal(process.listenerCount('SIGINT'),beforeListeners.SIGINT);assert.equal(process.listenerCount('SIGTERM'),beforeListeners.SIGTERM);
      trace.push({operation:'outer-final-check',closed:state.closed,ownedIdentityAbsent:true});
    }
  }
  assert.equal(await hashFile(node),nodeHash);assert.equal(await hashFile('/bin/ps'),psHash);
  report.tools={node:{path:node,sha256:nodeHash},ps:{path:'/bin/ps',sha256:psHash,args:psArgs},qualification:'exact existing tools hashed before/after; no fresh full dynamic-library or OS attestation'};
}

try{
  if(process.argv[3]==='--remaining-real-v2'){
    const previous=gunzipSync(Buffer.from(fs.readFileSync(path.join(directory,'results-v1/REPORT.json.gz.base64'),'utf8').trim(),'base64'));
    assert.equal(hash(previous),'7cc5e7058a29f9c7424ec032b7a38c6ecb8ee24ecdeffac83cdd82162ebc3e99');
    const prior=JSON.parse(previous);assert.equal(prior.sourceSha256,hash(source));assert.deepEqual(prior.cases.map(row=>[row.id,row.status]),Array.from({length:13},(_value,index)=>[`S${String(index+1).padStart(2,'0')}`,'PASS']));assert.deepEqual(prior.real,[]);assert.deepEqual(prior.remainingOwnedChildren,[]);
    report.carriedSynthetic={source:'results-v1/REPORT.json.gz.base64',sha256:hash(previous),pass:13,rerun:false};
  }else{assert.equal(process.argv[3],undefined);await syntheticControls();}
  await realControls();assert.equal(deadlineExceeded,false);report.status='AUTHOR_BOUNDED_CONTROLS_PASS';
}
catch(error){report.status='AUTHOR_CONTROL_FAILURE';report.error={message:error?.message??String(error),stack:error?.stack};process.exitCode=1;}
finally{clearTimeout(wholeDeadline);report.remainingOwnedChildren=[...liveChildren].map(child=>child.pid);report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({output,status:report.status,synthetic:report.cases.map(({id,status})=>({id,status})),real:report.real.map(({id,status})=>({id,status}))}));}
