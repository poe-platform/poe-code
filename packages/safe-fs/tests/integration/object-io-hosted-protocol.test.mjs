import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { admitHostedObjectIoCleanup, consumeObjectIoResponse } from './object-io-hosted-protocol.mjs';

const bytes = Buffer.from([0, 255, 42]);
const hash = createHash('sha256').update(bytes).digest('hex');

function records() {
  const phase=counts => ({elapsedMs:0,operations:Object.fromEntries(Object.entries(counts).map(([name,count]) =>
    [name,{count,failed:0,elapsedMs:0}]))});
  return [
    {type:'chunk',offset:0,base64:bytes.toString('base64')},
    {type:'summary',completed:true,canonicalBytes:bytes.length,exitCode:0,stderr:'',failures:[],
      stdout:`${hash}\n${hash}\n`,unhandledWorkerErrors:[],independentReadback:{size:bytes.length},
      privatePagesAfterCleanup:0,fixtureObjectsAfterCleanup:0,
      events:{acquired:2,released:2,created:1,closed:1,activeWrites:0,peakWrites:1,largestChunk:3},
      phases:{setup:phase({}),runtimeStartup:phase({}),pythonSetup:phase({}),
        sequentialWrite:phase({'syscall.write':1,'backend.put':1}),
        sequentialPublication:phase({'syscall.close':1,'backend.put':1,'backend.get':1,'backend.list':1,'backend.delete':1}),
        pythonReadback:phase({'syscall.read':2,'backend.get':1,'syscall.stat':2}),
        positionedIO:phase({'syscall.write':12,'syscall.read':13,'backend.put':1,'backend.get':1}),
        positionedPublication:phase({'syscall.close':2,'syscall.read':4,'backend.put':1,'backend.get':1,'backend.list':1,'backend.delete':1}),
        positionedReadback:phase({'syscall.read':2,'backend.get':1}),
        pythonFinalization:phase({}),executorRetirement:phase({}),independentReadback:phase({'backend.get':1}),
        canonicalStream:phase({'stream.read':2}),fixtureCleanup:phase({'backend.list':2,'backend.delete':3}),complete:phase({})}},
  ];
}

function inputs(values = records()) {
  const text = values.map(value => JSON.stringify(value)).join('\n')+'\n';
  const encoded = new TextEncoder().encode(text);
  const response = new Response(new ReadableStream({start(controller) {
    for (let offset=0;offset<encoded.length;offset+=7) controller.enqueue(encoded.slice(offset,offset+7));
    controller.close();
  }}),{headers:{'Content-Type':'application/x-ndjson'}});
  return {response,expectedBytes:bytes.length,sequentialSha256:hash,positionedSha256:hash};
}

test('hosted protocol hashes bounded canonical chunks and admits only a post-drain final summary', async () => {
  const row = await consumeObjectIoResponse(inputs());
  assert.equal(row.canonicalHash,hash);
  assert.equal(row.canonicalBytes,bytes.length);
});

test('hosted protocol admits short BYOB reads by counting actual canonical records plus EOF', async () => {
  const summary=records()[1];
  summary.phases.canonicalStream.operations['stream.read'].count=3;
  const values=[
    {type:'chunk',offset:0,base64:bytes.subarray(0,1).toString('base64')},
    {type:'chunk',offset:1,base64:bytes.subarray(1).toString('base64')},
    summary,
  ];
  assert.equal((await consumeObjectIoResponse(inputs(values))).canonicalHash,hash);
  summary.phases.canonicalStream.operations['stream.read'].count=4;
  await assert.rejects(consumeObjectIoResponse(inputs(values)));
});

test('hosted protocol rejects missing or non-final summaries and noncontiguous bytes', async () => {
  for (const values of [records().slice(0,1),[...records(),records()[0]],
    [{...records()[0],offset:1},records()[1]], [{...records()[0],base64:'AP8qAA=='},records()[1]]]) {
    await assert.rejects(consumeObjectIoResponse(inputs(values)));
  }
});

