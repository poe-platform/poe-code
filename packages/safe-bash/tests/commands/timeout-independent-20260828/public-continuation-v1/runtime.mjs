import assert from 'node:assert/strict';
import { rawInputProbe, shellInputProbe, assertRawInput, assertShellInput, assertPendingReturn } from './boundaries.mjs';
import fs from 'node:fs';
import * as root from 'virtual-bash';
import * as leaf from 'virtual-bash/commands/timeout';
import { runtime as frozenCases, records, factories } from '../public-integration-freeze-v1/cases.mjs';
import { assertInventory, assertSurface } from '../public-integration-freeze-v1/predicates.mjs';
import { admitPublicPlugin, admissionRecords, diagnosticOutcome, config, receipt, clocks, shells, tracked, latches, approvedRetirementDisposals, tick, latch, watch, clock, waitFor, capture, returned, rejected, integrity, encodeReason, preserveDiagnostic, callerCase, retirementCollision } from './legacy-adapter.mjs';

assert.equal(config.executionAuthorized, true, 'NO_PRODUCT_EXECUTION_IN_PREPARATION');
const encoder = new TextEncoder();
const host = commands => ({ commands, use() { assert.fail('unexpected middleware'); }, registerFileSystem() { assert.fail('unexpected filesystem'); } });
const aggregate = options => root.createAgentCommands({ timeout: options }).find(row => row.name === 'timeout');
const makeShell = (options = {}, shellOptions = {}) => { const instance = new root.Shell({ fs: root.createMemoryFileSystem(), ...shellOptions }).use(root.agentCommands(options)); shells.push(instance); return instance; };
async function direct(definition, args, additions = {}) {
  const value = capture(args, additions); value.outcome = await watch(definition.execute(value.context)).settled;
  value.cleanup = await Promise.allSettled(value.cleanups.map(cleanup => cleanup())); return value;
}
function exact(run, record) { preserveDiagnostic('exact-raw-before-assertion',{outcome:diagnosticOutcome(run.outcome),stdoutBase64:run.stdout().toString('base64'),stderrBase64:run.stderr().toString('base64')});returned(run, record.status); assert.equal(run.stdout().toString(), record.stdout); assert.equal(run.stderr().toString(), record.stderr); }
function shellExact(result, record) { preserveDiagnostic('exact-shell-before-assertion',{exitCode:result?.exitCode,stdout:result?.stdout,stderr:result?.stderr,stdoutBase64:result?.stdoutBytes===undefined?null:Buffer.from(result.stdoutBytes).toString('base64'),stderrBase64:result?.stderrBytes===undefined?null:Buffer.from(result.stderrBytes).toString('base64')});assert.equal(result.exitCode, record.status); assert.equal(result.stdout, record.stdout); assert.equal(result.stderr, record.stderr); assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(record.stdout)); assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(record.stderr)); }
const empty = status => ({ status, stdout: '', stderr: '' });
function observeHandler(instance) {
  const definition = instance.commands.get('timeout'); const observations = [];
  instance.register({ ...definition, execute(context) { const outcome = watch(definition.execute(context)); observations.push({ context, outcome }); return outcome.settled.then(row => { if (row.status === 'rejected') throw row.reason; return row.value; }); } }, { replace: true });
  return observations;
}
async function assertLimit(instance, source, limits, limit) {
  const observation = await watch(instance.exec(source, { limits })).settled;
  preserveDiagnostic('public-shared-budget',{source,limit,status:observation.status,exitCode:observation.value?.exitCode,reasonName:observation.reason?.name,reasonLimit:observation.reason?.limit});
  assert.equal(observation.status, 'rejected', 'SHARED_BUDGET_RESET'); assert.equal(observation.reason.name, 'ShellLimitError'); assert.equal(observation.reason.limit, limit); assert.equal(observation.reason.message, `Shell limit exceeded: ${limit}`);
}

