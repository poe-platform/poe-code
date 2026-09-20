import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { qualifyHostedObjectIoMatrix } from './object-io-hosted-matrix.mjs';

const bytes=Buffer.alloc(1048576,42);
const hash=createHash('sha256').update(bytes).digest('hex');

const conformance=[
  'object publication: immutable reads survive replacement',
  'object publication: exclusive create has exactly one winner',
  'object publication: stale updates cannot replace an acknowledged generation',
  'object publication: cancelled creation does not publish',
  'object publication: descriptor updates flush conditionally',
  'object staging: private pages have owned reads and truncation semantics',
  'object staging: cancelled writes preserve acknowledged pages',
  'object staging: writes larger than memory stay private until conditional sync',
];

function fixture(changeSummary = () => {}) {
  const calls=[];
  const request=async pathname => {
    calls.push(pathname);
    if (pathname==='/ready') return Response.json({ready:true});
    if (pathname==='/conformance') return Response.json(conformance);
    if (pathname==='/unhandled-errors') return Response.json([]);
    const parameters=new URL('https://synthetic.invalid'+pathname).searchParams;
    const callerBytes=Number(parameters.get('callerBytes'));
    const maxTransferBytes=Number(parameters.get('maxTransferBytes'));
    const chunkBytes=Number(parameters.get('chunkBytes'));
    const workingPages=Number(parameters.get('workingPages'));
    const configuration=Object.fromEntries(parameters.entries().map(([name,value]) => [name,Number(value)]));
    const writes=bytes.length/Math.min(callerBytes,maxTransferBytes);
    const phase=counts => ({elapsedMs:0,operations:Object.fromEntries(Object.entries(counts).map(([name,count]) =>
      [name,{count,failed:0,elapsedMs:0}]))});
    const summary={type:'summary',completed:true,canonicalBytes:bytes.length,exitCode:0,stderr:'',failures:[],
      ...configuration,denominator:{sequentialBytes:bytes.length,positionedWrites:12,positionedWriteBytes:12,positionedReadBytes:17},
      stdout:`${hash}\n${hash}\n`,unhandledWorkerErrors:[],independentReadback:{size:bytes.length},
      owner:'synthetic-owner',privatePagesAfterCleanup:0,fixtureObjectsAfterCleanup:0,
      maxResidentPageBytes:chunkBytes*workingPages,initialWasmMemoryBytes:31457280,finalWasmMemoryBytes:31457280,
      events:{acquired:2,released:2,created:2,closed:2,activeWrites:0,peakWrites:1,largestChunk:chunkBytes,
        publications:3,publishedBytes:2*bytes.length,stageReadBytes:bytes.length,stageWriteBytes:bytes.length},
      phases:{setup:phase({}),runtimeStartup:phase({}),pythonSetup:phase({}),
        sequentialWrite:phase({'syscall.write':writes,'backend.put':writes+1,
          ...(callerBytes<chunkBytes ? {'backend.get':writes} : {})}),
        sequentialPublication:phase({'syscall.close':1,'backend.put':1,'backend.get':1,'backend.list':1,'backend.delete':1}),
        pythonReadback:phase({'syscall.read':writes+1,'syscall.stat':2,'backend.get':writes}),
        positionedIO:phase({'syscall.write':12,'syscall.read':13,'backend.get':1,'backend.put':1}),
        positionedPublication:phase({'syscall.close':2,'syscall.read':4,'backend.put':1,'backend.get':1,'backend.list':1,'backend.delete':1}),
        positionedReadback:phase({'syscall.read':writes+1,'backend.get':writes}),
        pythonFinalization:phase({}),executorRetirement:phase({}),independentReadback:phase({'backend.get':1}),
        canonicalStream:phase({'stream.read':bytes.length/65536+1}),
        fixtureCleanup:phase({'backend.list':2,'backend.delete':3}),complete:phase({})}};
    changeSummary(summary);
    const chunks=[];
    for (let offset=0;offset<bytes.length;offset+=65536) chunks.push({type:'chunk',offset,
      base64:bytes.subarray(offset,offset+65536).toString('base64')});
    return new Response([...chunks,summary].map(record => JSON.stringify(record)).join('\n')+'\n',
      {headers:{'Content-Type':'application/x-ndjson'}});
  };
  return {calls,request,wait:async () => {},protocol:{size:bytes.length,owner:'synthetic-owner',
    expectedSequentialSha256:hash,expectedPositionedSha256:hash}};
}

