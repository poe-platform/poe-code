import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {PROFILE} from './profile.mjs';
import {runCase} from './case-adapter.mjs';
const role=JSON.parse(fs.readFileSync(process.env.SURFACE_ROLE));
const data=JSON.parse(fs.readFileSync(role.cases));
const test=data.rows.find(row=>row.id===role.caseId);
if(!test)throw Error('CASE_ID');
const api=role.layout==='source-built'?await import(pathToFileURL(role.productEntry)):await import('virtual-bash');
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(Error('B35_CASE_DEADLINE')),25000);
const observations=[];
try {
  for(const program of [test.program,...(test.legacy===null?[]:[test.legacy])]){
    const row={program,stdinBase64:'',virtualInvocation:{cwd:'/case/work',environment:{LC_ALL:'C',LANG:'C',TZ:'UTC',HOME:'/case/home',TMPDIR:'/case/tmp',PATH:'/case/empty-path'}}};
    const result=await runCase(api,row,data.fixtures,controller.signal);
    const clean={...result};delete clean.primary;delete clean.cleanupError;
    observations.push(clean);
    if(result.hasCleanupError||!result.publicSettlement.disposeSettled)throw Error('KNOWN_CLEANUP_FAILURE');
    if(result.hasPrimary&&result.primary instanceof Error&&/ADAPTER_CAPTURE|CAPTURE_RESULT|SNAPSHOT/.test(result.primary.message))throw result.primary;
  }
}finally{clearTimeout(timer);}
if(controller.signal.aborted)throw controller.signal.reason;
const actual=observations[0];const failures=[];
if(actual.kind!=='resolved'||actual.status!==test.expected.status)failures.push('status');
if(actual.stdout.base64!==test.expected.stdoutBase64)failures.push('stdout');
if(test.expected.stderr==='empty'?actual.stderr.bytes!==0:actual.stderr.bytes===0)failures.push('stderr-class');
const expectedFiles=actual.filesBefore.filter(row=>row.type==='file');
if(test.expected.outputFile)expectedFiles.push({...test.expected.outputFile,type:'file'});
const actualFiles=actual.filesAfter.filter(row=>row.type==='file');
if(actualFiles.length!==expectedFiles.length||expectedFiles.some(expected=>!actualFiles.some(row=>row.path===expected.path&&row.base64===expected.base64)))failures.push('file-effects');
if(observations[1])for(const field of ['kind','status','stdout','stderr','filesBefore','filesAfter'])if(JSON.stringify(actual[field])!==JSON.stringify(observations[1][field]))failures.push('metamorphic-'+field);
process.stdout.write(JSON.stringify({profile:PROFILE,caseId:test.id,layout:role.layout,publicSettlement:actual.publicSettlement,observations,failures,pass:failures.length===0})+'\n');
