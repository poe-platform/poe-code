import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export const focusedIdentities = Object.freeze(Array.from({length:34},(_,index)=>'F'+String(index+1).padStart(2,'0')));
export async function runFocused(moduleRoot, publish) {
  const load = relative => import(pathToFileURL(moduleRoot + '/' + relative).href);
  const {createNodeCommand, NODE_PROFILE, NodeProfileError, NodeUsageError} = await load('commands/node/index.js');
  const {NodeOwner} = await load('commands/node/lifecycle.js');
  const {fsDescriptor} = await load('commands/node/host.js');
  const {publishNodeObservation, observeNodeFailure} = await load('commands/node/diagnostics.js');
  const {FsError} = await load('contracts/errors.js');
  const {MemoryFileSystem} = await load('fs/memory/index.js');
  const emptyObservation = () => ({state:'unknown',fault:false,name:null,message:null,code:null});
  const profile = () => ({kind:'profileFailure',observation:emptyObservation()});
  const noAcquisition = () => ({acquisition:'none',exitCode:null});
  const request = () => ({sequence:1,op:'readText',authority:'data',path:'/missing',flag:'r',text:null,moduleKey:null});
  const stdoutRequest = () => ({sequence:1,op:'writeOutput',authority:'stdout',path:null,flag:null,text:'visible',moduleKey:null});
  function deferred() { let resolve; let reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; }
  function fixture(options={}) {
    const counts={pulls:0,starts:0,prepares:0,cancels:0,retires:0,fs:0,cleanup:0};
    const controller = new AbortController();
    const chunks={stdout:[],stderr:[]}; const registered=[];
    const sink=channel=>({write:async value=>{assert(value instanceof Uint8Array);assert(chunks[channel].reduce((sum,item)=>sum+item.length,0)+value.length<=32768);chunks[channel].push(Uint8Array.from(value));}});
    const fs = new MemoryFileSystem();
    const context={command:'node',args:['-e',''],stdin:{async *[Symbol.asyncIterator](){counts.pulls+=1;}},stdout:sink('stdout'),stderr:sink('stderr'),cwd:'/',env:{},fs,signal:controller.signal,registerCleanup:cleanup=>{registered.push(cleanup);},...options};
    return {counts,controller,context,registered,output:channel=>Buffer.concat(chunks[channel]).toString('utf8')};
  }
  function provider(fix, callbacks={}) {
    return {profile:NODE_PROFILE,identity:'author-focused-inert-provider-v1',prepare:(source,services)=>{fix.counts.prepares+=1;assert(fix.registered.length===1);if(callbacks.prepare)callbacks.prepare(source,services);return {start:async()=>{fix.counts.starts+=1;return callbacks.start?callbacks.start(services):profile();},cancel:reason=>{fix.counts.cancels+=1;callbacks.cancel?.(reason);},retire:async()=>{fix.counts.retires+=1;const result=callbacks.retire?await callbacks.retire():noAcquisition();fix.counts.cleanup+=1;return result;}};}};
  }
  async function execute(fix,callbacks={},grants={}) {
    let outcome;
    try { outcome={kind:'return',value:await createNodeCommand({provider:provider(fix,callbacks),grants}).execute(fix.context)}; }
    catch(reason) { outcome={kind:'throw',value:reason}; }
    await Promise.allSettled(fix.registered.map(cleanup=>cleanup()));
    return outcome;
  }
  function raw(outcome,reason){assert.equal(outcome.kind,'throw');assert.equal(outcome.value,reason);}
  function status(outcome,expected){assert.equal(outcome.kind,'return');assert.equal(outcome.value.exitCode,expected);}
  const observations = new Map();
  const cases = [
    ['F01',async()=>{
      const fix=fixture();const entered=deferred();let pending;let aborted=false;let parentClosed=false;let rescue=0;const reason=new Error('provider-start-failed');
      fix.context.fs.readFile=async(path,options)=>{fix.counts.fs+=1;entered.resolve();return new Promise((resolve,reject)=>{const abort=()=>{aborted=true;parentClosed=true;reject(options.signal.reason);};options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort();pending={resolve:()=>{rescue+=1;parentClosed=true;options.signal.removeEventListener('abort',abort);resolve(new Uint8Array());}};});};
      const watchdog=setTimeout(()=>pending?.resolve(),1000);
      let task;
      const outcome=await execute(fix,{start:async services=>{task=services.request(request());void task.catch(()=>{});await entered.promise;throw reason;},retire:async()=>{await task.catch(()=>{});assert(parentClosed);return noAcquisition();}},{dataRead:true});
      clearTimeout(watchdog);observations.set("F01",{rescue,aborted,parentClosed,retirements:fix.counts.retires});raw(outcome,reason);assert(aborted);assert.equal(rescue,0);assert.equal(fix.counts.retires,1);assert.equal(fix.counts.cleanup,1);assert.equal(fix.controller.signal.aborted,false);
    }],
    ['F02',async()=>{const fix=fixture();const reason=new Error('execution');const outcome=await execute(fix,{start:async()=>{fix.controller.abort(false);throw reason;},retire:async()=>{throw undefined;}});raw(outcome,false);assert.equal(fix.counts.retires,1);}],
    ['F03',async()=>{const fix=fixture();let aborted=false;fix.context.fs.readFile=async(path,options)=>{await Promise.resolve();aborted=options.signal.aborted;return new TextEncoder().encode('x');};const outcome=await execute(fix,{start:async services=>{const pending=services.request(request());await Promise.resolve();services.cutoff();const response=await pending;assert.equal(response.text,'x');services.delivered(1);return profile();}},{dataRead:true});status(outcome,2);assert.equal(aborted,false);assert.equal(fix.counts.retires,1);}],
    ['F04',async()=>{const fix=fixture();const reason={name:'FsError',message:'not genuine',code:'ENOENT',errno:-2,path:'/missing'};fix.context.fs.readFile=async()=>{throw reason;};const outcome=await execute(fix,{start:async services=>{try{await services.request(request());}catch{}return profile();}},{dataRead:true});raw(outcome,reason);assert.equal(fsDescriptor(reason),undefined);}],
    ['F05',async()=>{const error=new FsError('ENOENT',{message:'missing',path:'/missing'});let gets=0;Object.defineProperty(error,'cause',{get(){gets+=1;throw new Error('cause getter');},configurable:true});Object.defineProperty(error,'stack',{get(){gets+=1;throw new Error('stack getter');},configurable:true});const dto=fsDescriptor(error);assert(dto);assert.equal(dto.code,'ENOENT');assert.equal(dto.path,'/missing');assert.equal(gets,0);assert.equal(Object.hasOwn(dto,'cause'),false);assert.equal(Object.hasOwn(dto,'stack'),false);const fix=fixture();fix.context.fs.readFile=async()=>{throw error;};const outcome=await execute(fix,{start:async services=>{const response=await services.request(request());assert.equal(response.kind,'fsError');services.delivered(1);return profile();}},{dataRead:true});status(outcome,2);assert.equal(gets,0);}],
    ['F06',async()=>{const fix=fixture();const error=new FsError('ENOENT',{message:'missing'});Object.defineProperty(error,'unrelated',{value:1});assert.equal(fsDescriptor(error),undefined);fix.context.fs.readFile=async()=>{throw error;};raw(await execute(fix,{start:async services=>{try{await services.request(request());}catch{}return profile();}},{dataRead:true}),error);}],
    ['F07',async()=>{const error=new FsError('ENOENT',{message:'missing'});for(const field of ['path','syscall','dest'])Object.defineProperty(error,field,{value:undefined,configurable:true});const dto=fsDescriptor(error);assert(dto);assert.deepEqual([dto.path,dto.syscall,dto.dest],[null,null,null]);}],
    ['F08',async()=>{const error=new FsError('ENOENT',{message:'missing'});let gets=0;Object.defineProperty(error,'path',{get(){gets+=1;throw undefined;},configurable:true});assert.equal(fsDescriptor(error),undefined);assert.equal(gets,0);}],
    ['F09',async()=>{const error=new FsError('ENOENT',{message:'missing'});Object.defineProperty(error,Symbol('extra'),{value:1});assert.equal(fsDescriptor(error),undefined);}],
    ['F10',async()=>{const error=new FsError('EIO',{message:'sink'});const fix=fixture({stdout:{write:async()=>{throw error;}}});raw(await execute(fix,{start:async services=>{try{await services.request(stdoutRequest());}catch{}return profile();}},{stdoutWrite:true}),error);}],
    ['F11',async()=>{const fix=fixture({args:['--version']});status(await execute(fix,{}, {stderrWrite:true}),2);assert.match(fix.output('stderr'),/^node: .+\n$/u);assert.equal(fix.counts.prepares,0);assert.equal(fix.counts.pulls,0);assert.equal(fix.counts.fs,0);}],
    ['F12',async()=>{const fix=fixture({args:['--version']});status(await execute(fix),2);assert.equal(fix.output('stderr'),'');assert.equal(fix.counts.prepares,0);assert.equal(fix.counts.pulls,0);}],
    ['F13',async()=>{const reason=new NodeProfileError('external diagnostic sink');const fix=fixture({args:['--version'],stderr:{write:async()=>{throw reason;}}});raw(await execute(fix,{}, {stderrWrite:true}),reason);assert.equal(fix.counts.prepares,0);assert.equal(fix.counts.pulls,0);}],
    ['F14',async()=>{const fix=fixture();const reason=new NodeProfileError('external start');raw(await execute(fix,{start:async()=>{throw reason;}}),reason);assert.equal(fix.counts.retires,1);}],
    ['F15',async()=>{const fix=fixture();status(await execute(fix),2);assert.equal(fix.counts.retires,1);}],
    ['F16',async()=>{const fix=fixture();let selected;status(await execute(fix,{start:async services=>{try{services.reserve('internal-cap',16777217);}catch(reason){selected=reason;}return profile();}}),2);assert(selected instanceof NodeProfileError);assert.equal(fix.counts.retires,1);}],
    ['F17',async()=>{const fix=fixture();let selected;const outcome=await execute(fix,{start:async services=>{try{services.reserve('internal-cap',16777217);}catch(reason){selected=reason;throw reason;}return profile();}});raw(outcome,selected);assert(selected instanceof NodeProfileError);}],
    ['F18',async()=>{const fix=fixture();raw(await execute(fix,{start:async()=>{throw undefined;}}),undefined);}],
    ['F19',async()=>{const fix=fixture();raw(await execute(fix,{start:async services=>{services.fail({present:true,value:undefined});return profile();}}),undefined);}],
    ['F20',async()=>{const fix=fixture();const owner=new NodeOwner(fix.context);owner.open();const release=deferred();const entered=deferred();let cleaned=false;let receipt=false;const publication=owner.job(()=>publishNodeObservation(new Error('primary'),async()=>{entered.resolve();try{await release.promise;}finally{cleaned=true;}}));void publication.then(()=>{receipt=true;});await entered.promise;const closing=owner.close();await Promise.resolve();assert.equal(receipt,false);assert.equal(cleaned,false);release.resolve();const result=await publication;await closing;assert(cleaned);assert.equal(result.publisherFault,undefined);}],
    ['F21',async()=>{const primary=new Error('primary');let cleaned=false;const result=await publishNodeObservation(primary,async()=>{try{throw undefined;}finally{await Promise.resolve();cleaned=true;}});assert(cleaned);assert(result.publisherFault);assert.equal(result.publisherFault.present,true);assert.equal(result.publisherFault.value,undefined);assert.equal(result.observation.fault,true);assert.equal(primary.message,'primary');}],
    ['F22',async()=>{const result=await publishNodeObservation(false,()=>{throw false;});assert(result.publisherFault);assert.equal(result.publisherFault.value,false);}],
    ['F23',async()=>{let calls=0;const object={};Object.defineProperty(object,'message',{get(){calls+=1;throw undefined;}});assert.equal(observeNodeFailure(object).fault,true);const proxy=new Proxy({},{get(){calls+=1;throw undefined;},ownKeys(){calls+=1;throw undefined;},getOwnPropertyDescriptor(){calls+=1;throw undefined;}});assert.equal(observeNodeFailure(proxy).fault,true);assert.equal(calls,0);}],
    ['F24',async()=>{const fix=fixture();raw(await execute(fix,{retire:async()=>{throw undefined;}}),undefined);}],
    ['F25',async()=>{const reason=new NodeProfileError('external source');const fix=fixture({args:['/entry.cjs']});fix.context.fs.readFile=async()=>{fix.counts.fs+=1;throw reason;};raw(await execute(fix,{}, {sourceRead:true}),reason);assert.equal(fix.counts.prepares,0);assert.equal(fix.counts.fs,1);}],
    ['F26',async()=>{const reason=new NodeUsageError('external iterator');const fix=fixture({args:[],stdin:{[Symbol.asyncIterator](){throw reason;}}});raw(await execute(fix,{}, {sourceRead:true,stdinRead:true}),reason);assert.equal(fix.counts.prepares,0);}],
    ['F27',async()=>{const fix=fixture({args:['-e']});status(await execute(fix,{}, {stderrWrite:true,stdinRead:true,sourceRead:true}),2);assert.equal(fix.counts.pulls,0);assert.equal(fix.counts.prepares,0);assert.match(fix.output('stderr'),/^node: /u);}],
    ['F28',async()=>{const error=new FsError('ENOENT',{message:'unacknowledged'});const fix=fixture();fix.context.fs.readFile=async()=>{throw error;};raw(await execute(fix,{start:async services=>{const response=await services.request(request());assert.equal(response.kind,'fsError');return profile();}},{dataRead:true}),error);}],
    ['F29',async()=>{const fix=fixture();const outcome=await execute(fix,{start:async()=>({kind:'entryReturned',observation:emptyObservation()})});assert.equal(outcome.kind,'throw');assert(outcome.value instanceof TypeError);assert.equal(fix.counts.retires,1);}],
    ['F30',async()=>{let calls=0;const options={provider:{profile:NODE_PROFILE,identity:'bad',prepare(){calls+=1;}},grants:{stdoutWrite:true,unexpected:true}};assert.throws(()=>createNodeCommand(options));assert.equal(calls,0);}],
    ['F31',async()=>{let calls=0;const thenable={};Object.defineProperty(thenable,'then',{get(){calls+=1;throw undefined;}});const result=await publishNodeObservation(null,()=>thenable);assert(result.publisherFault);assert(result.publisherFault.value instanceof TypeError);assert.equal(calls,0);}],
    ['F32',async()=>{const result=await publishNodeObservation(null,async()=>false);assert(result.publisherFault);assert(result.publisherFault.value instanceof TypeError);}],
    ...['F33','F34'].map(id=>[id,async()=>{
      const fix=fixture();const entered=deferred();let pending;let task;let aborted=false;let parentClosed=false;let rescue=0;
      fix.context.fs.readFile=async(path,options)=>{fix.counts.fs+=1;entered.resolve();return new Promise((resolve,reject)=>{const abort=()=>{aborted=true;parentClosed=true;reject(options.signal.reason);};options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort();pending=()=>{rescue+=1;parentClosed=true;options.signal.removeEventListener('abort',abort);resolve(new Uint8Array());};});};
      const watchdog=setTimeout(()=>pending?.(),1000);let outcome;
      try{outcome=await execute(fix,{start:async services=>{task=services.request(request());void task.catch(()=>{});await entered.promise;if(id==='F34')services.stopProfile({present:true,value:undefined});return profile();},retire:async()=>{await task.catch(()=>{});assert(parentClosed);return noAcquisition();}},{dataRead:true});}finally{clearTimeout(watchdog);}
      observations.set(id,{rescue,aborted,parentClosed,retirements:fix.counts.retires,role:'inert-provider-parent-job'});status(outcome,2);assert(aborted);assert(parentClosed);assert.equal(rescue,0);assert.equal(fix.counts.retires,1);assert.equal(fix.counts.cleanup,1);assert.equal(fix.controller.signal.aborted,false);
    }]),
  ];
  assert.deepEqual(cases.map(([id])=>id),focusedIdentities);
  const results=[];
  for(const [id,run] of cases){let result;try{await run();result={id,pass:true};}catch(error){result={id,pass:false,diagnostic:error instanceof Error?{name:error.name,message:error.message.slice(0,2048)}:{name:null,message:'non-Error assertion failure'}};}if(observations.has(id))result.observation=observations.get(id);results.push(result);await publish(result);}
  return results;
}

