import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {PROFILE} from './profile.mjs';
import {runCase} from './case-adapter.mjs';
import {runHelperControls} from './helper-driver.mjs';
const role=JSON.parse(fs.readFileSync(process.env.SURFACE_ROLE));
const data=JSON.parse(fs.readFileSync(role.cases));
if(role.caseId==='HELPERS'){
 const result=await runHelperControls(role,data);if(!result.helperSettlement.ownedClosed)throw Error('HELPER_OWNED_CLEANUP');
 process.stdout.write(JSON.stringify({profile:PROFILE,caseId:role.caseId,layout:role.layout,...result})+'\n');
}else{
 const test=data.rows.find(row=>row.id===role.caseId);if(!test)throw Error('CASE_ID');
 const api=role.layout==='source-built'?await import(pathToFileURL(role.productEntry)):await import('virtual-bash');
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(Error('K08_CASE_DEADLINE')),25000);
 let result;try{result=await runCase(api,{program:test.program,stdinBase64:'',limits:test.limits,virtualInvocation:{cwd:'/case/work',environment:{LC_ALL:'C',LANG:'C',TZ:'UTC',HOME:'/case/home',TMPDIR:'/case/tmp',PATH:'/case/empty-path'}}},data.fixtures,controller.signal);}finally{clearTimeout(timer);}
 if(controller.signal.aborted)throw controller.signal.reason;
 if(result.hasCleanupError||!result.publicSettlement.disposeSettled)throw Error('KNOWN_CLEANUP_FAILURE');
 if(result.hasPrimary&&result.primary instanceof Error&&/ADAPTER_CAPTURE|CAPTURE_RESULT|SNAPSHOT/.test(result.primary.message))throw result.primary;
 const failures=[];const stdout=Buffer.from(result.stdout.base64,'base64').toString(),stderr=Buffer.from(result.stderr.base64,'base64').toString();
 if(test.expectedRejection){if(!result.hasPrimary||result.primary?.name!==test.expectedRejection.name||result.primary?.limit!==test.expectedRejection.limit)failures.push('rejection-identity-fields');}
 else if(result.kind!=='resolved'||result.status!==(test.status??0))failures.push('status');
 if(stdout!==test.stdout)failures.push('stdout');
 if(test.stderrContains!==undefined?!stderr.includes(test.stderrContains):stderr!==(test.stderr??''))failures.push('stderr');
 if(JSON.stringify(result.filesBefore)!==JSON.stringify(result.filesAfter))failures.push('file-effects');
 const clean={...result};delete clean.primary;delete clean.cleanupError;
 process.stdout.write(JSON.stringify({profile:PROFILE,caseId:test.id,layout:role.layout,pass:failures.length===0,failures,publicSettlement:result.publicSettlement,observation:clean,reasonFields:result.hasPrimary?{name:result.primary?.name,limit:result.primary?.limit}:undefined})+'\n');
}
