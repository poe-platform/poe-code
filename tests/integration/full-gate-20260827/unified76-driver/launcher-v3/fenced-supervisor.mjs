import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync, realpathSync} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import {node24,save,sha} from './common.mjs';
import {BOUNDS} from './policy.mjs';
import {supervise,processes} from './supervise.mjs';
import {attachProcessObserver,createObserverClient} from './process-observer.mjs';
import {createInstructionFence,instructionFenceInvocation,validateInstructionFence} from './os-instruction-fence.mjs';

function inside(path,roots){const actual=realpathSync(path);assert.ok(roots.some(root=>actual===root||actual.startsWith(root+'/')),'path outside owned write universe');return actual;}

function attachPhaseSupervisor(child,token,envelope,phases){
  const root=processes().find(row=>row.pid===child.pid);assert.ok(root);
  const events=[],running=new Set(),controllers=new Set(),seen=new Set();let index=0,closing=false;
  const reply=(id,value)=>new Promise(resolve=>{if(!child.connected){events.push({replyError:'worker disconnected'});resolve();return;}child.send({kind:'unified76-fenced-phase-reply',id,...value},error=>{if(error)events.push({replyError:error.message});resolve();});});
  const close=()=>{closing=true;for(const controller of controllers)controller.abort(new Error('owned worker closed before its phase'));};
  const receive=message=>{
    if(message?.kind!=='unified76-fenced-phase')return;
    const operation=(async()=>{
      let controller;
      try{
        assert.equal(closing,false);assert.equal(message.token,token);assert.match(message.id,/^[a-f0-9-]{36}$/u);assert.equal(seen.has(message.id),false);seen.add(message.id);
        assert.ok(Buffer.byteLength(JSON.stringify(message))<=BOUNDS.setupStderrBytes);assert.equal(running.size,0,'phases must not overlap');
        const current=processes().find(row=>row.pid===root.pid);assert.ok(current&&current.born===root.born,'owned requester changed');
        const {label,executable,args,options}=message;assert.equal(label,phases[index]);assert.equal(executable,node24);
        assert.deepEqual(Object.keys(options).sort(),['cwd','env','maxOutputBytes','observeSockets','stderr','stdout','timeoutMs']);
        assert.ok(Array.isArray(args)&&args.every(arg=>typeof arg==='string'&&!arg.includes('\0')));
        const roots=envelope.roots.map(row=>row.path);inside(options.cwd,roots);
        for(const channel of ['stdout','stderr'])assert.equal(join(realpathSync(dirname(options[channel])),basename(options[channel])),join(roots[1],label+'.'+channel));
        assert.ok(Number.isSafeInteger(options.timeoutMs)&&options.timeoutMs>0&&options.timeoutMs<=BOUNDS.phaseTimeoutMs);
        assert.ok(Number.isSafeInteger(options.maxOutputBytes)&&options.maxOutputBytes>0&&options.maxOutputBytes<=BOUNDS.phaseOutputBytes);
        assert.equal(options.observeSockets,true);assert.ok(options.env&&typeof options.env==='object');
        for(const [key,value]of Object.entries(options.env)){assert.equal(typeof value,'string');assert.ok(!key.startsWith('DYLD_')&&!key.startsWith('LD_'));}
        const invocation=instructionFenceInvocation(envelope,executable,args,options.env,{preserveEnvironment:true});
        index++;controller=new AbortController();controllers.add(controller);
        const result=await supervise(invocation.executable,invocation.args,{...options,env:invocation.env,signal:controller.signal});
        assert.ok(Buffer.byteLength(JSON.stringify(result))<=BOUNDS.phaseOutputBytes,'bounded process metadata reply');
        events.push({label,result,osFence:invocation.receipt});await reply(message.id,{result:{...result,osFence:invocation.receipt}});
      }catch(error){events.push({id:message.id,error:error.message});await reply(message.id,{error:error.message});}
      finally{if(controller)controllers.delete(controller);}
    })();
    running.add(operation);void operation.then(()=>running.delete(operation),error=>{running.delete(operation);events.push({error:error.message});});
  };
  child.on('message',receive);child.once('close',close);
  return{async finish(){closing=true;child.off('message',receive);child.off('close',close);for(const controller of controllers)controller.abort(new Error('phase ownership ending'));await Promise.allSettled([...running]);return{root,events,expectedPhases:phases,completed:index,clean:index===phases.length&&events.length===phases.length&&events.every(row=>row.result?.clean&&row.result?.closed&&!row.result.signals.length&&!row.result.survivors.length)};}};
}

