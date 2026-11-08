import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { admitFile } from './admission.mjs';
import { runSelected } from '../r2/consumer.mjs';
import { runWorkflow } from '../../agent-bash-coherent-author-20260829/v4/workflows.mjs';
import { ids, beforeCase } from '../contract.mjs';
const config=JSON.parse(admitFile({path:process.argv[2],bytes:Number(process.argv[3]),sha256:process.argv[4]},1048576));
const binding=JSON.parse(admitFile(config.binding,1048576));
const fixture=JSON.parse(admitFile(config.neutralFixture,1048576));
const scalarAndPipelineRows=JSON.parse(admitFile(config.scalarRows,1048576));
const api=await import(pathToFileURL(binding.packageRoot+'/dist/index.js').href);
const nodeApi=await import(pathToFileURL(binding.packageRoot+'/dist/commands/node/index.js').href);
const observations=[];
let present=false,reason,result;
try{
  result=await runSelected({ids:[...ids],layout:config.layout,api,nodeApi,fixture,scalarAndPipelineRows,runWorkflow,beforeCase(index){beforeCase({selected:[...ids],layout:config.layout,index,now:Date.now(),activeEnd:config.activeEnd,workers:{guest:0,regex:0},captureRemaining:config.captureReserved,workRemaining:config.workReserved});},observe(){}},observations);
}catch(error){present=true;reason=error;}
const tag=value=>({type:value===null?'null':typeof value,...(['boolean','number','string'].includes(typeof value)?{value:typeof value==='string'?value.slice(0,256):value}:{})});
process.stdout.write(JSON.stringify({layout:config.layout,result,primaryPresent:present,...(present?{primary:tag(reason)}:{}),observations:observations.map(row=>({id:row.id,primaryPresent:row.primaryPresent,primary:tag(row.primary),cleanupPresent:row.cleanupPresent,cleanup:tag(row.cleanup),reportingPresent:row.reportingPresent,reporting:tag(row.reporting)}))})+'\n');
if(present)process.exitCode=1;
assert.equal(config.guestWorkers,0);