test('hosted protocol fails closed for wrong canonical hashes or Python/cleanup/runtime evidence', async () => {
  for (const change of [{completed:false},{exitCode:1},{stderr:'failure'},{failures:['failure']},
    {unhandledWorkerErrors:['late failure']},{canonicalBytes:2},{independentReadback:{size:2}},
    {privatePagesAfterCleanup:1},{fixtureObjectsAfterCleanup:1},
    {stdout:'wrong\n'},{events:{...records()[1].events,released:1}},
    {phases:{canonicalStream:{operations:{'stream.read':{count:1}}}}}]) {
    await assert.rejects(consumeObjectIoResponse(inputs([records()[0],{...records()[1],...change}])));
  }
  await assert.rejects(consumeObjectIoResponse({...inputs(),positionedSha256:'0'.repeat(64)}));
});

test('hosted protocol rejects oversized records and truncated final lines', async () => {
  const options = inputs();
  await assert.rejects(consumeObjectIoResponse({...options,response:new Response('x'.repeat(131073),
    {headers:{'Content-Type':'application/x-ndjson'}})}));
  const text = records().map(value => JSON.stringify(value)).join('\n');
  await assert.rejects(consumeObjectIoResponse({...inputs(),response:new Response(text,
    {headers:{'Content-Type':'application/x-ndjson'}})}));
});

test('hosted cleanup requires owner-bound bounded empty-bucket evidence', () => {
  const receipt={owner:'synthetic-owner',remainingObjects:0,truncated:false,listedPages:1,removedObjects:0};
  assert.equal(admitHostedObjectIoCleanup(receipt,'synthetic-owner').empty,true);
  for (const changes of [{owner:'replacement-owner'},{remainingObjects:1},{truncated:true},
    {listedPages:33},{listedPages:0},{removedObjects:-1},{removedObjects:3201}]) {
    assert.throws(() => admitHostedObjectIoCleanup({...receipt,...changes},'synthetic-owner'));
  }
});

for (const [name,phase] of Object.entries(records()[1].phases)) {
  test(`hosted protocol requires ${name} phase and its measured operations`, async context => {
    await context.test('missing phase',async () => {
      const values=records();
      delete values[1].phases[name];
      await assert.rejects(consumeObjectIoResponse(inputs(values)));
    });
    for (const operation of Object.keys(phase.operations)) {
      await context.test(`missing ${operation}`,async () => {
        const values=records();
        delete values[1].phases[name].operations[operation];
        await assert.rejects(consumeObjectIoResponse(inputs(values)));
      });
    }
  });
}

test('hosted protocol rejects invalid phase and request metrics, including failed cleanup', async context => {
  const changes=[summary => { summary.phases.positionedIO.elapsedMs=-1; },
    summary => { delete summary.phases.pythonReadback.elapsedMs; },
    summary => { summary.phases.complete.elapsedMs='0'; },
    summary => { summary.phases.setup.operations=[]; },
    ...['count','failed','elapsedMs'].flatMap(name => [
      summary => { delete summary.phases.sequentialWrite.operations['backend.put'][name]; },
      summary => { summary.phases.sequentialWrite.operations['backend.put'][name]=-1; },
      summary => { summary.phases.sequentialWrite.operations['backend.put'][name]='1'; },
    ]),
    summary => { summary.phases.sequentialWrite.operations['backend.put'].count=0.5; },
    summary => { summary.phases.sequentialWrite.operations['backend.put'].count=0; },
    summary => { summary.phases.fixtureCleanup.operations['backend.delete'].failed=1; },
    summary => { summary.phases.positionedReadback.operations['backend.get'].failed=2; }];
  for (const [index,change] of changes.entries()) {
    await context.test(`invalid metric ${index}`,async () => {
      const values=records();
      change(values[1]);
      await assert.rejects(consumeObjectIoResponse(inputs(values)));
    });
  }
});

test('hosted protocol rejects absent or invalid balanced lifecycle counters', async () => {
  for (const names of [['acquired','released'],['created','closed']]) {
    for (const value of [undefined,-1,0,0.5,'2']) {
      const values=records();
      for (const name of names) values[1].events[name]=value;
      await assert.rejects(consumeObjectIoResponse(inputs(values)));
    }
  }
});
