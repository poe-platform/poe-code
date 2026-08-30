import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const root=process.env.REVIEW_PRODUCT;
const {createOutputOperation}=await import(pathToFileURL(join(root,'dist/contracts/output.js')));
const {InvocationScope}=await import(pathToFileURL(join(root,'dist/shell/cleanup.js')));
const {Shell}=await import(pathToFileURL(join(root,'dist/shell/shell.js')));
const {MemoryFileSystem}=await import(pathToFileURL(join(root,'dist/fs/memory/index.js')));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const settleTicks=async()=>{await tick();await tick();await tick();};
const sink={async write(){}};
const results=[],unhandled=[];process.on('unhandledRejection',error=>unhandled.push(String(error)));
async function control(name,operation){try{results.push({name,status:'PASS',detail:await operation()});}catch(error){results.push({name,status:'FAIL',error:String(error),stack:error.stack});}}
await control('registration-before-acquisition; closed admission; shared draining',async()=>{
  const scope=new InvocationScope(),ready=deferred(),release=deferred(),releaseStarted=deferred(),events=[];let releases=0,settled=false;
  const operation=createOutputOperation({signal:scope.signal,registerCleanup:cleanup=>{events.push('registered');scope.register(cleanup);}},sink);
  const acquiring=operation.acquire(()=>{events.push('acquire');return ready.promise;},async()=>{releases++;releaseStarted.resolve();await release.promise;});
  const acquired=acquiring.then(value=>({value}),error=>({error}));
  try{
    assert.deepEqual(events,['registered','acquire']);const closing=operation.close();assert.equal(operation.close(),closing);void closing.then(()=>{settled=true;});await settleTicks();assert.equal(settled,false);
    let laterAcquired=false;await assert.rejects(operation.acquire(()=>{laterAcquired=true;return{};},()=>{}),/closed/u);assert.equal(laterAcquired,false);
    ready.resolve({owned:true});await releaseStarted.promise;assert.equal(settled,false);release.resolve();await closing;assert.equal(releases,1);assert.match(String((await acquired).error),/closed/u);await scope.close();return{events,releases,closedAdmission:true};
  }finally{ready.resolve({owned:true});release.resolve();await acquired;await operation.close();await scope.close();}
});
await control('stdout-owned closure leaves caller and sibling output open',async()=>{
  const scope=new InvocationScope(),consumer=new AbortController(),writes=[];
  const context={signal:scope.signal,registerCleanup:cleanup=>scope.register(cleanup)};
  const output=createOutputOperation(context,{...sink,ownedOutput:{consumerClosed:consumer.signal,async write(){}}});
  const sibling=createOutputOperation(context,{async write(bytes){writes.push([...bytes]);}});
  consumer.abort(new Error('stdout consumer retired'));await output.close();assert.equal(output.signal.aborted,true);assert.equal(scope.signal.aborted,false);assert.equal(sibling.signal.aborted,false);await sibling.output.write(new Uint8Array([76]));assert.deepEqual(writes,[[76]]);await scope.close();return{writes,callerPreservedUntilRootClose:true};
});
await control('custom host without hook retains finally disposal',async()=>{
  let releases=0;const operation=createOutputOperation({signal:new AbortController().signal},sink);
  try{await operation.acquire(()=>({owned:true}),async()=>{releases++;});}finally{await operation.close();}
  assert.equal(releases,1);assert.equal(operation.close(),operation.close());return{releases};
});
await control('real Shell exec waits registered cooperative cleanup',async()=>{
  const shell=new Shell({fs:new MemoryFileSystem()}),started=deferred(),release=deferred();let settled=false;
  shell.register({name:'resource',execute(context){context.registerCleanup(async()=>{started.resolve();await release.promise;});return{exitCode:0};}});
  const execution=shell.exec('resource');void execution.then(()=>{settled=true;},()=>{settled=true;});
  try{await started.promise;await settleTicks();assert.equal(settled,false);release.resolve();assert.equal((await execution).exitCode,0);assert.equal(settled,true);return{execWaited:true};}finally{release.resolve();await execution.catch(()=>{});await shell.dispose();}
});
await control('real Shell dispose shares root barrier and closes admission',async()=>{
  const shell=new Shell({fs:new MemoryFileSystem()}),started=deferred(),release=deferred();let execSettled=false,disposeSettled=false;
  shell.register({name:'resource',execute(context){context.registerCleanup(async()=>{started.resolve();await release.promise;});return{exitCode:0};}});
  const execution=shell.exec('resource').then(value=>{execSettled=true;return{value};},error=>{execSettled=true;return{error};});
  try{await started.promise;const disposal=shell.dispose();assert.equal(shell.dispose(),disposal);void disposal.then(()=>{disposeSettled=true;});await assert.rejects(shell.exec('resource'),/disposed/u);await settleTicks();assert.equal(execSettled,false);assert.equal(disposeSettled,false);release.resolve();await disposal;const result=await execution;assert.match(String(result.error),/disposed/u);return{execWaited:true,disposeWaited:true,disposalError:String(result.error)};}finally{release.resolve();await execution;await shell.dispose();}
});
await control('unregistered opaque continuation is observed, not forcibly retired',async()=>{
  const shell=new Shell({fs:new MemoryFileSystem()}),entered=deferred(),release=deferred(),late=deferred();let effects=0;
  shell.register({name:'opaque',async execute(){entered.resolve();await release.promise;effects++;late.resolve();return{exitCode:0};}});
  const execution=shell.exec('opaque').then(value=>({value}),error=>({error}));
  try{await entered.promise;await shell.dispose();assert.equal(effects,0);const result=await execution;assert.match(String(result.error),/disposed/u);release.resolve();await late.promise;await settleTicks();assert.equal(effects,1);return{effectAfterDisposal:effects,opaqueHostNotPreempted:true};}finally{release.resolve();await late.promise;await execution;await shell.dispose();}
});
await settleTicks();assert.deepEqual(unhandled,[]);console.log(JSON.stringify({results,unhandled,productRoot:root,scope:'Six narrow actual cleanup component/registry controls; not canonical/public cleanup cohort'}));if(results.some(result=>result.status==='FAIL'))process.exitCode=1;