async function getterAdmissionProbes(){
  for(const kind of ['definitions','plugin']){
    const reads=[],timing=clock();
    for(const key of ['now','setTimeout','clearTimeout']){const method=timing.scheduler[key];Object.defineProperty(timing.scheduler,key,{get(){reads.push(key);return method;},configurable:true});}
    const nested={get invoke(){reads.push('invoke');return async function(){assert.equal(this,undefined);return {exitCode:7};};},get scheduler(){reads.push('scheduler');return timing.scheduler;},get maxTimerMilliseconds(){reads.push('maxTimerMilliseconds');return 7;},get replace(){assert.fail('AGGREGATE_READ_NESTED_REPLACE');}};
    const options={get timeout(){reads.push('timeout');return nested;}},registry=new root.CommandRegistry(kind==='definitions'?root.createAgentCommands(options):[]);
    if(kind==='plugin')await root.agentCommands(options).setup(host(registry));
    for(const key of ['timeout','invoke','scheduler','maxTimerMilliseconds','now','setTimeout','clearTimeout'])assert.equal(reads.filter(value=>value===key).length,1,`ONE_TIME_GETTER:${key}`);
    assert.equal(reads.length,7);exact(await direct(registry.get('timeout'),['.020','child']),empty(7));assert.equal(timing.rows[0].milliseconds,7);assert.equal(timing.live,0);preserveDiagnostic('public-one-time-getters',{kind,reads});
  }
}


