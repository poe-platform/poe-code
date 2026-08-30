import fs from 'node:fs';import assert from 'node:assert/strict';
import * as api from 'virtual-bash';import * as nodeApi from 'virtual-bash/commands/node';
import {runWorkflow,engineFreeIds} from './workflows.mjs';
const request=JSON.parse(fs.readFileSync(process.env.B0_REQUEST,'utf8'));
assert.equal(request.action,'B0_ENGINE_FREE_13');assert.deepEqual(request.ids,engineFreeIds);
assert.equal(request.sourceTree,'3adc676a0ab638c9788ef007e465931d65d2c6fe');
assert.equal(typeof Object.getOwnPropertyDescriptor(api.Shell.prototype,'exec').value,'function');
assert.equal(typeof Object.getOwnPropertyDescriptor(api.Shell.prototype,'dispose').value,'function');
const fixture=JSON.parse(fs.readFileSync(new URL('./fixture.json',import.meta.url),'utf8'));
const rows=[];
for(const id of engineFreeIds){const timer=setTimeout(()=>{console.error('B0_CASE_DEADLINE',id);process.exit(78);},30000);try{rows.push(await runWorkflow(id,{api,nodeApi,fixture}));}catch(error){rows.push({id,status:'FAIL',error:String(error?.stack??error),facts:error?.facts});if(error?.facts?.cleanupFailure){console.log(JSON.stringify({layout:request.layout,rows,STOP:'cleanupFailure'}));process.exit(78);}}finally{clearTimeout(timer);}}
assert.equal(rows.length,13);assert.equal(new Set(rows.map(row=>row.id)).size,13);
console.log(JSON.stringify({schema:'coherent-b0-result-v1',layout:request.layout,rows,passed:rows.filter(row=>row.status==='PASS').length,failed:rows.filter(row=>row.status!=='PASS').length,guestEngineCalls:0}));
