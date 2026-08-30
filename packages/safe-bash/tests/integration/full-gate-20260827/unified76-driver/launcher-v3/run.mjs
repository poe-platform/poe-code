import {parseArgs,BOUNDS,PHASES,gateVerdict} from './policy.mjs';

export async function main(args){
  const options=parseArgs(args);
  if(!options.execute){const{execute}=await import('./execute.mjs');return execute(options);}
  const{verifyExternal}=await import('./external-admission.mjs');await verifyExternal();
  const{readProfile}=await import('./profile.mjs');const{verifyDriverSeal,requireRelease}=await import('./admission.mjs');
  const{readFileSync,mkdtempSync,writeFileSync,existsSync}=await import('node:fs');const{join}=await import('node:path');const{tmpdir}=await import('node:os');
  const{directory,node24,sha}=await import('./common.mjs');const seal=verifyDriverSeal();requireRelease(JSON.parse(readFileSync(options.release)),seal,readProfile());
  if(existsSync(options.output))throw Object.assign(new Error('Output already exists'),{exitCode:78});
  const outer=mkdtempSync(join(tmpdir(),'unified76-supervisor-'));
  const{superviseFencedWorker}=await import('./fenced-supervisor.mjs');
  const fence=await superviseFencedWorker({output:options.output,outer,script:join(directory,'worker.mjs'),args:[JSON.stringify(options)],cwd:directory,environment:process.env,phases:PHASES.slice(0,-1).map(([label])=>label),limits:{observeSockets:true,setupSentinel:join(options.output,'SETUP-COMPLETE.json'),setupTimeoutMs:BOUNDS.setupTimeoutMs,timeoutMs:BOUNDS.setupTimeoutMs+PHASES.length*BOUNDS.phaseTimeoutMs+BOUNDS.cleanupTimeoutMs,maxOutputBytes:BOUNDS.phaseOutputBytes}});
  const result=fence.result;
  let innerVerdict;try{const inner=JSON.parse(readFileSync(join(options.output,'REPORT.json')));innerVerdict=gateVerdict(inner);if(inner.driverSha256!==sha(JSON.stringify(seal))||JSON.stringify(inner.verdict)!==JSON.stringify(innerVerdict))innerVerdict={exitCode:1,problems:['inner driver binding or verdict failed']};}catch(error){innerVerdict={exitCode:1,problems:['missing or invalid inner report: '+error.message]};}
  const complete=fence.clean&&result.status===1&&result.clean&&result.closed&&!result.signals.length&&!result.survivors.length&&innerVerdict.status==='QUALIFIED_DIAGNOSTIC_UNQUALIFIED_NATIVE';
  const receipt={candidate:options.candidate,driverSha256:sha(JSON.stringify(seal)),outer,result,fence,innerVerdict,status:complete?'QUALIFIED_DIAGNOSTIC_UNQUALIFIED_NATIVE':'HOLD_OR_QUALIFIED_RED',qualification:'Historical native obligations force nonzero even with complete runtime evidence. Outer deadlines, OS fence, descendant cleanup and exact inner verdict remain mandatory; no successful TAP footer overrides them.'};
  writeFileSync(join(outer,'REPORT.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({outer,status:receipt.status,candidate:options.candidate}));
  return result.status===78?78:1;
}

if(import.meta.main){
  try{process.exitCode=await main(process.argv.slice(2));}
  catch(error){console.error(error.stack);process.exitCode=error.exitCode??78;}
}