const cases = {
  async R01() {
    assertInventory(root.createAgentCommands().map(row => row.name));
    const registry = new root.CommandRegistry(); await root.agentCommands().setup(host(registry)); assertInventory(registry.list().map(row => row.name));
    assertInventory((await admitPublicPlugin(makeShell())).commands.list().map(row => row.name));
  },
  async R02() { assertSurface(root, leaf); for (const provider of [root,leaf]) { assert.equal(provider.createTimeoutCommand().name,'timeout'); assert.equal(provider.createTimeoutCommands().length,1); assert.equal(provider.timeoutCommands().name,'timeout-commands'); } },
  async R03() {
    for (const conflict of ['timeout','printf','which']) for (const options of [{},{ replace:false, timeout:{ replace:true } }]) {
      const registry = new root.CommandRegistry([{ name: conflict, execute: () => ({ exitCode:23 }) }, { name:'custom', execute: () => ({ exitCode:19 }) }]);
      const before = registry.list(); assert.throws(() => root.agentCommands(options).setup(host(registry)), { message:`Command already registered: ${conflict}` }); assert.deepEqual(registry.list(),before);
    }
  },
  async R04() {
    const registry = new root.CommandRegistry(['timeout','printf','custom'].map(name => ({ name, execute: () => ({ exitCode:name === 'custom' ? 19 : 23 }) })));
    const before = registry.list(); await root.agentCommands({ replace:true, timeout:{ replace:false } }).setup(host(registry));
    assert.equal(registry.list().length,79); assertInventory(registry.list().filter(row => row.name !== 'custom').map(row => row.name)); assert.equal(registry.get('custom'),before[2]);
    assert.notEqual(registry.get('timeout'),before[0]); assert.notEqual(registry.get('printf'),before[1]);
    exact(await direct(registry.get('timeout'),['--version']),records.version); exact(await direct(registry.get('printf'),['x']),{ status:0,stdout:'x',stderr:'' });
    const second = new root.CommandRegistry([before[0],before[2]]), unchanged = second.list(); assert.throws(() => root.agentCommands({ replace:false,timeout:{ replace:true } }).setup(host(second)), { message:'Command already registered: timeout' }); assert.deepEqual(second.list(),unchanged);
  },
  async R05() {
    for (const provider of [root,leaf]) {
      provider.createTimeoutCommand({ get replace() { assert.fail('single factory reads replace'); } });
      for (const factory of [provider.createTimeoutCommands,provider.timeoutCommands]) { for (const replace of [false,true]) factory({ replace }); assert.throws(() => factory({ replace:'x' }),TypeError); }
      const original = { name:'timeout',execute:() => ({ exitCode:23 }) }, custom = { name:'custom',execute:() => ({ exitCode:19 }) };
      const registry = new root.CommandRegistry([original,custom]), before = registry.list(); assert.throws(() => provider.timeoutCommands().setup(host(registry)), { message:'Command already registered: timeout' }); assert.deepEqual(registry.list(),before);
      const timing = clock(); await provider.timeoutCommands({ replace:true,scheduler:timing.scheduler,invoke:async () => ({ exitCode:7 }) }).setup(host(registry)); assert.equal(registry.get('custom'),before[1]); exact(await direct(registry.get('timeout'),['.001','child']),empty(7));
    }
  },
  async R06() {
    for (const kind of ['definitions','plugin']) {
      const timing = clock(), gate = latch(); let signal, calls = 0, closed = false;
      const options = { timeout:{ scheduler:timing.scheduler,maxTimerMilliseconds:2,invoke:async function(command,args,streams) { assert.equal(this,undefined); assert.equal(command,'child'); assert.deepEqual(args,['a b']); calls++; signal=streams.signal; try { await gate.promise; signal.throwIfAborted(); return { exitCode:0 }; } finally { closed=true; } } } };
      const registry = new root.CommandRegistry(kind === 'definitions' ? root.createAgentCommands(options) : []); if (kind === 'plugin') await root.agentCommands(options).setup(host(registry));
      const captured = capture(['.003','child','a b']), outcome = watch(registry.get('timeout').execute(captured.context)); assert.equal(calls,1); assert.equal(timing.rows[0].milliseconds,2);
      await timing.wake(0,2); assert.equal(signal.aborted,false); await timing.wake(1,3); assert.equal(signal.aborted,true); assert.equal(outcome.snapshot().status,'pending'); gate.resolve();
      exact({ ...captured,outcome:await outcome.settled },empty(124)); assert.equal(closed,true); assert.deepEqual(timing.rows.map(row => row.milliseconds),[2,1]); assert.equal(timing.live,0); await Promise.all(captured.cleanups.map(cleanup => cleanup()));
      exact(await direct(aggregate({}),['0','child']),records.unavailable);
    }
  },
  async R07() {
    for (const vector of [{},{text:1},{timeout:2},{text:1,timeout:2},{text:2,timeout:7}]) {
      const timing = clock(), instance = makeShell({ ...(vector.text ? { text:{maxBufferBytes:vector.text} } : {}),timeout:{scheduler:timing.scheduler,...(vector.timeout ? {maxTimerMilliseconds:vector.timeout} : {})} });
      instance.register({name:'child',execute:() => ({exitCode:7})});
      shellExact(await instance.exec('sed -n p',{stdin:'long\n'}),vector.text ? records.textLimit : {status:0,stdout:'long\n',stderr:''});
      shellExact(await instance.exec('timeout .003 child'),empty(7)); assert.equal(timing.rows[0].milliseconds,Math.min(vector.timeout ?? 3,3),'CROSS_FAMILY_TIMER_LEAK'); assert.equal(timing.live,0);
    }
  },
  async R08() {
    for (const [options,ErrorType] of [[{maxTimerMilliseconds:0},RangeError],[{maxTimerMilliseconds:1.5},RangeError],[{maxTimerMilliseconds:2147483648},RangeError],[{invoke:1},TypeError],[{scheduler:null},TypeError]]) {
      assert.throws(() => root.createAgentCommands({timeout:options}),ErrorType); const registry = new root.CommandRegistry([{name:'custom',execute:() => ({exitCode:19})}]), before=registry.list(); assert.throws(() => root.agentCommands({timeout:options}).setup(host(registry)),ErrorType); assert.deepEqual(registry.list(),before);
    }
  },
  async R09() {
    for (const kind of ['own','inherited','absent','undefined','inherited-undefined','null','false','object','absent-unconfigured']) {
      const captured=capture(['0','literal-command','a b','$(not-shell)']); let calls=0,fallback=0,reads=0;
      const hook=function(command,args) { assert.equal(this,captured.context); assert.equal(command,'literal-command'); assert.deepEqual(args,['a b','$(not-shell)']); calls++; return Promise.resolve({exitCode:7}); };
      if(kind==='own') Object.defineProperty(captured.context,'invoke',{get(){reads++;return hook;}});
      else if(kind==='inherited') Object.setPrototypeOf(captured.context,{invoke:hook});
      else if(kind==='inherited-undefined') Object.setPrototypeOf(captured.context,{invoke:undefined});
      else if(!kind.startsWith('absent')) captured.context.invoke=({undefined:undefined,null:null,false:false,object:{}})[kind];
      const timing=clock(), options={scheduler:timing.scheduler,...(kind==='absent-unconfigured'?{}:{invoke:async function(command,args){assert.equal(this,undefined);assert.equal(command,'literal-command');assert.deepEqual(args,['a b','$(not-shell)']);fallback++;return {exitCode:17};}})};
      const run={...captured,outcome:await watch(aggregate(options).execute(captured.context)).settled}; preserveDiagnostic('public-context-priority',{kind,calls,fallback,reads,status:run.outcome.status,exitCode:run.outcome.value?.exitCode});exact(run,kind==='own'||kind==='inherited'?empty(7):kind==='absent'?empty(17):records.unavailable);
      assert.equal(calls,kind==='own'||kind==='inherited'?1:0);assert.equal(fallback,kind==='absent'?1:0);assert.equal(reads,kind==='own'?1:0);assert.equal(timing.records.length,0);
    }
  },
  async R10() {
    const timing=clock(),instance=makeShell({timeout:{scheduler:timing.scheduler}});
    instance.register({name:'public-child',async execute(context){for await(const bytes of context.stdin)await context.stdout.write(bytes);await context.stderr.write(Uint8Array.of(69,10));return {exitCode:7};}});
    const result=await instance.exec('timeout 0 public-child',{stdin:Uint8Array.of(0,255,65)});assert.equal(result.exitCode,7);assert.deepEqual([...result.stdoutBytes],[0,255,65]);assert.deepEqual([...result.stderrBytes],[69,10]);
    const captured=capture(['0','child','a b','$(not-shell)']);captured.context.invoke=async(command,args,options)=>{assert.equal(command,'child');assert.deepEqual(args,['a b','$(not-shell)']);for(const name of ['stdin','stdout','stderr'])assert.equal(options[name],captured.context[name]);assert.equal(Object.hasOwn(options,'signal'),false);return {exitCode:7};};
    returned({outcome:await watch(aggregate({scheduler:timing.scheduler}).execute(captured.context)).settled},7);assert.equal(captured.cleanups.length,0);assert.equal(timing.records.length,0);assert.equal(captured.context.signal.aborted,false);
  },
  async R11() {
    for(const flag of ['help','version']){const timing=clock(),instance=makeShell({timeout:{scheduler:timing.scheduler,invoke:()=>assert.fail('fallback')}});shellExact(await instance.exec(`timeout --${flag}`),records[flag]);
      const gate=latch(),entered=latch(),captured=capture([`--${flag}`]),sink=captured.context.stdout;captured.context.stdout={async write(bytes){entered.resolve();await gate.promise;await sink.write(bytes);}};
      for(const key of ['invoke','registerCleanup'])Object.defineProperty(captured.context,key,{get(){assert.fail(`control read ${key}`);}});captured.context.stdin={[Symbol.asyncIterator](){assert.fail('control stdin');}};
      const outcome=watch(aggregate({scheduler:timing.scheduler}).execute(captured.context));await waitFor(entered.promise,outcome,'help sink');assert.equal(outcome.snapshot().status,'pending');gate.resolve();exact({...captured,outcome:await outcome.settled},records[flag]);assert.equal(timing.records.length,0);
      const failure={};rejected(await direct(aggregate({}),[`--${flag}`],{stdout:{async write(){throw failure;}}}),failure);
    }
  },
  async R12() {
    const vectors=frozenCases.find(row=>row.id==='R12').vectors;
    for(const [vectorIndex,vector] of vectors.entries()){
      const timing=clock(),counts={child:0,fallback:0,rawInvoke:0},instance=makeShell({timeout:{scheduler:timing.scheduler,invoke:()=>{counts.fallback++;assert.fail('fallback');}}});
      await admitPublicPlugin(instance);
      instance.register({name:'child',execute:()=>{counts.child++;assert.fail('invalid child');}});
      const rawProbe=rawInputProbe(),originalDefinition=aggregate({scheduler:timing.scheduler});
      const definition=config.boundaryControl?.id==='B01'?{...originalDefinition,execute(context){context.stdin[Symbol.asyncIterator]();return originalDefinition.execute(context);}}:originalDefinition;
      const raw=await direct(definition,vector.argv,{stdin:rawProbe.source,invoke:()=>{counts.rawInvoke++;assert.fail('invalid invoke');}});
      preserveDiagnostic('R12-raw-before-assertion',{vectorIndex,argv:vector.argv,counts:structuredClone(rawProbe.counts),outcome:diagnosticOutcome(raw.outcome),stdoutBase64:raw.stdout().toString('base64'),stderrBase64:raw.stderr().toString('base64')});
      assertRawInput(rawProbe.counts);exact(raw,records[vector.record]);
      const gate=latch(),entered=latch(),probe=shellInputProbe({gate,entered,mutation:config.boundaryControl?.id});
      if(config.boundaryControl?.id==='B02'){const original=instance.commands.get('timeout');instance.register({...original,async execute(context){await context.stdin[Symbol.asyncIterator]().next();return original.execute(context);}},{replace:true});}
      const pending=watch(instance.exec(['timeout',...vector.argv].join(' '),{stdin:probe.source}));
      try{await waitFor(entered.promise,pending,'STDIN_RETURN_NOT_ENTERED');}catch(error){preserveDiagnostic('R12-return-admission-failure',{vectorIndex,counts:structuredClone(probe.counts),outcome:diagnosticOutcome(pending.snapshot()),error:encodeReason(error)});throw error;}await tick();
      preserveDiagnostic('R12-shell-before-release',{vectorIndex,argv:vector.argv,counts:structuredClone(probe.counts),outcome:diagnosticOutcome(pending.snapshot()),dispatchCounts:{...counts},timerEvents:timing.records.length});
      assertShellInput(probe.counts);assertPendingReturn(pending.snapshot().status);assert.deepEqual(counts,{child:0,fallback:0,rawInvoke:0});assert.equal(timing.records.length,0);
      gate.resolve();const completed=await pending.settled;
      preserveDiagnostic('R12-shell-before-assertion',{vectorIndex,argv:vector.argv,counts:structuredClone(probe.counts),outcome:diagnosticOutcome(completed),dispatchCounts:{...counts},timerEvents:timing.records.length});
      assert.equal(completed.status,'fulfilled');shellExact(completed.value,records[vector.record]);assertShellInput(probe.counts,{closed:true});assert.deepEqual(counts,{child:0,fallback:0,rawInvoke:0});assert.equal(timing.records.length,0);
      const failure={},stderrProbe=rawInputProbe(),stderrRun=await direct(aggregate({}),vector.argv,{stdin:stderrProbe.source,stderr:{async write(){throw failure;}}});
      preserveDiagnostic('R12-stderr-before-assertion',{vectorIndex,counts:structuredClone(stderrProbe.counts),outcome:diagnosticOutcome(stderrRun.outcome,failure)});assertRawInput(stderrProbe.counts);rejected(stderrRun,failure);
      preserveDiagnostic('R12-vector-complete',{vectorIndex,argv:vector.argv,rawCounts:structuredClone(rawProbe.counts),stderrRawCounts:structuredClone(stderrProbe.counts),shellCounts:structuredClone(probe.counts),dispatchCounts:{...counts},timerEvents:timing.records.length});
    }
  },
  async R13() {
    const before=process.getActiveResourcesInfo().filter(name=>name==='Timeout').length,instance=makeShell(),dispatch=[];instance.use(async(context,next)=>{dispatch.push(context.command);return next();});instance.register({name:'public-child',execute:()=>({exitCode:7})});const actualDefault=await instance.exec('timeout 60 public-child');preserveDiagnostic('public-default-clock-result',{status:actualDefault.exitCode,stdoutBase64:Buffer.from(actualDefault.stdoutBytes).toString('base64'),stderrBase64:Buffer.from(actualDefault.stderrBytes).toString('base64')});shellExact(actualDefault,empty(7));assert.deepEqual(dispatch,['timeout','public-child']);
    for(const provider of [root,leaf])exact(await direct(provider.createTimeoutCommand(),['60','child'],{invoke:async()=>({exitCode:7})}),empty(7));await tick();const after=process.getActiveResourcesInfo().filter(name=>name==='Timeout').length;preserveDiagnostic('public-default-clock',{before,after,dispatch});assert.equal(after,before);
  },
  async R14() {
    const instance=makeShell({timeout:{invoke:()=>assert.fail('fallback')}}),dispatch=[];instance.use(async(context,next)=>{dispatch.push(context.command);return next();});instance.register({name:'public-child',execute:()=>({exitCode:7})});shellExact(await instance.exec('timeout 0 public-child'),empty(7));assert.deepEqual(dispatch,['timeout','public-child']);await instance.exec('mkdir /unsupported-directory');
    for(const [command,status,message] of [['unknown-fixture-command',127,'command not found'],['/unsupported-directory',126,'Is a directory']])for(const source of [command,`timeout 0 ${command}`])shellExact(await instance.exec(source),{status,stdout:'',stderr:`shell: line 1: ${command}: ${message}\n`});
  },
  async R15() {const instance=makeShell();let count=0;instance.register({name:'public-child',execute(){count++;return {exitCode:0};}});for(const limits of [undefined,{maxCommands:2}])shellExact(await instance.exec('timeout 0 public-child',{limits}),empty(0));await assertLimit(instance,'timeout 0 public-child',{maxCommands:1},'maxCommands');assert.equal(count,2);},
  async R16() {const instance=makeShell();instance.register({name:'public-child',execute:context=>context.invoke('leaf',[])});instance.register({name:'leaf',execute:()=>({exitCode:0})});shellExact(await instance.exec('timeout 0 public-child recursive'),empty(0));await assertLimit(instance,'timeout 0 public-child recursive',{maxSubstitutionDepth:1},'maxSubstitutionDepth');},
  async R17() {const instance=makeShell();instance.register({name:'public-child',async execute(context){await context.stdout.write(encoder.encode('four'));return {exitCode:0};}});shellExact(await instance.exec('timeout 0 public-child output'),{status:0,stdout:'four',stderr:''});await assertLimit(instance,'timeout 0 public-child output',{maxOutputBytes:3},'maxOutputBytes');},
  async R18() {for(const [limit,value,source,env] of [['maxSourceBytes',128,`timeout ${'0'.repeat(129)} public-child`,{}],['maxExpansionBytes',64,'timeout $LONG public-child',{LONG:'0'.repeat(65)}],['maxExpansionFields',4,'timeout 0 public-child $FIELDS',{FIELDS:'a b c d e'}]]){let count=0;const instance=makeShell({}, {env});instance.register({name:'public-child',execute(){count++;return {exitCode:0};}});shellExact(await instance.exec(source),empty(0));await assertLimit(instance,source,{[limit]:value},limit);assert.equal(count,1);}},
  async R19() {
    const outcomes=[];for(const source of ['cat','timeout 0 cat']){const instance=makeShell(),gate=latch(),entered=latch(),chunks=[];let advanced=0,closed=false;const buffer=Buffer.from([0,255,65]);const input={async *[Symbol.asyncIterator](){try{advanced++;yield buffer;buffer.fill(66);advanced++;yield buffer.subarray(0,1);}finally{closed=true;}}};let writes=0;
      const pending=watch(instance.exec(source,{stdin:input,stdout:{async write(bytes){if(writes++===0){entered.resolve();await gate.promise;}chunks.push(Buffer.from(bytes));}}}));await waitFor(entered.promise,pending,'stream sink');assert.equal(pending.snapshot().status,'pending');const before=advanced;gate.resolve();const result=await pending.settled;returned({outcome:result},0);assert.equal(result.value.stderr,'');assert.deepEqual([...Buffer.concat(chunks)],[0,255,65,66]);assert.equal(closed,true);outcomes.push(before);
    }assert.equal(outcomes[0],outcomes[1]);
  },
  async R20() {
    const memory=root.createMemoryFileSystem();await memory.mkdir('/parent');const instance=makeShell({}, {fs:memory,cwd:'/parent',env:{MARK:'parent'}}),seen=[];instance.register({name:'public-child',execute(context){seen.push({default:context.stdinIsDefault,cwd:context.cwd,env:{...context.env},sameFS:context.fs===memory});return {exitCode:7};}});
    for(const source of ['public-child','timeout 0 public-child'])for(const explicit of [false,true])shellExact(await instance.exec(source,explicit?{stdin:new Uint8Array()}:{}),empty(7));assert.deepEqual(seen.slice(0,2),seen.slice(2));assert.equal(seen[0].default,true);assert.equal(seen[1].default,false);assert.equal(seen[0].cwd,'/parent');assert.equal(seen[0].env.MARK,'parent');assert.equal(seen[0].sameFS,true);
    for(const flag of ['absent',false,true]){const captured=capture(['0','child']);if(flag==='absent')delete captured.context.stdinIsDefault;else captured.context.stdinIsDefault=flag;captured.context.invoke=async(command,args,options)=>{assert.equal(Object.hasOwn(options,'stdinIsDefault'),flag!=='absent');if(flag!=='absent')assert.equal(options.stdinIsDefault,flag);for(const key of ['cwd','env','replaceEnv'])assert.equal(Object.hasOwn(options,key),false);return {exitCode:0};};returned({outcome:await watch(aggregate({}).execute(captured.context)).settled},0);}
  },
  async R21() {
    const timing=clock(),instance=makeShell({timeout:{scheduler:timing.scheduler}}),gate=latch(),entered=latch(),handler=observeHandler(await admitPublicPlugin(instance));let closed=false,signal;
    instance.register({name:'public-child',execute(context){signal=context.signal;context.registerCleanup(async()=>{await gate.promise;closed=true;});entered.resolve();return new Promise((done,fail)=>{if(signal.aborted)fail(signal.reason);else signal.addEventListener('abort',()=>fail(signal.reason),{once:true});});}});
    const result=watch(instance.exec('timeout .001 public-child'));await waitFor(entered.promise,result,'deadline child');await timing.wake(0,1);await tick();assert.equal(result.snapshot().status,'pending');assert.equal(handler[0].outcome.snapshot().status,'pending');assert.equal(closed,false);assert.equal(signal.aborted,true);gate.resolve();const outcome=await result.settled;returned({outcome},124);shellExact(outcome.value,empty(124));assert.equal(closed,true);assert.equal(handler[0].context.signal.aborted,false);assert.equal(timing.live,0);
  },
  async R22() {
    for(const actualShell of [false,true]){const timing=clock({handles:[0]});if(actualShell){const instance=makeShell({timeout:{scheduler:timing.scheduler}});instance.register({name:'public-child',execute:()=>({exitCode:7})});shellExact(await instance.exec('timeout .010 public-child'),empty(7));}else{const order=[],now=timing.scheduler.now,arm=timing.scheduler.setTimeout;timing.scheduler.now=function(){order.push('now');return now.call(this);};timing.scheduler.setTimeout=function(...args){order.push('arm');return arm.apply(this,args);};exact(await direct(aggregate({scheduler:timing.scheduler}),['.010','child'],{registerCleanup(){order.push('register');},invoke:async()=>({exitCode:7})}),empty(7));assert.deepEqual(order,['register','now','arm']);}assert.equal(timing.records.filter(row=>row.event==='clear').length,1);await timing.wake(0,10);assert.equal(timing.live,0);assert.equal(timing.rows.length,1);}
  },
  async R23(){await callerCase(undefined,true);},
  async R24(){await callerCase(undefined,true,false,true);},
  async R25(){await retirementCollision();},
  async R26(){const failure=new Error('foreign-timeout-fixture'),timing=clock(),gate=latch(),captured=capture(['.001','child'],{invoke:async()=>{await gate.promise;throw failure;}}),pending=watch(aggregate({scheduler:timing.scheduler}).execute(captured.context));await timing.wake(0,1);gate.resolve();rejected({outcome:await pending.settled},failure);await Promise.all(captured.cleanups.map(cleanup=>cleanup()));const instance=makeShell();instance.register({name:'child',execute(){throw failure;}});shellExact(await instance.exec('timeout 1 child'),{status:1,stdout:'',stderr:'shell: line 1: foreign-timeout-fixture\n'});},
  async R27(){const instance=makeShell(),dispatch=[];instance.use(async(context,next)=>{dispatch.push(context.command);return next();});instance.register({name:'public-child',execute:()=>({exitCode:7})});for(const limits of [undefined,{maxCommands:3}]){dispatch.length=0;shellExact(await instance.exec('timeout 0 timeout 0 public-child',{limits}),empty(7));assert.deepEqual(dispatch,['timeout','timeout','public-child']);}dispatch.length=0;await assertLimit(instance,'timeout 0 timeout 0 public-child',{maxCommands:2},'maxCommands');assert.equal(dispatch.includes('public-child'),false);},
  async R28(){const timing=clock(),instance=makeShell({timeout:{scheduler:timing.scheduler}}),gate=latch(),entered=latch(),handler=observeHandler(await admitPublicPlugin(instance));instance.register({name:'public-child',execute(context){context.registerCleanup(()=>gate.promise);entered.resolve();return {exitCode:7};}});const pending=watch(instance.exec('timeout .001 public-child'));await waitFor(entered.promise,pending,'cleanup child');await timing.wake(0,1);await tick();assert.equal(pending.snapshot().status,'pending');assert.equal(handler[0].outcome.snapshot().status,'pending');gate.resolve();shellExact((await pending.settled).value,empty(124));const rawClock=clock(),rawGate=latch(),captured=capture(['.001','child'],{invoke:async()=>{await rawGate.promise;return {exitCode:7};}}),raw=watch(aggregate({scheduler:rawClock.scheduler}).execute(captured.context));await rawClock.wake(0,1);assert.equal(raw.snapshot().status,'pending');rawGate.resolve();exact({...captured,outcome:await raw.settled},empty(7));await Promise.all(captured.cleanups.map(cleanup=>cleanup()));},
  async R29(){await callerCase(Object.freeze({overlapping:true}),false,true);},
  async R30(){await getterAdmissionProbes();for(const kind of ['definitions','plugin']){const timing=clock(),options={invoke:async function(){assert.equal(this,undefined);return {exitCode:7};},scheduler:timing.scheduler,maxTimerMilliseconds:7};const registry=new root.CommandRegistry(kind==='definitions'?root.createAgentCommands({timeout:options}):[]);if(kind==='plugin')await root.agentCommands({timeout:options}).setup(host(registry));for(const key of ['now','setTimeout','clearTimeout'])timing.scheduler[key]=()=>assert.fail('uncaptured provider');options.invoke=()=>assert.fail('uncaptured invoke');options.maxTimerMilliseconds=1;exact(await direct(registry.get('timeout'),['.020','child']),empty(7));assert.equal(timing.rows[0].milliseconds,7);assert.equal(timing.live,0);}},
};

