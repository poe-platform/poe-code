import test from 'node:test';import assert from 'node:assert/strict';
import {createFsFromVolume,Volume} from 'memfs';
import {parsePlanReadiness,discoverPlans,archivePlan,openPlanList,comparePlanReadiness,formatPlanReadinessLabel,formatRunQueueSummary} from '../dist/index.js';
test('readiness diagnostics preserve JSON hooks and their thrown identities',()=>{
 for(const value of [null,false,1,[],{},Symbol('x')])assert.throws(()=>parsePlanReadiness(value),{message:`Invalid plan readiness ${JSON.stringify(value)}; expected "draft" or "ready".`});
 assert.equal(parsePlanReadiness(undefined),'draft');assert.equal(parsePlanReadiness('ready'),'ready');
 const error={sentinel:true};assert.throws(()=>parsePlanReadiness({toJSON(){throw error;}}),e=>e===error);
 assert.throws(()=>parsePlanReadiness(1n),TypeError);
 const reads=[];assert.equal(comparePlanReadiness({get readiness(){reads.push('left');return 'ready';}},{get readiness(){reads.push('right');return 'draft';}}),-1);assert.deepEqual(reads,['right','left']);
 assert.equal(formatPlanReadinessLabel('\ud800','ready'),'\ud800 ✓');
 assert.equal(formatRunQueueSummary({items:[]}), '0/0 plans');
});
test('plan archive commits metadata through the embedded owned task list and leaves other files',async()=>{
 const volume=Volume.fromJSON({'/repo/plans/01-work.md':'---\nname: Work\nreadiness: ready\nkind: pipeline\nstate: draft\nnotes: "keep me"\n---\nBody\n','/repo/plans/02-other.md':'Other body\n'}),fs=createFsFromVolume(volume).promises;
 const options={cwd:'/repo',homeDir:'/home',planDirectory:'plans',fs};
 const plans=await discoverPlans(options);assert.equal(plans[0].id,'work');assert.equal(plans[0].displayPath,'plans/01-work.md');
 const taskList=await openPlanList(options);assert.deepEqual(await taskList.lists(),['plans']);
 const archived=await archivePlan({...options,id:'work',metadataPatch:{finalization:'completed'}});assert.equal(archived,'/repo/plans/archive/work.md');
 const text=await fs.readFile(archived,'utf8');assert.ok(text.includes('finalization: completed'));assert.ok(text.includes('notes: keep me'));assert.ok(text.includes('Body'));
 assert.equal(await fs.readFile('/repo/plans/02-other.md','utf8'),'Other body\n');assert.deepEqual((await discoverPlans(options)).map(row=>row.id),['other']);
});
