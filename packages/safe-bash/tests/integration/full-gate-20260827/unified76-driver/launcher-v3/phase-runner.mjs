import assert from 'node:assert/strict';
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {node24,save} from './common.mjs';
import {BOUNDS,enforceCharge} from './policy.mjs';
import {supervise} from './supervise.mjs';
import {accountFile} from './tap.mjs';
import {readBuildAudit} from './build-types.mjs';

export function createPhaseRunner({completed,report,source,output,environment,guard,verify,extraGuards=[],requireOrdered,audit,supervision=supervise}){
  let totalOutput=0;
  const verifyAll=async()=>{await verify();for(const entry of extraGuards)assert.deepEqual((await entry.check()).changes,[]);readBuildAudit(audit);};
  return async function phase(label,args,cwd=source,expectedStatus=0,timeoutMs=BOUNDS.phaseTimeoutMs){
    requireOrdered(completed,label);await verifyAll();
    const env={...environment,...audit.environment,FULL_GATE_IMPORTS:join(output,'imports',label),
      ...label==='public-runtime'?{}:{NODE_OPTIONS:`--import=${pathToFileURL(guard).href} --import=${pathToFileURL(audit.preload).href}`}};
    const result=await supervision(node24,args,{cwd,env,timeoutMs:Math.min(timeoutMs,BOUNDS.phaseTimeoutMs),maxOutputBytes:Math.min(BOUNDS.phaseOutputBytes,BOUNDS.allPhaseOutputBytes-totalOutput),stdout:join(output,label+'.stdout'),stderr:join(output,label+'.stderr'),observeSockets:true});
    const row={...result,label,expectedStatus,args,cwd,loaderPolicy:label==='public-runtime'?'permission confines all module reads to authenticated moved package and consumer; outer preload intentionally unavailable under that fence':'outer authenticated source guard and production-build invocation audit; child harnesses with explicit environments retain their separately declared fences'};
    report.phases.push(row);completed.push(label);totalOutput=enforceCharge(totalOutput,result.outputBytes,BOUNDS.allPhaseOutputBytes);
    if(label==='canonical')row.accounting=await accountFile(join(output,label+'.stdout'));
    assert.ok(result.clean&&result.closed&&!result.signals.length&&!result.survivors.length,'phase requires natural complete cleanup');
    row.observedNodeExecutables=result.observed.filter(entry=>/^(?:\S+\/)?node(?:\s|$)/u.test(entry.command)).map(entry=>entry.command.split(/\s+/u)[0]);
    assert.ok(row.observedNodeExecutables.every(path=>!path.startsWith('/')||realpathSync(path)===realpathSync(node24)),'mixed observed Node runtime');
    await verifyAll();save(join(output,label+'.json'),row);return row;
  };
}
