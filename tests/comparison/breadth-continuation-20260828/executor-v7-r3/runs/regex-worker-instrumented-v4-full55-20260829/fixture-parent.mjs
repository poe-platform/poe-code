import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bytes, hash, requireValue } from './common.mjs';
import { collectDeferred } from './deferred-collector.mjs';

const home=path.dirname(fileURLToPath(import.meta.url));
const sealRaw=bytes(path.join(home,'SEAL.json'),262144), seal=JSON.parse(sealRaw);
const authRaw=bytes(process.argv[2],32768), auth=JSON.parse(authRaw);
requireValue(hash(authRaw)===process.argv[3]&&auth.scope==='TWO_RETIRED_CHILD_PUBLICATION_FIXTURES'&&auth.attempts===1&&auth.sealSha256===hash(sealRaw),'FIXTURE_AUTH');
for(const row of seal.files)bytes(path.join(home,row.path),2093056,row);
for(const row of seal.inherited)bytes(row.path,2093056,row);
const run=path.join(home,'small-fixtures-01');fs.mkdirSync(run,{mode:0o700});
const report={schema:'SMALL_DEFERRED_FIXTURES_V1',rows:[],unsafe:false,knownOsChildren:0,workers:0};
async function child(kind){
 const directory=path.join(run,kind);fs.mkdirSync(directory,{mode:0o700});
 const state={kind,pid:null,closed:false,status:null,signal:null,observed:[0,0],retained:[0,0],captureClosed:[false,false],failures:[],signals:[]};
 const descriptors=[];let instance,timer,killTimer,closedPromise;
 try{
  for(const name of ['stdout.raw','stderr.raw'])descriptors.push(fs.openSync(path.join(directory,name),'wx',0o600));
  instance=spawn(seal.node.path,['--unhandled-rejections=strict','--max-old-space-size=256','--permission','--allow-worker','--allow-fs-read='+home,...seal.inherited.map(row=>'--allow-fs-read='+row.path),'--allow-fs-write='+directory,path.join(home,'fixture-child.mjs'),directory,kind],{cwd:home,env:{PATH:'',LANG:'C',LC_ALL:'C',HOME:directory},stdio:['ignore','pipe','pipe']});
  state.pid=instance.pid;report.knownOsChildren++;
  closedPromise=new Promise(resolve=>instance.once('close',(status,signal)=>{Object.assign(state,{closed:true,status,signal});resolve();}));
  instance.on('error',error=>state.failures.push(String(error).slice(0,1024)));
  const terminate=signal=>{state.signals.push(signal);try{instance.kill(signal);}catch(error){state.failures.push(String(error).slice(0,1024));}};
  for(const [index,stream]of [[0,instance.stdout],[1,instance.stderr]])stream.on('data',chunk=>{
   state.observed[index]+=chunk.length;
   try{requireValue(state.retained[index]+chunk.length<=65536,'FIXTURE_CAPTURE_CAP');let offset=0;while(offset<chunk.length){const amount=fs.writeSync(descriptors[index],chunk,offset,chunk.length-offset);requireValue(amount>0,'FIXTURE_CAPTURE_SHORT');offset+=amount;state.retained[index]+=amount;}}
   catch(error){state.failures.push(String(error).slice(0,1024));terminate('SIGTERM');}
  });
  timer=setTimeout(()=>{state.failures.push('FIXTURE_DEADLINE');terminate('SIGTERM');killTimer=setTimeout(()=>terminate('SIGKILL'),2000);},10000);
  await closedPromise;
 }catch(error){state.failures.push(String(error).slice(0,1024));if(instance&&!state.closed){instance.kill('SIGTERM');await closedPromise;}}
 finally{clearTimeout(timer);clearTimeout(killTimer);for(const [index,descriptor]of descriptors.entries()){try{fs.fsyncSync(descriptor);}catch(error){state.failures.push(String(error));}try{fs.closeSync(descriptor);state.captureClosed[index]=true;}catch(error){state.failures.push(String(error));}}}
 fs.writeFileSync(path.join(directory,'SUPERVISION.json'),JSON.stringify(state)+'\n',{flag:'wx',mode:0o600});
 requireValue(state.closed&&state.status===1&&state.signal===null&&state.failures.length===0&&state.captureClosed.every(Boolean)&&state.observed.every((count,index)=>count===state.retained[index]),'FIXTURE_SUPERVISION_UNSAFE');
 const events=bytes(path.join(directory,'stdout.raw'),65536).toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
 requireValue(events.length===3&&events[0].event==='fixture-bootstrap'&&events[1].event==='early-operation'&&events[2].event==='fixture-result','FIXTURE_EVENT_ORDER');
 const early=JSON.parse(bytes(path.join(directory,'EARLY.json'),65536,events[1].binding));
 const result=JSON.parse(bytes(path.join(directory,'RESULT.json'),65536,events[2].binding));
 const expected=kind==='FALSE_PRIMARY'?{type:'boolean',value:false}:{type:'undefined'};
 requireValue(early.primaryPresent===true&&JSON.stringify(early.primary)===JSON.stringify(expected)&&JSON.stringify(result.primary)===JSON.stringify(expected)&&result.ordinaryFailure===true&&result.pass===false&&early.countsPresent===true&&early.created===0,'RAW_REASON_AND_MISSING_ROW');
 requireValue(result.writer.closed===true&&result.writer.rows.every(row=>row.enrolled&&row.opened&&row.closed&&!row.fsynced&&row.durability==='PARENT_DEFERRED')&&result.offline.violations.length===0&&result.offline.pending===0&&result.offline.descriptors===0,'FIXTURE_WRITER_AND_GUARD');
 const durability=collectDeferred({root:directory,allowed:['worker-1.jsonl','EARLY.json','RESULT.json'],bindings:[result.witness,events[1].binding,events[2].binding],lifecycle:{childClosed:state.closed,signal:state.signal,workersKnownRetired:result.workersKnownRetired}});
 for(const file of seal.files)bytes(path.join(home,file.path),2093056,file);
 for(const file of seal.inherited)bytes(file.path,2093056,file);
 return {kind,qualified:true,state,durability,reason:early.primary,ordinaryFailurePreserved:true,workerCreated:result.workersCreated};
}
for(const kind of ['FALSE_PRIMARY','UNDEFINED_PRIMARY']){
 if(report.unsafe){report.rows.push({kind,status:'UNRUN'});continue;}
 try{report.rows.push(await child(kind));}catch(error){report.unsafe=true;report.rows.push({kind,status:'UNSAFE_STOP',error:String(error).slice(0,2048),durability:error.receipt??null});}
}
fs.writeFileSync(path.join(run,'REPORT.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({unsafe:report.unsafe,qualified:report.rows.filter(row=>row.qualified).length,children:report.knownOsChildren,workers:0}));process.exitCode=report.unsafe?1:0;
