import test from 'node:test';
import assert from 'node:assert/strict';
import {createRunQueue,runDocumentWorkflow} from '../dist/index.js';
test('queued validations retain submission order and snapshots stay frozen',async()=>{
 const queue=createRunQueue({plans:[],afterEachPlan:[' Review '],cwd:'/work'});
 const one=Promise.withResolvers(),two=Promise.withResolvers(),seen=[];
 const a=queue.enqueueValidatedPlan('one.md',()=>one.promise),b=queue.enqueueValidatedPlan('two.md',()=>two.promise);
 const run=queue.run({async execute(item){seen.push(item.kind==='plan'?item.path:item.text);return 'completed';}});
 two.resolve('two.md');await Promise.resolve();one.resolve('one.md');await Promise.all([a,b]);
 const snapshot=await run;assert.equal(snapshot.status,'completed');assert.deepEqual(seen,['one.md','Review','two.md','Review']);
 assert.ok(Object.isFrozen(snapshot));assert.ok(Object.isFrozen(snapshot.items));assert.ok(snapshot.items.every(Object.isFrozen));
});
test('workflow callbacks run without live model calls',async()=>{
 const runs=[];
 await runDocumentWorkflow({cwd:'/work',homeDir:'/home',docPath:'/plan.md',fs:{readFile:async()=>''},readConfig:()=>({frontmatter:{participants:{default:'codex'},stages:[{id:'build',participant:'default',prompt:'Build'}],max_iterations:2},body:''}),runAgent:async(input)=>{runs.push(input.prompt);}});
 assert.deepEqual(runs,['Build','Build']);
});
test('snapshots retain immutable item identities and callbacks observe every published mutation',async()=>{
 const queue=createRunQueue({plans:['one.md','two.md'],cwd:'/work'}),first=queue.getSnapshot(),observed=[];
 const off=queue.onChange(snapshot=>observed.push(snapshot));
 const one=first.items[0];queue.enqueueMessage('Review',one.id);
 const second=queue.getSnapshot();assert.notEqual(first,second);assert.equal(second.items[0],one);assert.equal(first.items.length,2);
 const active=[];const done=await queue.run({async execute(item){assert.ok(Object.isFrozen(item));assert.equal(queue.getSnapshot().items.find(row=>row.id===item.id),item);active.push(item.id);return 'completed';}});
 assert.deepEqual(active,['plan-1','message-3','plan-2']);assert.equal(done,queue.getSnapshot());
 assert.equal(observed.at(-1),done);assert.ok(observed.every(Object.isFrozen));off();
});
