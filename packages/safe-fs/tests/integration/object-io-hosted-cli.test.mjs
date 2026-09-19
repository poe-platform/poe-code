import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFsFromVolume, Volume } from 'memfs';
import { executeHostedObjectIoQualification } from './object-io-hosted-cli.mjs';

function inputs(manifest) {
  const filesystem=createFsFromVolume(Volume.fromJSON({
    '/owned/out/artifact/qualification.json':JSON.stringify(manifest),
  })).promises;
  let calls=0;
  return {filesystem,artifactDirectory:'/owned/out/artifact',receiptPath:'/owned/out/receipt.json',
    sourceRevision:'3eae1df1fc87219fb6fbe761e4327f2a417ac7cb',runId:'1234',
    accountId:'0123456789abcdef0123456789abcdef',apiToken:'synthetic-deploy-token',
    fetch:async () => {calls++;throw new Error('Network must not be used');},calls:() => calls};
}

test('hosted command rejects absent credentials before deployment', async () => {
  const options=inputs({});
  await assert.rejects(executeHostedObjectIoQualification({...options,apiToken:''}),/credentials/);
  assert.equal(options.calls(),0);
});

test('hosted command refuses artifacts without complete local native qualification', async () => {
  for (const manifest of [{},{localCases:15},{localCases:16,protocol:{size:9437184}}]) {
    const options=inputs(manifest);
    await assert.rejects(executeHostedObjectIoQualification(options),/qualification/);
    assert.equal(options.calls(),0);
  }
});

test('hosted command rejects artifact directory symlinks without deployment', async () => {
  const options=inputs({});
  await options.filesystem.symlink('/owned/out/artifact','/owned/out/link');
  await assert.rejects(executeHostedObjectIoQualification({...options,artifactDirectory:'/owned/out/link'}),/symlink/);
  assert.equal(options.calls(),0);
});