test('hosted matrix measures all sixteen bounded profiles only after readiness and conformance', async () => {
  const inputs=fixture();
  const result=await qualifyHostedObjectIoMatrix(inputs);
  assert.equal(result.rows.length,16);
  assert.deepEqual(inputs.calls.slice(0,2),['/ready','/conformance']);
  assert.equal(inputs.calls.at(-1),'/unhandled-errors');
  assert.equal(result.rows.filter(row => row.delayMs===5).length,8);
  assert.equal(new Set(result.rows.map(row => `${row.delayMs}/${row.profile}/${row.workingPages}`)).size,16);
});

test('hosted matrix rejects substituted conformance cases before benchmarking', async () => {
  for (const cases of [Array.from({length:8},(_,index) => `case-${index}`),
    [...conformance.slice(0,7),'unrelated conformance'],[...conformance.slice(0,7),conformance[0]]]) {
    const inputs=fixture();
    const original=inputs.request;
    inputs.request=async pathname => pathname==='/conformance' ? Response.json(cases) : original(pathname);
    await assert.rejects(qualifyHostedObjectIoMatrix(inputs));
    assert.equal(inputs.calls.some(path => path.startsWith('/object-io-781')),false);
  }
});

for (const name of ['size','chunkBytes','workingPages','delayMs','callerBytes','maxTransferBytes']) {
  test(`hosted matrix rejects missing or substituted receipt ${name} rather than overwriting it`, async () => {
    for (const change of [summary => { delete summary[name]; },summary => { summary[name]++; }]) {
      const inputs=fixture(change);
      await assert.rejects(qualifyHostedObjectIoMatrix(inputs));
      assert.equal(inputs.calls.filter(path => path.startsWith('/object-io-781')).length,1);
    }
  });
}

test('hosted matrix rejects missing denominators, readback syscalls and transfer measurements', async context => {
  const changes=[summary => { delete summary.denominator; },
    summary => { summary.denominator.positionedReadBytes=13; },
    summary => { delete summary.phases.pythonReadback.operations['syscall.read']; },
    summary => { summary.phases.positionedReadback.operations['syscall.read'].count++; },
    summary => { summary.phases.positionedPublication.operations['syscall.read'].count=3; },
    summary => { summary.phases.pythonReadback.operations['syscall.stat'].count=1; },
    summary => { delete summary.events.stageWriteBytes; },
    summary => { summary.events.stageReadBytes=-1; },
    summary => { summary.events.publishedBytes=bytes.length; },
    summary => { summary.events.publications=2; },
    summary => { summary.events.largestChunk=summary.chunkBytes+1; },
    summary => { summary.maxResidentPageBytes++; }];
  for (const [index,change] of changes.entries()) {
    await context.test(`invalid measurement ${index}`,async () => {
      await assert.rejects(qualifyHostedObjectIoMatrix(fixture(change)));
    });
  }
});

test('hosted matrix rejects missing mismatch read/modify/write request measurements', async () => {
  await assert.rejects(qualifyHostedObjectIoMatrix(fixture(summary => {
    if (summary.callerBytes<summary.chunkBytes) delete summary.phases.sequentialWrite.operations['backend.get'];
  })));
});

test('hosted matrix retries readiness but never replays a failed benchmark', async () => {
  const inputs=fixture();
  const original=inputs.request;
  let attempts=0;
  inputs.request=async pathname => {
    if (pathname==='/ready' && attempts++<2) return new Response('not ready',{status:503});
    if (pathname.startsWith('/object-io-781')) {
      inputs.calls.push(pathname);throw new Error('synthetic benchmark transport failure');
    }
    return original(pathname);
  };
  await assert.rejects(qualifyHostedObjectIoMatrix(inputs),/benchmark transport failure/);
  assert.equal(attempts,3);
  assert.equal(inputs.calls.filter(path => path.startsWith('/object-io-781')).length,1);
});

test('hosted matrix rejects final runtime errors', async () => {
  const inputs=fixture();
  const original=inputs.request;
  inputs.request=async pathname => pathname==='/unhandled-errors'
    ? Response.json(['late runtime failure']) : original(pathname);
  await assert.rejects(qualifyHostedObjectIoMatrix(inputs));
});