assert.deepEqual(Object.keys(cases),frozenCases.map(row=>row.id));
assert.ok(Object.hasOwn(cases,config.caseId));assert.ok(["R01","R12","R21","R23","R24","R25","R28","R29"].includes(config.caseId),'NARROW_CONTINUATION_ONLY');
const unhandled=[];process.on('unhandledRejection',error=>unhandled.push(encodeReason(error)));
const result={schema:'timeout-public-runtime-case/1',id:config.caseId,profile:config.profile,candidate:config.candidate,startedAt:new Date().toISOString(),status:'RUNNING'};
try{integrity();await cases[config.caseId]();preserveDiagnostic('continuation-family-tail',{id:config.caseId,completed:true});await tick();result.status='PASS';}catch(error){result.status='FAIL';result.failure={...encodeReason(error),stack:error?.stack};}
fs.writeFileSync(`${config.output}/ASSERTION.json`,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
try{
  for(const gate of latches)gate.resolve();await Promise.all(tracked.map(row=>row.settled));const disposed=await Promise.allSettled(shells.map(instance=>instance.dispose()));await tick();integrity();
  result.cleanup={tracked:tracked.length,pending:tracked.filter(row=>row.snapshot().status==='pending').length,timers:clocks.reduce((sum,timing)=>sum+timing.live,0),shells:shells.length,disposalRejections:disposed.filter(row=>row.status==='rejected').map(row=>encodeReason(row.reason)),unhandled};
  assert.equal(result.cleanup.pending,0);assert.equal(result.cleanup.timers,0);assert.deepEqual(unhandled,[]);
  for(const [index,outcome] of disposed.entries())if(outcome.status==='rejected'){assert.equal(config.caseId,'R25');assert.ok(approvedRetirementDisposals.has(shells[index]),'UNQUALIFIED_DISPOSAL_REJECTION');const expected=approvedRetirementDisposals.get(shells[index]);assert.ok(Object.is(outcome.reason,expected)||(outcome.reason instanceof AggregateError&&outcome.reason.errors.length>0&&outcome.reason.errors.every(error=>Object.is(error,expected))),'WRONG_DISPOSAL_REASON');}
  result.pluginAdmissions=admissionRecords;preserveDiagnostic('plugin-admissions-final',{records:admissionRecords});result.integrity='UNCHANGED';result.activations=receipt.activations;result.observations=receipt.diagnosticObservations??[];result.clocks=clocks.map(timing=>({live:timing.live,peak:timing.peak,records:timing.records}));
}catch(error){result.status='STOP_NO_RETRY';result.cleanupFailure={...encodeReason(error),stack:error?.stack};}
result.finishedAt=new Date().toISOString();const serialized=JSON.stringify(result,null,2)+'\n';assert.ok(Buffer.byteLength(serialized)<=1024**2,'RUNTIME_RECORD_LIMIT');fs.writeFileSync(`${config.output}/RESULT.json`,serialized,{flag:'wx'});console.log(JSON.stringify(result));if(result.status!=='PASS')process.exitCode=1;
