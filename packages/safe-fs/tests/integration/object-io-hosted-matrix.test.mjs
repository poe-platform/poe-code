import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { qualifyHostedObjectIoMatrix } from './object-io-hosted-matrix.mjs';

const bytes=Buffer.from([0,255,42]);
const hash=createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const calls=[];
  const request=async pathname => {
    calls.push(pathname);
    if (pathname==='/ready') return Response.json({ready:true});
    if (pathname==='/conformance') return Response.json(Array.from({length:8},(_,index) => `case-${index}`));
    if (pathname==='/unhandled-errors') return Response.json([]);
    const parameters=new URL('https://synthetic.invalid'+pathname).searchParams;
    const callerBytes=Number(parameters.get('callerBytes'));
    const maxTransferBytes=Number(parameters.get('maxTransferBytes'));
    const chunkBytes=Number(parameters.get('chunkBytes'));
    const workingPages=Number(parameters.get('workingPages'));
    const summary={type:'summary',completed:true,canonicalBytes:bytes.length,exitCode:0,stderr:'',failures:[],
      stdout:`${hash}\n${hash}\n`,unhandledWorkerErrors:[],independentReadback:{size:bytes.length},
      owner:'synthetic-owner',privatePagesAfterCleanup:0,fixtureObjectsAfterCleanup:0,
      maxResidentPageBytes:chunkBytes*workingPages,initialWasmMemoryBytes:31457280,finalWasmMemoryBytes:31457280,
      events:{acquired:2,released:2,created:1,closed:1,activeWrites:0,peakWrites:1,largestChunk:3},
      phases:{canonicalStream:{operations:{'stream.read':{count:2}}},fixtureCleanup:{operations:{}},
        sequentialWrite:{operations:{'syscall.write':{count:bytes.length/Math.min(callerBytes,maxTransferBytes)}}},
        positionedIO:{operations:{'syscall.write':{count:12},'syscall.read':{count:13}}}}};
    return new Response(JSON.stringify({type:'chunk',offset:0,base64:bytes.toString('base64')})+'\n'
      +JSON.stringify(summary)+'\n',{headers:{'Content-Type':'application/x-ndjson'}});
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
