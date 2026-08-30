import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const home=path.dirname(fileURLToPath(import.meta.url));
const captureRoot=path.join(home,'raw');fs.mkdirSync(captureRoot,{mode:0o700});
const stdout=fs.openSync(path.join(captureRoot,'stdout.raw'),'wx',0o600),stderr=fs.openSync(path.join(captureRoot,'stderr.raw'),'wx',0o600),record=fs.openSync(path.join(home,'RESULT.json'),'wx',0o600);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const insist=(value,code)=>{if(!value)throw Error(code);};
function raw(filename){const info=fs.lstatSync(filename);insist(info.isFile()&&!info.isSymbolicLink()&&info.size<=262144,'TEXT_ADMISSION');const data=fs.readFileSync(filename);insist(data.length===info.size,'READ_LENGTH');return data;}
const state={pid:null,exit:null,close:null,observed:[0,0],retained:[0,0],failures:[],signals:[]};
let child,timer,killTimer,seal,result;
function validate(){const data=raw(path.join(home,'PRESEAL.json'));insist(hash(data)===process.argv[2],'PRESEAL_HASH');const seal=JSON.parse(data);for(const row of [...seal.inputs,...seal.copies,...seal.own]){const actual=raw(row.path);insist(actual.length===row.bytes&&hash(actual)===row.sha256&&(fs.lstatSync(row.path).mode&511)===row.mode,'INPUT_DRIFT');}return seal;}
try{
  seal=validate();
  child=spawn(seal.tools[0].path,['--unhandled-rejections=strict','--max-old-space-size=256',path.join(seal.destination,'fixture-parent.mjs'),seal.auth.path,seal.auth.sha256],{cwd:seal.destination,env:{PATH:'',LANG:'C',LC_ALL:'C',HOME:home,TMPDIR:home},stdio:['ignore','pipe','pipe']});state.pid=child.pid;
  const closed=new Promise(resolve=>{child.once('exit',(code,signal)=>state.exit={code,signal});child.once('close',(code,signal)=>{state.close={code,signal};resolve();});});
  const stop=message=>{state.failures.push(message);if(!state.close){state.signals.push('SIGTERM');child.kill('SIGTERM');}};
  child.on('error',error=>stop(String(error)));
  for(const [index,stream]of [[0,child.stdout],[1,child.stderr]]){stream.on('data',chunk=>{state.observed[index]+=chunk.length;try{insist(state.observed[index]<=1048576,'CAPTURE_CAP');let offset=0;while(offset<chunk.length){const count=fs.writeSync(index===0?stdout:stderr,chunk,offset,chunk.length-offset);insist(count>0,'CAPTURE_WRITE');offset+=count;state.retained[index]+=count;}}catch(error){stop(error.message);}});stream.on('error',error=>stop(String(error)));}
  timer=setTimeout(()=>{stop('OWNER_DEADLINE');killTimer=setTimeout(()=>{if(!state.close){state.signals.push('SIGKILL');child.kill('SIGKILL');}},2000);},60000);
  await closed;clearTimeout(timer);clearTimeout(killTimer);
  insist(state.exit?.code===0&&state.close.code===0&&state.close.signal===null&&state.failures.length===0&&state.observed.every((count,index)=>count===state.retained[index]),'FIXTURE_PARENT_UNSAFE');
  const report=JSON.parse(raw(path.join(seal.destination,'small-fixtures-01/REPORT.json')));
  insist(report.unsafe===false&&report.rows.length===2&&report.rows.every(row=>row.qualified&&row.workerCreated===0&&row.state.closed&&row.durability.qualified),'SMALL_FIXTURE_FAILURE');
  validate();
  const novel=await import('./faults.mjs');const faults=await novel.runFaults(home);
  validate();
  result={status:faults.passed===12?'SCOPED_CONTROLS_PASS':'ORDINARY_ASSERTION_FAILURE',parent:state,smallFixtures:report,novel:faults,Workers:0,actualEngines:0,fixtureNodeStarts:4,controlPeak:3,preflight:true,postflight:true};
  if(faults.passed!==12)process.exitCode=1;
}catch(error){result={status:'HOLD',message:error.message,parent:state,Workers:0,actualEngines:0};process.exitCode=1;}
finally{clearTimeout(timer);clearTimeout(killTimer);for(const descriptor of[stdout,stderr]){fs.fsyncSync(descriptor);fs.closeSync(descriptor);}}
fs.writeSync(record,JSON.stringify(result,null,2)+'\n');fs.fsyncSync(record);fs.closeSync(record);process.stdout.write(JSON.stringify({status:result.status,small:result.smallFixtures?.rows.length,novel:result.novel?.passed,message:result.message??null,Workers:0})+'\n');
