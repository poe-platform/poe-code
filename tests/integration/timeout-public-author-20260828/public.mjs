import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate as immediate} from 'node:timers/promises';
import * as api from 'virtual-bash';
import * as leaf from 'virtual-bash/commands/timeout';
import {expectedNames} from './names.mjs';

const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const host=commands=>({commands,use(){throw Error('unexpected middleware');},registerFileSystem(){throw Error('unexpected filesystem');}});
function clock(){
  const provider={time:0,handles:new Map(),arms:[],clears:[],next:0,now(){assert.equal(this,provider);return this.time;},
    setTimeout(callback,milliseconds){assert.equal(this,provider);const handle=this.next++;this.handles.set(handle,callback);this.arms.push(milliseconds);return handle;},
    clearTimeout(handle){assert.equal(this,provider);this.clears.push(handle);this.handles.delete(handle);},
    wake(milliseconds){this.time+=milliseconds;const callback=this.handles.values().next().value;assert.equal(typeof callback,'function');callback();}};
  return provider;
}
function context(args,extra={}){
  const output=[],errors=[],cleanups=[];
  return{command:'timeout',args,stdin:api.toByteSource(Uint8Array.of(0,255,65)),stdinIsDefault:false,
    stdout:{async write(bytes){output.push(new Uint8Array(bytes));}},stderr:{async write(bytes){errors.push(new Uint8Array(bytes));}},
    fs:api.createMemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,
    registerCleanup(callback){cleanups.push(callback);},output,errors,cleanups,...extra};
}
async function withShell(options,operation){const fs=options.shell?.fs??api.createMemoryFileSystem();const shell=new api.Shell({...options.shell,fs}).use(api.agentCommands(options.plugin));try{return await operation(shell,fs);}finally{await shell.dispose();}}
const noErrors=result=>assert.equal(result.stderr,'');

