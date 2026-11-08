import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PRODUCT} from './policy.mjs';
import {ORIGINAL_BUILD,REUSED_BUILD,renderBuiltConsumerRunner} from './built-consumers.mjs';

const original=execFileSync('git',['show',PRODUCT+':scripts/verify-current-consumers.mjs']).toString();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const rows=[];const test=(name,operation)=>{try{operation();rows.push({name,status:'PASS'});}catch(error){rows.push({name,status:'FAIL',error:error.stack});}};
const rendered=renderBuiltConsumerRunner(original,sha(original),'/tmp/selected immutable candidate');
test('exact selected runner transforms only build seam and five imports',()=>{let restored=rendered.source;for(const row of rendered.imports)restored=restored.replace(row.after,'from '+JSON.stringify(row.specifier)+';');assert.equal(restored.replace(REUSED_BUILD,ORIGINAL_BUILD),original);});
test('wrong original source bytes rejected',()=>assert.throws(()=>renderBuiltConsumerRunner(original+'\n',sha(original),'/tmp/source')));
test('already modified seam rejected',()=>assert.throws(()=>renderBuiltConsumerRunner(rendered.source,sha(rendered.source),'/tmp/source')));
test('unexpected import change rejected',()=>{const changed=original.replace('../tests/plugins/qualified-current-release/consumers.mjs','../other.mjs');assert.throws(()=>renderBuiltConsumerRunner(changed,sha(changed),'/tmp/source'));});
const emitted=[{path:'dist/index.js',sha256:'sealed-js'},{path:'dist/index.d.ts',sha256:'sealed-types'}];
const report=()=>({sourceCommit:PRODUCT,root:'/selected',approvedBuild:{candidate:PRODUCT,productionBuilds:1,buildStatus:0,files:structuredClone(emitted)}});
const run=new Function('assert','manifest','report',REUSED_BUILD);
test('one authenticated emitted package reused without invoking build',()=>{const value=report();run(assert,()=>structuredClone(emitted),value);assert.equal(value.productionBuildsInThisPhase,0);});
for(const[name,change]of [
  ['different candidate',value=>value.approvedBuild.candidate='0'.repeat(40)],
  ['zero build',value=>value.approvedBuild.productionBuilds=0],
  ['second build',value=>value.approvedBuild.productionBuilds=2],
  ['failed build',value=>value.approvedBuild.buildStatus=2],
  ['changed emitted bytes',value=>value.approvedBuild.files[0].sha256='other'],
  ['missing emitted declaration',value=>value.approvedBuild.files.pop()],
])test(name+' cannot reuse stale or mixed output',()=>{const value=report();change(value);assert.throws(()=>run(assert,()=>structuredClone(emitted),value));});
test('runtime count/fallback/permission assertions byte-preserved',()=>{for(const literal of ['counts.pass, counts.tests','counts[name], 0','counts.tests, 13','counts.tests, group.nodeTests','ERR_ACCESS_DENIED','exact negative diagnostics differ; no generic nonzero acceptance'])assert.equal(rendered.source.split(literal).length,original.split(literal).length);});
const output=mkdtempSync(join(tmpdir(),'unified76-built-consumer-v3-'));const result={capturedAt:new Date().toISOString(),candidate:PRODUCT,originalSha256:sha(original),renderedSha256:rendered.executedSha256,sourceSha256:sha(readFileSync(new URL('./built-consumers.mjs',import.meta.url))),scope:'Exact external harness transformation and seam controls only; current consumer runtime groups not executed',rows,pass:rows.filter(row=>row.status==='PASS').length,fail:rows.filter(row=>row.status==='FAIL').length,fullGateLaunched:false};writeFileSync(join(output,'REPORT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,pass:result.pass,fail:result.fail,fullGateLaunched:false}));if(result.fail)process.exitCode=1;
