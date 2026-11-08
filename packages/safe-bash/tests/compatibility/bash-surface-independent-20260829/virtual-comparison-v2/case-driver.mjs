import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {runCase} from './case-adapter.mjs';
import {compareRaw,validateMatrix} from './data.mjs';
const role=JSON.parse(fs.readFileSync(process.env.SURFACE_ROLE));const matrix=JSON.parse(fs.readFileSync(role.matrix));validateMatrix(matrix);const row=matrix.cases.find(value=>value.id===role.caseId);if(!row)throw Error('CASE_MEMBERSHIP');
const api=role.layout==='source-built'?await import(pathToFileURL(role.productEntry)):await import('virtual-bash');
const controller=new AbortController();const timer=setTimeout(()=>controller.abort(Error('CASE_EXEC_DEADLINE')),3000);
let result;try{result=await runCase(api,row,matrix.fixtures,controller.signal);}finally{clearTimeout(timer);}
if(controller.signal.aborted)throw controller.signal.reason;
const clean={...result};delete clean.primary;delete clean.cleanupError;
if(result.hasPrimary&&result.primary instanceof Error&&/ADAPTER_CAPTURE|CAPTURE_RESULT|SNAPSHOT/.test(result.primary.message))throw result.primary;
if(result.hasCleanupError)throw Error('CASE_CLEANUP_REJECTED');
const output={caseId:row.id,layout:role.layout,observation:clean,rawComparison:compareRaw(row.nativeObservation,clean),interpretation:row.comparison.semanticTags,qualification:'Bash3.2 raw observation comparison; no automatic GNU5.3 parity or normalized pass'};
process.stdout.write(JSON.stringify(output)+'\n');