test('root and explicit leaf expose identical factories and exact78 independent names',()=>{
  for(const name of ['createTimeoutCommand','createTimeoutCommands','timeoutCommands'])assert.equal(api[name],leaf[name]);
  assert.equal(expectedNames.length,78);assert.equal(new Set(expectedNames).size,78);
  assert.deepEqual(api.createAgentCommands().map(row=>row.name).sort(),expectedNames);
  for(const name of ['curl','safejs','getopts'])assert.equal(expectedNames.includes(name),false);
});
test('standalone family and factory remain one-command definitions',async()=>{
  assert.deepEqual(leaf.createTimeoutCommands().map(row=>row.name),['timeout']);
  const commands=new api.CommandRegistry();await leaf.timeoutCommands().setup(host(commands));assert.deepEqual(commands.list().map(row=>row.name),['timeout']);
});
test('replacement authority ignores nested runtime replace, with no partial registration',()=>{
  const old={name:'timeout',execute:()=>({exitCode:7})},other={name:'other',execute:()=>({exitCode:8})};
  const commands=new api.CommandRegistry([old,other]),before=commands.list();
  const timeout={get replace(){throw Error('nested replace must not be read');}};
  assert.throws(()=>api.agentCommands({timeout}).setup(host(commands)),/already registered/u);assert.deepEqual(commands.list(),before);
  api.agentCommands({replace:true,timeout}).setup(host(commands));assert.equal(commands.list().length,79);assert.notEqual(commands.get('timeout'),old);assert.equal(commands.get('other'),other);
});
test('invalid timeout settings leave registry empty',()=>{
  for(const timeout of [{maxTimerMilliseconds:0},{maxTimerMilliseconds:2147483648},{invoke:1},{scheduler:{now:()=>0}}]){
    const commands=new api.CommandRegistry();assert.throws(()=>api.agentCommands({timeout}).setup(host(commands)));assert.equal(commands.list().length,0);
  }
});
test('zero deadline calls configured invoker with exact streams and no timer work',async()=>{
  let called=0;const scheduler={now(){throw Error('zero read clock');},setTimeout(){throw Error('zero armed');},clearTimeout(){throw Error('zero cleared');}};
  const input=context(['0','child','literal']);
  const invoke=function(name,args,options){assert.equal(this,undefined);called++;assert.equal(name,'child');assert.deepEqual(args,['literal']);assert.equal(options.stdin,input.stdin);assert.equal(options.stdout,input.stdout);assert.equal(options.stderr,input.stderr);assert.equal(options.stdinIsDefault,false);assert.equal(Object.hasOwn(options,'signal'),false);return{exitCode:7};};
  const command=api.createAgentCommands({timeout:{invoke,scheduler}}).find(row=>row.name==='timeout');
  assert.deepEqual(await command.execute(input),{exitCode:7});assert.equal(called,1);assert.equal(input.cleanups.length,0);
});
test('context invoke precedence and receiver are unchanged',async()=>{
  const input=context(['0','child']);input.invoke=function(){assert.equal(this,input);return{exitCode:9};};
  const command=api.createTimeoutCommand({invoke(){throw Error('fallback used');}});assert.deepEqual(await command.execute(input),{exitCode:9});
  input.invoke=undefined;const result=await command.execute(input);assert.equal(result.exitCode,125);assert.equal(Buffer.concat(input.errors).toString(),'timeout: command invocation is unavailable\n');
});
test('aggregate scheduler receiver, chunk cap and cleanup-before-arm propagate',async()=>{
  const scheduler=clock(),input=context(['.005','child']);let registered=false;input.registerCleanup=callback=>{registered=true;input.cleanups.push(callback);};
  const originalNow=scheduler.now;scheduler.now=function(){assert.equal(registered,true);return originalNow.call(this);};
  const command=api.createAgentCommands({timeout:{scheduler,maxTimerMilliseconds:2,invoke:async()=>({exitCode:7})}}).find(row=>row.name==='timeout');
  assert.deepEqual(await command.execute(input),{exitCode:7});assert.deepEqual(scheduler.arms,[2]);assert.deepEqual(scheduler.clears,[0]);assert.equal(scheduler.handles.size,0);await Promise.all(input.cleanups.map(cleanup=>cleanup()));assert.deepEqual(scheduler.clears,[0]);
});
test('default timeout composes binary stdin pipes and VFS effects',async()=>withShell({},async(shell,fs)=>{
  const result=await shell.exec('timeout 0 cat | tee /copy | timeout 0 cat',{stdin:Uint8Array.of(0,255,65,10)});assert.equal(result.exitCode,0);noErrors(result);assert.deepEqual([...result.stdoutBytes],[0,255,65,10]);assert.deepEqual([...await fs.readFile('/copy')],[0,255,65,10]);
}));
test('unsupported native modes retain exact diagnostics',async()=>withShell({},async shell=>{
  const result=await shell.exec('timeout --kill-after=1 2 true');assert.equal(result.exitCode,125);assert.equal(result.stdout,'');assert.equal(result.stderr,'timeout: option --kill-after is unsupported\n');
}));
test('cooperative deadline waits for owned child cleanup without aborting caller',async()=>{
  const scheduler=clock(),started=gate(),release=gate(),caller=new AbortController();let closed=false,settled=false;
  await withShell({plugin:{timeout:{scheduler}}},async shell=>{
    shell.commands.register({name:'wait-child',async execute(input){input.registerCleanup?.(async()=>{await release.promise;closed=true;});started.resolve();await new Promise((resolve,reject)=>{if(input.signal.aborted)reject(input.signal.reason);else input.signal.addEventListener('abort',()=>reject(input.signal.reason),{once:true});});return{exitCode:7};}});
    const outcome=shell.exec('timeout .001 wait-child',{signal:caller.signal}).then(value=>{settled=true;return value;});
    try{await started.promise;scheduler.wake(1);await immediate();assert.equal(settled,false);assert.equal(caller.signal.aborted,false);release.resolve();const result=await outcome;assert.equal(result.exitCode,124);assert.equal(result.stdout,'');noErrors(result);assert.equal(closed,true);assert.equal(scheduler.handles.size,0);}
    finally{release.resolve();}
  });
});
test('caller abort reason identity survives timeout and resource retirement',async()=>{
  const scheduler=clock(),started=gate(),caller=new AbortController(),reason={caller:'timeout-public'};
  await withShell({plugin:{timeout:{scheduler}}},async shell=>{
    shell.commands.register({name:'wait-child',async execute(input){started.resolve();await new Promise((resolve,reject)=>input.signal.addEventListener('abort',()=>reject(input.signal.reason),{once:true}));return{exitCode:0};}});
    const outcome=shell.exec('timeout 1 wait-child',{signal:caller.signal});const observed=assert.rejects(outcome,error=>error===reason);await started.promise;caller.abort(reason);await observed;assert.equal(scheduler.handles.size,0);
  });
});
test('nested timeout uses shell shared command budget',async()=>withShell({},async shell=>{
  const result=await shell.exec('timeout 0 timeout 0 true',{limits:{maxCommands:3}});assert.equal(result.exitCode,0);noErrors(result);
  await assert.rejects(shell.exec('timeout 0 timeout 0 true',{limits:{maxCommands:2}}),error=>error instanceof api.ShellLimitError&&error.limit==='maxCommands');
}));
test('real default scheduler example is cooperative, not a hard-preemption claim',async()=>withShell({},async shell=>{
  const success=await shell.exec('timeout 1s printf ready');assert.equal(success.exitCode,0);assert.equal(success.stdout,'ready');noErrors(success);
  const timed=await shell.exec('timeout .01s sleep 1');assert.equal(timed.exitCode,124);assert.equal(timed.stdout,'');noErrors(timed);
}));
