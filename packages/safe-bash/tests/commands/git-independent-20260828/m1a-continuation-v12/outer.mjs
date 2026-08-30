import { mkdirSync, openSync, writeSync, closeSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const root=dirname(fileURLToPath(import.meta.url)), mode=process.argv[2], start=process.hrtime.bigint();
const elapsed=()=>Number(process.hrtime.bigint()-start)/1e6;
const directory=join(root,mode==='controls'?'CONTROL-01':'TARGET-01');
const descriptors=[]; let stdoutFd,stderrFd,eventFd,receiptFd,bytes=0,eventBytes=0,seal,status='HOLD',failure;
const known=new Set(),children=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const event=value=>{const text=JSON.stringify({...value,elapsedMs:elapsed()})+'\n';eventBytes+=Buffer.byteLength(text);assert.ok(eventBytes<=1048576);writeSync(eventFd,text);};
const checkFiles=rows=>{for(const row of rows)assert.equal(hash(readFileSync(join(root,row.path))),row.sha256,row.path);};
async function launch(spec) {
  const row={id:spec.id,args:spec.args,closed:false,signals:[],stdoutBytes:0,stderrBytes:0};children.push(row);
  event({kind:'before-spawn',id:spec.id,args:spec.args});
  const child=spawn(seal.node.path,spec.args,{cwd:root,env:{PATH:dirname(seal.node.path),HOME:root,UV_THREADPOOL_SIZE:'1',M1A_OUTER_START_NS:start.toString()},stdio:['ignore','pipe','pipe']});
  known.add(child);
  let closedResolve, timer, hardTimer, cleanupTimer, escalation, stdout='', stderr='', listenerFailure;
  const closed=new Promise(resolve=>{closedResolve=resolve;});
  const stop=reason=>{row.stopReason??=reason;if(!row.closed){row.signals.push({signal:'SIGTERM',accepted:child.kill('SIGTERM')});escalation??=setTimeout(()=>{if(!row.closed)row.signals.push({signal:'SIGKILL',accepted:child.kill('SIGKILL')});},1000);}};
  try {
    child.once('error',error=>{row.spawnError=String(error);stop('spawn');});
    child.once('exit',(code,signal)=>{row.exit={code,signal};});
    child.once('close',(code,signal)=>{row.closed=true;row.close={code,signal};closedResolve();});
    for(const [name,stream,fd] of [['stdout',child.stdout,stdoutFd],['stderr',child.stderr,stderrFd]]) {
      stream.once('close',()=>{row[name+'Closed']=true;});stream.on('error',error=>{row.captureError=String(error);stop('stream capture');});
      stream.on('data',chunk=>{try {bytes+=chunk.length;row[name+'Bytes']+=chunk.length;assert.ok(bytes<=4194304,'outer raw cap');for(let offset=0;offset<chunk.length;){const written=writeSync(fd,chunk,offset,chunk.length-offset);assert.ok(written>0,'raw write progress');offset+=written;}if(name==='stdout')stdout+=chunk.toString();else stderr+=chunk.toString();}catch(error){row.captureError=String(error);stop('raw capture');}});
    }
    row.enrollment='known.add immediately after spawn before listeners/helpers';row.pid=child.pid;
    event({kind:'enrolled',id:spec.id,pid:child.pid});
    const timeout=Math.min(spec.timeoutMs,(mode==='controls'?Number(BigInt(seal.preparationDeadlineNs)-process.hrtime.bigint())/1e6:6600000-elapsed())-12000);
    assert.ok(timeout>0,'owned cleanup reserve');
    timer=setTimeout(()=>stop('deadline'),timeout);
    await Promise.race([closed,new Promise(resolve=>{hardTimer=setTimeout(resolve,timeout+7000);})]);
    if(!row.closed)stop('unknown close after bounded wait');
  } catch(error) {listenerFailure=error;stop('listener/helper failure');}
  finally {
    clearTimeout(timer);clearTimeout(hardTimer);
    if(!row.closed){stop('owned finally');await Promise.race([closed,new Promise(resolve=>{cleanupTimer=setTimeout(resolve,5000);})]);}
    clearTimeout(cleanupTimer);clearTimeout(escalation);row.cleanupAttempted=true;row.cleanupSettled=row.closed&&row.stdoutClosed===true&&row.stderrClosed===true;event({kind:'child-terminal',...row});}
  assert.ok(!listenerFailure&&!row.spawnError&&!row.captureError&&!row.stopReason&&row.cleanupSettled,'owned capture/closure');
  assert.equal(row.exit.signal,null);
  return {row,stdout,stderr,accepted:row.exit.code===0};
}
try {
  assert.ok(mode==='controls'||mode==='target');
  mkdirSync(directory);
  for(const name of ['stdout.raw','stderr.raw','events.jsonl','receipt.json'])descriptors.push(openSync(join(directory,name),'wx'));
  [stdoutFd,stderrFd,eventFd,receiptFd]=descriptors;
  event({kind:'bootstrap-admitted',pid:process.pid,mode,paths:['stdout.raw','stderr.raw','events.jsonl','receipt.json'],beforeAnySealRead:true});
  seal=JSON.parse(readFileSync(join(root,mode==='controls'?'CONTROL-PRESEAL.json':'PRESEAL.json')));
  assert.equal(process.execPath,seal.node.path);assert.equal(hash(readFileSync(seal.node.path)),seal.node.sha256);assert.equal(process.version,seal.node.version);
  checkFiles(seal.files);
  event({kind:'conditional-admission',controlReceipt:mode==='target'?seal.controlReceiptSha256:null,node:seal.node.sha256});
  if(mode==='controls') {
    const data=await import('./controls-data.mjs');const results=await data.run(seal);event({kind:'data-controls',results});assert.ok(results.every(row=>row.pass));
    for(const spec of seal.controls) {
      const output=await launch(spec);
      assert.equal(output.row.exit.code,spec.exitCode);
      if(spec.stdout)assert.ok(output.stdout.includes(spec.stdout));if(spec.stderr)assert.ok(output.stderr.includes(spec.stderr));
      if(spec.id==='C04')assert.equal(output.accepted,false,'allPASS/nonzero must fail admission');
      event({kind:'control-pass',id:spec.id});
    }
    assert.ok(process.hrtime.bigint()<BigInt(seal.preparationDeadlineNs),'preparation deadline');status='PASS';
  } else {
    assert.equal(hash(readFileSync(join(root,'CONTROL-01/receipt.json'))),seal.controlReceiptSha256);
    assert.equal(JSON.parse(readFileSync(join(root,'CONTROL-01/receipt.json'))).status,'PASS');
    const output=await launch({id:'coordinator',args:[join(root,'run.mjs')],timeoutMs:6600000});
    const lines=output.stdout.trim().split('\n');const summary=JSON.parse(lines.at(-1));
    assert.ok(output.accepted&&summary.status==='SCOPED_PASS','target nonzero/HOLD/failure');status='SCOPED_PASS';
  }
} catch(error) {failure={message:error.message,stack:error.stack};if(eventFd!==undefined)try{event({kind:'outer-failure',failure});}catch{} }
finally {
  const receipt={status,mode,pid:process.pid,children,rawBytes:bytes,eventBytes,elapsedBeforeFinalPublicationMs:elapsed(),failure,finalWriteTailMeasured:false,unknownOwned:children.some(row=>!row.cleanupSettled)};
  if(receiptFd!==undefined)try{writeSync(receiptFd,JSON.stringify(receipt,null,2)+'\n');}catch(error){status='HOLD';}
  for(const fd of descriptors)try{closeSync(fd);}catch{status='HOLD';}
}
console.log(JSON.stringify({status,mode,children:children.length,elapsedMs:elapsed(),failure}));
process.exitCode=status==='PASS'||status==='SCOPED_PASS'?0:1;
