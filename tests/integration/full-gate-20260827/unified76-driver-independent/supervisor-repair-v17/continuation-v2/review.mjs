import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as fs from 'node:fs';
import * as paths from 'node:path';
import * as urls from 'node:url';
import * as crypto from 'node:crypto';
import * as children from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {exactOwnData, ownValue, validateRole, collectorAccepted} from './compare.mjs';

const [stage, output, writeRoot] = process.argv.slice(2);
const bindings = JSON.parse(fs.readFileSync(paths.join(stage,'BINDINGS.json')));
const childPrograms = JSON.parse(fs.readFileSync(paths.join(stage,'CHILDREN.json')));
const node = bindings.tools[0].path;
const environment = {PATH:'/dev/null',LANG:'C',LC_ALL:'C',TZ:'UTC'};
const observerArgs = bindings.observerArgv;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const records = [], companions = [], loads = [], identities = [];
const counters = {companion:{},sourceSpawn:{},sourceObserver:{},ownershipObserver:{},absenceObserver:{}};
let accessorCalls=0, fatal, profile;

function journal(row) {
  fs.appendFileSync(paths.join(output,'roles.jsonl'),JSON.stringify(row)+'\n');
}
function counted(context, verdict, detail) {
  counters[context][verdict]=(counters[context][verdict]??0)+1;
  journal({context,verdict,...detail,counters:structuredClone(counters)});
}
function save(name,value) {
  fs.writeFileSync(paths.join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}
function emit(row) { process.stdout.write(JSON.stringify(row)+'\n'); }
function authenticate() {
  for(const tool of bindings.tools) {
    assert.equal(fs.realpathSync(tool.path),tool.realpath);
    assert.equal(fs.lstatSync(tool.path).isSymbolicLink(),false);
    assert.equal(hash(fs.readFileSync(tool.path)),tool.sha256);
  }
}
function parseRows(text) {
  return text.split('\n').filter(Boolean).map(line=>{
    const fields=line.trim().split(/\s+/u);
    return {pid:Number(fields[0]),parent:Number(fields[1]),group:Number(fields[2]),born:fields.slice(3,8).join(' '),command:fields.slice(8).join(' ')};
  });
}
function observeOwned(context,id) {
  authenticate();
  const options={encoding:'utf8',timeout:2000,maxBuffer:8*1024*1024};
  validateRole('observer','/bin/ps',observerArgs,options,{observerArgs});
  counted(context,'admitted',{id,executable:'/bin/ps',args:observerArgs,options,env:environment});
  return parseRows(children.execFileSync('/bin/ps',observerArgs,{...options,env:environment}));
}

async function link(name, globals, dependencies) {
  const file=paths.join(stage,name),bytes=fs.readFileSync(file);
  const expected=bindings.files.find(row=>row.path.endsWith('/'+name)).sha256;
  assert.equal(hash(bytes),expected);
  const context=vm.createContext(globals);
  const module=new vm.SourceTextModule(bytes.toString('utf8'),{
    context,identifier:urls.pathToFileURL(file).href,
    initializeImportMeta(meta){meta.url=urls.pathToFileURL(file).href;},
    importModuleDynamically(){throw new Error('unbound dynamic import');}
  });
  const imports=[];
  await module.link(specifier=>{
    assert.ok(Object.hasOwn(dependencies,specifier),'unbound import '+specifier);
    imports.push(specifier);
    const values=dependencies[specifier];
    return new vm.SyntheticModule(Object.keys(values),function(){
      for(const [key,value] of Object.entries(values))this.setExport(key,value);
    },{context,identifier:'independent-bound:'+specifier});
  });
  const receipt={file,sha256:expected,wholeModule:true,imports};
  loads.push(receipt);fs.appendFileSync(paths.join(output,'loads.jsonl'),JSON.stringify(receipt)+'\n');
  await module.evaluate({timeout:1000});
  return module.namespace;
}

function runCompanions() {
  const foreign=code=>vm.runInNewContext(code,{touch(){accessorCalls++;}},{timeout:1000});
  const argv=['--permission','--eval','process.exit(0)'];
  const policy={node,cwd:'/owned',env:environment,childArgs:argv,observerArgs};
  const options={cwd:'/owned',env:environment,detached:true,stdio:['ignore','pipe','pipe']};
  const observation={encoding:'utf8',timeout:2000,maxBuffer:8*1024*1024};
  const cross=value=>foreign('('+JSON.stringify(value)+')');
  const cases=[
    ['C01','cross-realm-stdio',false,()=>exactOwnData(cross(options.stdio),options.stdio)],
    ['C02','cross-realm-argv',false,()=>exactOwnData(cross(argv),argv)],
    ['C03','cross-realm-env',false,()=>exactOwnData(cross(environment),environment)],
    ['C04','cross-realm-spawn-options',false,()=>validateRole('spawn',node,cross(argv),cross(options),policy)],
    ['C05','cross-realm-observer-options',false,()=>validateRole('observer','/bin/ps',cross(observerArgs),cross(observation),policy)],
    ['C06','wrong-observer-arg',true,()=>validateRole('observer','/bin/ps',['-p','1'],observation,policy)],
    ['C07','wrong-element-type',true,()=>exactOwnData(['ignore','pipe',1],options.stdio)],
    ['C08','extra-element',true,()=>exactOwnData([...argv,'extra'],argv)],
    ['C09','missing-element',true,()=>exactOwnData(argv.slice(0,-1),argv)],
    ['C10','hole',true,()=>exactOwnData(foreign('["ignore",,"pipe"]'),options.stdio)],
    ['C11','array-accessor-no-getter',true,()=>exactOwnData(foreign('Object.defineProperty(["ignore","pipe","pipe"],"1",{get(){touch();return "pipe";}})'),options.stdio)],
    ['C12','nonarray-arraylike',true,()=>exactOwnData({'0':'ignore','1':'pipe','2':'pipe',length:3},options.stdio)],
    ['C13','extra-symbol-own-key',true,()=>exactOwnData(foreign('Object.assign(["ignore","pipe","pipe"],{[Symbol("extra")]:1})'),options.stdio)],
    ['C14','extra-env-key',true,()=>exactOwnData({...environment,HOME:'/ambient'},environment)],
    ['C15','missing-env-key',true,()=>exactOwnData({PATH:'/dev/null',LANG:'C',LC_ALL:'C'},environment)],
    ['C16','env-accessor-no-getter',true,()=>exactOwnData(foreign('({get PATH(){touch();return "/dev/null";},LANG:"C",LC_ALL:"C",TZ:"UTC"})'),environment)],
    ['C17','wrong-spawn-path',true,()=>validateRole('spawn','/usr/bin/node',argv,options,policy)],
    ['C18','wrong-observer-role',true,()=>validateRole('observer-other','/bin/ps',observerArgs,observation,policy)],
    ['C19','observer-options-accessor',true,()=>validateRole('observer','/bin/ps',observerArgs,foreign('({encoding:"utf8",timeout:2000,get maxBuffer(){touch();return 8388608;}})'),policy)],
    ['C20','distinct-unpaired-surrogates',true,()=>exactOwnData(['\ud800'],['\ud801'])],
    ['C21','extra-spawn-option',true,()=>validateRole('spawn',node,argv,{...options,shell:true},policy)],
    ['C22','observer-timeout-outside-bound',true,()=>validateRole('observer','/bin/ps',observerArgs,{...observation,timeout:0},policy)]
  ];
  for(const [id,label,expectedRejected,operation] of cases) {
    let rejected=false,error;
    try{operation();}catch(failure){rejected=true;error=failure.message;}
    const row={id,label,method:'OWN_DATA_COMPARATOR',expectedRejected,rejected,error,accessorCalls,verdict:rejected===expectedRejected&&accessorCalls===0?'PASS':'FAIL'};
    companions.push(row);counted('companion',row.verdict,row);save(id+'.json',row);
  }
  const good={exit:0,signal:null,closed:true,streamsClosed:true,timedOut:false,overflow:false,reporter:'ALL_PASS'};
  for(const [id,changes,expected] of [
    ['K01',{},true],['K02',{exit:1},false],['K03',{signal:'SIGTERM'},false],
    ['K04',{streamsClosed:false},false],['K05',{timedOut:true},false],['K06',{overflow:true},false]
  ]) {
    const receipt={...good,...changes};
    const accepted=collectorAccepted(receipt);
    const row={id,method:'SYNTHETIC_COLLECTOR_RECEIPT',receipt,expectedAccepted:expected,accepted,verdict:accepted===expected?'PASS':'FAIL'};
    companions.push(row);counted('companion',row.verdict,row);save(id+'.json',row);
  }
  assert.equal(accessorCalls,0);
  assert.ok(companions.every(row=>row.verdict==='PASS'),'companion failure; actual children not admitted');
  emit({kind:'companions',comparators:22,collectorReceipts:6,pass:companions.length});
}

async function actualCase(id) {
  let child,closed=false,identity,observationCount=0,infrastructureFailure=false;
  const secondary=new Error(id+' secondary observation');
  const childArgs=['--permission','--eval',childPrograms[id].code];
  assert.equal(hash(childPrograms[id].code),childPrograms[id].sha256);
  const policy={node,cwd:writeRoot,env:environment,childArgs,observerArgs};
  authenticate();
  journal({context:'reserved',id,intrinsicLifetimeMs:childPrograms[id].lifetimeMs,outerRescueAfterMs:8000});
  const namespace=await link('supervise.mjs',{process,Date,setTimeout,clearTimeout,setInterval,clearInterval},{
    'node:assert/strict':{default:assert},'node:path':{dirname:paths.dirname},
    'node:fs':{createWriteStream:fs.createWriteStream,mkdirSync:fs.mkdirSync,existsSync:fs.existsSync},
    'node:timers/promises':{setTimeout:delay},
    'node:child_process':{
      spawn(executable,args,options) {
        try{validateRole('spawn',executable,args,options,policy);authenticate();}
        catch(error){infrastructureFailure=true;counted('sourceSpawn','rejected',{id,error:error.message});throw error;}
        counted('sourceSpawn','admitted',{id,executable:node,args:childArgs,options:{cwd:writeRoot,env:environment,detached:true,stdio:['ignore','pipe','pipe']}});
        child=children.spawn('/usr/bin/sandbox-exec',['-p',profile,node,...childArgs],{cwd:writeRoot,env:environment,detached:true,stdio:['ignore','pipe','pipe']});
        child.once('close',(status,signal)=>{closed=true;journal({context:'actual-close',id,pid:child.pid,status,signal});});
        identity=observeOwned('ownershipObserver',id).find(row=>row.pid===child.pid);
        if(!identity||identity.parent!==process.pid||identity.group!==child.pid){infrastructureFailure=true;throw new Error('owned birth registration failed');}
        const registration={id,identity,registeredBeforeFaultInjection:true,coordinatorPid:process.pid};
        save(id+'.identity.pending',registration);fs.renameSync(paths.join(output,id+'.identity.pending'),paths.join(output,id+'.identity.json'));identities.push(registration);
        counted('sourceSpawn','dispatched',{id,identity,executable:'/usr/bin/sandbox-exec',args:['-p','<PROFILE.txt>',node,...childArgs],env:environment});
        emit({kind:'registered',...registration});
        return child;
      },
      execFileSync(executable,args,options) {
        let timeout;
        try{timeout=validateRole('observer',executable,args,options,policy);authenticate();}
        catch(error){infrastructureFailure=true;counted('sourceObserver','rejected',{id,error:error.message});throw error;}
        observationCount++;
        counted('sourceObserver','admitted',{id,call:observationCount,executable:'/bin/ps',args:observerArgs,options:{encoding:'utf8',timeout,maxBuffer:8*1024*1024},env:environment});
        if(id==='A02') {
          const reason=observationCount===1?null:observationCount===2?undefined:secondary;
          journal({context:'injected-observer-fault',id,call:observationCount,type:reason===null?'null':typeof reason,identity:reason===secondary?'secondary':reason===null?'null':'undefined'});
          throw reason;
        }
        if(id==='A03'&&closed){journal({context:'injected-observer-fault',id,call:observationCount,type:'object',identity:'secondary'});throw secondary;}
        counted('sourceObserver','dispatched',{id,call:observationCount,executable:'/bin/ps',args:observerArgs});
        return children.execFileSync('/bin/ps',observerArgs,{encoding:'utf8',timeout,maxBuffer:8*1024*1024,env:environment});
      }
    }
  });
  const stdout=paths.join(output,id+'.stdout'),stderr=paths.join(output,id+'.stderr');
  let receipt,error,absent=false;
  try {
    receipt=await namespace.supervise(node,childArgs,{cwd:writeRoot,env:environment,stdout,stderr,timeoutMs:3000,maxOutputBytes:65536});
    assert.equal(infrastructureFailure,false);
    assert.equal(receipt.closed,true);assert.equal(receipt.captureClosed,true);
    absent=!observeOwned('absenceObserver',id).some(row=>row.pid===identity.pid&&row.born===identity.born);
    assert.equal(absent,true);
    if(id==='A01') {
      assert.equal(receipt.status,0);assert.equal(receipt.signal,null);assert.equal(receipt.clean,true);
      assert.equal(fs.readFileSync(stdout,'utf8'),'owned-out\n');assert.equal(fs.readFileSync(stderr,'utf8'),'owned-err\n');
    }
    if(id==='A02') {
      assert.equal(receipt.faultCauses[0],null);assert.equal(receipt.faultCauses[1],undefined);assert.ok(receipt.faultCauses.includes(secondary));
      assert.equal(receipt.clean,false);assert.equal(receipt.observability,'UNKNOWN');
      assert.equal(receipt.status,null);assert.equal(receipt.signal,'SIGTERM');
      assert.ok(receipt.signals.some(row=>row.target==='owned-child-handle'&&row.signal==='SIGTERM'&&row.delivered===true));
    }
    if(id==='A03') {
      assert.equal(receipt.status,0);assert.equal(receipt.signal,null);assert.equal(receipt.clean,false);
      assert.equal(receipt.observability,'UNKNOWN');assert.equal(receipt.survivorsKnown,false);assert.equal(receipt.signals.length,0);
      assert.ok(receipt.faultCauses.includes(secondary));
      assert.equal(fs.readFileSync(stdout,'utf8'),'owned-out\n');assert.equal(fs.readFileSync(stderr,'utf8'),'owned-err\n');
    }
  }catch(failure){error=failure?.stack??String(failure);}
  const row={id,verdict:error?'FAIL':'PASS',method:'ACTUAL_OWNED_FENCED_CHILD',receipt,error,identity,closed,absent,infrastructureFailure,observationCount,
    faultIdentities:receipt?.faultCauses.map(reason=>reason===null?'null':reason===undefined?'undefined':reason===secondary?'secondary':'other'),
    stdout:fs.existsSync(stdout)?fs.readFileSync(stdout).toString('base64'):null,stderr:fs.existsSync(stderr)?fs.readFileSync(stderr).toString('base64'):null,
    profileSha256:hash(profile),counters:structuredClone(counters)};
  records.push(row);save(id+'.json',row);emit({kind:'case',id,verdict:row.verdict});
  if(infrastructureFailure||!closed||!absent)throw new Error('actual admission/closure integrity failure; stop remaining cases');
}

try {
  authenticate();runCompanions();
  const routes=JSON.parse(fs.readFileSync(paths.join(stage,'TOOL-ROUTES.json')));
  const fence=await link('os-instruction-fence.mjs',{process},{
    'node:assert/strict':{default:assert},'node:crypto':{createHash:crypto.createHash},
    'node:fs':Object.fromEntries(['lstatSync','mkdirSync','mkdtempSync','readFileSync','readdirSync','realpathSync'].map(name=>[name,fs[name]])),
    'node:path':Object.fromEntries(['basename','dirname','join','resolve'].map(name=>[name,paths[name]])),
    'node:url':{fileURLToPath:urls.fileURLToPath},
    './tool-routing.mjs':{toolRoutes:()=>routes,inspectLinkage:()=>{throw new Error('live linkage probing forbidden');}}
  });
  profile=fence.renderInstructionFence({schema:'unified76-os-instruction-fence/1',roots:[{path:writeRoot},{path:output}]});
  fs.writeFileSync(paths.join(output,'PROFILE.txt'),profile,{flag:'wx'});
  for(const id of ['A01','A02','A03'])await actualCase(id);
  authenticate();
}catch(error){fatal=error?.stack??String(error);journal({context:'fatal',error:fatal});process.stderr.write(fatal+'\n');}
finally {
  for(const id of ['A01','A02','A03'])if(!records.some(row=>row.id===id))records.push({id,verdict:'UNEXECUTED',reason:'earlier integrity/admission failure'});
  const report={schema:2,source:bindings.source,companions,records,counters,loads,identities,fatal,profileSha256:profile?hash(profile):null,accessorCalls,
    qualification:'New continuation only. Entire supervisor module unchanged; spawn delegates through shipping-rendered OS profile. Not full phase IPC/private/fullgate proof.'};
  save('RESULTS.json',report);
  process.exitCode=!fatal&&companions.every(row=>row.verdict==='PASS')&&records.every(row=>row.verdict==='PASS')?0:1;
  emit({kind:'complete',exit:process.exitCode,actualPass:records.filter(row=>row.verdict==='PASS').length,actualFail:records.filter(row=>row.verdict==='FAIL').length});
}
