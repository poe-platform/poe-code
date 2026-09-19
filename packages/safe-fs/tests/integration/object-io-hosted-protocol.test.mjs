import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { admitHostedObjectIoCleanup, consumeObjectIoResponse } from './object-io-hosted-protocol.mjs';

const bytes = Buffer.from([0, 255, 42]);
const hash = createHash('sha256').update(bytes).digest('hex');

function records() {
  return [
    {type:'chunk',offset:0,base64:bytes.toString('base64')},
    {type:'summary',completed:true,canonicalBytes:bytes.length,exitCode:0,stderr:'',failures:[],
      stdout:`${hash}\n${hash}\n`,unhandledWorkerErrors:[],independentReadback:{size:bytes.length},
      privatePagesAfterCleanup:0,fixtureObjectsAfterCleanup:0,
      events:{acquired:2,released:2,created:1,closed:1,activeWrites:0,peakWrites:1,largestChunk:3},
      phases:{canonicalStream:{operations:{'stream.read':{count:2}}},fixtureCleanup:{operations:{}}}},
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