export async function superviseFencedWorker({output,outer,script,args,cwd,environment,phases,limits}){
  const envelope=createInstructionFence(output),token=randomUUID(),file=join(outer,'OS-FENCE.json');save(file,envelope);validateInstructionFence(envelope,{initial:true});
  const invocation=instructionFenceInvocation(envelope,node24,[script,...args],{...environment,UNIFIED76_OS_FENCE:file,UNIFIED76_OBSERVER_TOKEN:token});
  let observer,phaseSupervisor,result,phaseReceipt,observerReceipt;
  try{result=await supervise(invocation.executable,invocation.args,{...limits,cwd,env:invocation.env,stdout:join(outer,'stdout'),stderr:join(outer,'stderr'),ipc:true,onSpawn:child=>{observer=attachProcessObserver(child,token);phaseSupervisor=attachPhaseSupervisor(child,token,envelope,phases);}});}
  finally{phaseReceipt=await phaseSupervisor?.finish();observerReceipt=observer?.finish();}
  assert.equal(sha(readFileSync(file)),sha(JSON.stringify(envelope,null,2)+'\n'),'outer envelope changed');validateInstructionFence(envelope);
  const receipt={envelope,result,phaseReceipt,observerReceipt,clean:result.clean&&phaseReceipt?.clean&&observerReceipt?.survivors.length===0,qualification:'Trusted outer owns and observes each restricted worker/phase. Phase targets are sibling process groups with the identical OS profile, never unfenced executions. IPC passes no writable file descriptors.'};
  save(join(outer,'OS-FENCE-RESULT.json'),receipt);return receipt;
}

export function openFencedWorker(){
  assert.ok(process.connected&&typeof process.send==='function','guarded outer IPC launch required');
  const file=process.env.UNIFIED76_OS_FENCE,token=process.env.UNIFIED76_OBSERVER_TOKEN;assert.equal(typeof file,'string');assert.match(token,/^[a-f0-9-]{36}$/u);
  const envelope=validateInstructionFence(JSON.parse(readFileSync(file)),{initial:true});assert.equal(process.ppid,envelope.launcherPid);
  assert.equal(realpathSync(process.execPath),realpathSync(node24));assert.equal(realpathSync(process.env.TMPDIR),join(envelope.roots[0].path,'tmp'));
  const observer=createObserverClient(token);
  const superviseRemote=(executable,args,options)=>new Promise((resolve,reject)=>{
    const id=randomUUID(),label=basename(options.stdout,'.stdout');
    const timer=setTimeout(()=>finish(new Error('outer phase response deadline')),BOUNDS.phaseTimeoutMs+BOUNDS.cleanupTimeoutMs);
    const receive=message=>{if(message?.kind==='unified76-fenced-phase-reply'&&message.id===id)finish(message.error?new Error(message.error):undefined,message.result);};
    const disconnect=()=>finish(new Error('outer phase supervisor disconnected'));
    function finish(error,value){clearTimeout(timer);process.off('message',receive);process.off('disconnect',disconnect);error?reject(error):resolve(value);}
    process.on('message',receive);process.once('disconnect',disconnect);
    process.send({kind:'unified76-fenced-phase',id,token,label,executable,args,options},error=>{if(error)finish(error);});
  });
  return{envelope,observer,supervise:superviseRemote};
}
