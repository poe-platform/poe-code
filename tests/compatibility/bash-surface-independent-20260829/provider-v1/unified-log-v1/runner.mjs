import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {select} from './selector.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function run(base,capture,expectedSeal){
 const eventFd=fs.openSync(capture+'/QUERY-EVENTS.jsonl','wx',0o600);
 const outFd=fs.openSync(capture+'/QUERY.stdout','wx',0o600),errFd=fs.openSync(capture+'/QUERY.stderr','wx',0o600);
 let eventBytes=0,proc,timer,termTimer,killTimer,row,state,plan;
 const emit=value=>{const bytes=Buffer.from(JSON.stringify(value)+'\n');if(eventBytes+bytes.length>65536)throw Error('EVENT_CAPTURE_LIMIT');fs.writeFileSync(eventFd,bytes);eventBytes+=bytes.length;};
 const save=()=>fs.writeFileSync(capture+'/STATE.json',JSON.stringify(state,null,2)+'\n');
 const result={schema:'d03-unified-log-query-v1',status:'ADMISSION',launched:false,rawPublished:false,selected:[]};
 try{
  emit({event:'CAPTURE_READY',at:Date.now()});
  const sealBytes=fs.readFileSync(base+'/PRESEAL.json');if(hash(sealBytes)!==expectedSeal)throw Error('SEAL_DRIFT');
  const seal=JSON.parse(sealBytes);for(const item of seal.files){const bytes=fs.readFileSync(base+'/'+item.path);if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw Error('SOURCE_DRIFT');}
  plan=JSON.parse(fs.readFileSync(base+'/PLAN.json'));state=JSON.parse(fs.readFileSync(capture+'/STATE.json'));
  if(state.active||state.halted||state.direct.length>=24||Date.now()+15000>=plan.deadline)throw Error('PHASE_ADMISSION');
  const tool=fs.lstatSync(plan.tool.path);if(!tool.isFile()||tool.isSymbolicLink()||tool.size!==plan.tool.bytes||(tool.mode&4095)!==plan.tool.mode||hash(fs.readFileSync(plan.tool.path))!==plan.tool.sha256)throw Error('TOOL_DRIFT');
  fs.mkdirSync(plan.env.HOME,{mode:0o700});fs.mkdirSync(plan.env.TMPDIR,{mode:0o700});
  fs.writeFileSync(capture+'/ONE-QUERY-CONSUMED',expectedSeal+'\n',{flag:'wx',mode:0o600});
  row={number:state.direct.length+1,label:'ONE_LOG_QUERY',executable:plan.tool.path,args:plan.args,started:Date.now(),exit:false,close:false,stdoutEnd:false,stderrEnd:false,stdoutBytes:0,stderrBytes:0,errors:[]};state.direct.push(row);state.active=1;save();emit({event:'ENROLLED',number:row.number,args:plan.args,env:plan.env,cwd:plan.cwd});
  let settle;const retired=new Promise(resolve=>{settle=resolve;});
  const stop=reason=>{if(!row.errors.includes(reason))row.errors.push(reason);state.halted=true;if(proc?.pid){try{process.kill(-proc.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')row.errors.push('TERM_FAILED');}if(!termTimer)termTimer=setTimeout(()=>{try{process.kill(-proc.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')row.errors.push('KILL_FAILED');}killTimer=setTimeout(()=>settle('UNKNOWN_RETIREMENT'),plan.queryLimits.killGraceMs);},plan.queryLimits.termGraceMs);}};
  proc=spawn(plan.tool.path,plan.args,{cwd:plan.cwd,env:plan.env,shell:false,detached:true,stdio:['ignore','pipe','pipe']});
  proc.on('error',()=>stop('SPAWN_ERROR'));
  proc.on('exit',(code,signal)=>{row.exit=true;row.code=code;row.signal=signal;});
  proc.on('close',(code,signal)=>{row.close=true;row.code=code;row.signal=signal;settle('CLOSED');});
  const consume=(key,fd,limit)=>bytes=>{try{if(row[key]+bytes.length>limit||state.captureBytes+bytes.length>state.limits.captureBytes){stop('CAPTURE_LIMIT');return;}fs.writeFileSync(fd,bytes);row[key]+=bytes.length;state.captureBytes+=bytes.length;}catch{stop('CAPTURE_FAILURE');}};
  proc.stdout.on('data',consume('stdoutBytes',outFd,plan.queryLimits.stdoutBytes));proc.stderr.on('data',consume('stderrBytes',errFd,plan.queryLimits.stderrBytes));
  proc.stdout.on('end',()=>{row.stdoutEnd=true;});proc.stderr.on('end',()=>{row.stderrEnd=true;});proc.stdout.on('error',()=>stop('STDOUT_ERROR'));proc.stderr.on('error',()=>stop('STDERR_ERROR'));
  row.pid=proc.pid;result.launched=true;emit({event:'STARTED',pid:row.pid});save();
  timer=setTimeout(()=>stop('QUERY_DEADLINE'),plan.queryLimits.activeMs);
  const disposition=await retired;clearTimeout(timer);clearTimeout(termTimer);clearTimeout(killTimer);
  row.finished=Date.now();row.disposition=disposition;let absent=false;try{process.kill(-row.pid,0);}catch(error){if(error.code==='ESRCH')absent=true;else row.errors.push('GROUP_CHECK_UNKNOWN');}row.groupAbsent=absent;
  if(!row.exit||!row.close||!row.stdoutEnd||!row.stderrEnd||!absent){state.halted=true;row.errors.push('RETIREMENT_UNKNOWN');}state.active=row.close?0:1;save();emit({event:'RETIRED',row});
  result.query=row;result.status=row.errors.length||row.code!==0?'STOP':'COMPLETE';
  if(result.status==='COMPLETE'){const bytes=fs.readFileSync(capture+'/QUERY.stdout');let rows;try{rows=JSON.parse(bytes);}catch{result.status='STOP_OUTPUT_FORMAT';}if(rows!==undefined){if(!Array.isArray(rows)){result.status='STOP_OUTPUT_SHAPE';}else{result.rawRows=rows.length;result.rejected={};for(const item of rows){const selected=select(item);if(selected.matched)result.selected.push(selected.fields);else result.rejected[selected.reason]=(result.rejected[selected.reason]??0)+1;}result.matchCount=result.selected.length;if(Object.keys(result.rejected).length)result.status='STOP_UNEXPECTED_ROW';}}}
 }catch(error){result.status='STOP';result.error=typeof error?.message==='string'&&/^[A-Z_]+$/.test(error.message)?error.message:'HELPER_FAILURE';if(state){state.halted=true;save();}emit({event:'STOP',code:result.error});}
 finally{clearTimeout(timer);clearTimeout(termTimer);clearTimeout(killTimer);fs.closeSync(outFd);fs.closeSync(errFd);for(const name of ['QUERY.stdout','QUERY.stderr']){const bytes=fs.readFileSync(capture+'/'+name);(result.raw??=[]).push({name,bytes:bytes.length,sha256:hash(bytes)});}result.captureClosed=true;emit({event:'CAPTURE_COMPLETE',raw:result.raw,status:result.status});fs.closeSync(eventFd);fs.writeFileSync(capture+'/RESULT.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});}
 return result;
}
