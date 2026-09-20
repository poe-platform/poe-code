import {Readable,Writable}from'node:stream';import {native}from'./native.js';
export function createMockRunner(behaviors){const remaining=[...behaviors],queue=new native.MockQueue(remaining.length);return{name:'mock',exec(spec){const index=queue.nextIndex(),behavior=index===null?undefined:remaining[index];if(index!==null)remaining[index]=undefined;if(behavior===undefined)throw new Error(native.MOCK_EXHAUSTED_ERROR);return runHandle(spec,behavior);}};}
export function createMockRunnerByCommand(behaviors){return{name:'mock',exec(spec){const behavior=Object.hasOwn(behaviors,spec.command)?behaviors[spec.command]:undefined;if(behavior===undefined)throw new Error(native.mockMissingCommand(spec.command));return runHandle(spec,behavior);}};}
function runHandle(spec,behavior){
 const stdout=spec.stdout??'pipe',stderr=spec.stderr??'pipe',stdin=spec.stdin??'ignore',interval=behavior.stdoutInterval??10,delay=behavior.exitAfterMs,completion=native.mockCompletion(delay===undefined?undefined:typeof delay==='number'?delay:NaN);
 const out=stdout==='pipe'&&behavior.stdout!==undefined?readable(behavior.stdout,interval):null,err=stderr==='pipe'&&behavior.stderr!==undefined?readable(behavior.stderr,interval):null,output=Promise.all([...(out?[out.done]:[]),...(err?[err.done]:[])]),state=new native.MockRun();let resolveResult;const result=new Promise(resolve=>{resolveResult=resolve;}),complete=()=>{if(state.finish())resolveResult({exitCode:behavior.exitCode});},timer=completion==='timer'?setTimeout(complete,delay):undefined;
 if(completion==='output')void output.then(complete);else if(completion==='microtask')queueMicrotask(complete);
 return{pid:behavior.pid??null,stdout:out?.stream??null,stderr:err?.stream??null,stdin:stdin==='pipe'?new Writable({write(_chunk,_encoding,callback){callback();}}):null,result,kill(){if(timer!==undefined)clearTimeout(timer);out?.stop();err?.stop();complete();}};
}
function readable(lines,interval){
 const stream=new Readable({read(){}}),state=new native.MockStream(),timers=new Set();let resolveDone;const done=new Promise(resolve=>{resolveDone=resolve;}),stop=()=>{if(!state.stop())return;for(const timer of timers)clearTimeout(timer);timers.clear();stream.push(null);resolveDone();};
 if(lines.length===0){queueMicrotask(stop);return{done,stream,stop};}
 for(const[index,line]of lines.entries()){const timer=setTimeout(()=>{timers.delete(timer);if(!state.emit())return;stream.push(line);if(index===lines.length-1)stop();},interval*(index+1));timers.add(timer);}
 return{done,stream,stop};
}
