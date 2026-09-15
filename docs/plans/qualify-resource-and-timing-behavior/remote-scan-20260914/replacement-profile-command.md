# Reproduce replacement accounting/profile evidence

Use an independent checkout with `npm ci`. Before source is `cc646c0e2`;
after sequence repair is `f2cb67084` (final runtime also contains the repair).
Run sequentially without other task-owned performance measurements. The
original fixture remains byte-identical; all six budget/deadline settings are
unchanged. Set `phase` to describe the checkout. Retained original before runs
stop at work rejection; corrected after runs compare the original value fields.
Host prototype equality is outside the original Vitest assertions; structured
clone normalizes transport prototypes while preserving undefined values/slots.

```sh
node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Session} from 'node:inspector/promises';
import {loadavg} from 'node:os';
import {run} from './packages/safe-js/src/run.ts';
import {Budget} from './packages/safe-js/src/interp/budget.ts';
const phase='after';
const directory='docs/plans/qualify-resource-and-timing-behavior/remote-scan-20260914';
const fixture=readFileSync('packages/safe-js/src/interp/methods/string-replacement-validation.test.ts','utf8');
const expression=fixture.split('const originalWorkflow = ',2)[1].split('\n\nconst workflowAnchors',1)[0];
const source=Function('return '+expression)();
const native=Function(source)();
const session=new Session();session.connect();
await session.post('Profiler.enable');await session.post('Profiler.start');
const records=[];
for(let sample=1;sample<=3;sample++){
 const budget=new Budget({maxSteps:10000,maxCallDepth:48,deadline:Date.now()+1000,stringLength:32768,arrayLength:4096,dataSize:2097152});
 const start=performance.now();const cpu=process.cpuUsage();const load=loadavg();let result,error;
 try{
  result=await run(source,{modules:{},budget});assert.equal(result.ok,true);
  for(let i=0;i<native.length;i++){
   for(const field of Object.keys(native[i])) if(field!=='tokens') assert.deepEqual(structuredClone(result.returnValue[i][field]),structuredClone(native[i][field]));
   assert.equal(result.returnValue[i].tokens.length,native[i].tokens.length);
   for(let j=0;j<native[i].tokens.length;j++) for(const field of ['name','fallback','raw']) assert.deepEqual(result.returnValue[i].tokens[j][field],native[i].tokens[j][field]);
  }
 }catch(e){error={name:e.name,code:e.code,budget:e.budget,current:e.current,limit:e.limit,message:e.message};}
 const usage=process.cpuUsage(cpu);
 records.push({sample,elapsed:performance.now()-start,cpuMs:(usage.user+usage.system)/1000,load,ok:result?.ok,error,steps:budget.stepsUsed});
}
const {profile}=await session.post('Profiler.stop');session.disconnect();
writeFileSync(`${directory}/replacement-reproduced-${phase}.cpuprofile`,JSON.stringify(profile));
writeFileSync(`${directory}/replacement-reproduced-${phase}.json`,JSON.stringify({versions:process.versions,sourceSha256:createHash('sha256').update(source).digest('hex'),records},null,2)+'\n');
JS
```
