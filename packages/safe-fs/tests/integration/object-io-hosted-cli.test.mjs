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

test('hosted command refuses unqualified or substituted hundred-MiB workload metadata before deployment', async () => {
  const large = { size: 104857600,
    expectedSequentialSha256: '4cbf988462cc3ba2e10e3aae9f5268546aa79016359fb45be7dd199c073125c0',
    expectedPositionedSha256: '5838873e1c81b0cddbcdda6a5d43367e38a7e85e6599eaa4384bc23ec2a30545' };
  for (const largeWorkload of [undefined, { ...large, size: 9437184 }, { ...large, expectedPositionedSha256: large.expectedSequentialSha256 }]) {
    const options = inputs({ localCases: 17,
      artifact: 'installed-public-runtime-packages-with-candidate-measurement-fixture',
      productionHost: false, deployedCloudflare: false,
      protocol: { size: 9437184,
        expectedSequentialSha256: 'b8b5dabaa3454f7fa46a97c51cec9ccd118ffc0d61df6e46d845ef200a2fd1bb',
        expectedPositionedSha256: 'ee98d04569d114da547c22488141b6efe21d77c13a128c2062728dc7e2c3c59f',
        largeWorkload } });
    await assert.rejects(executeHostedObjectIoQualification(options), /hundred-MiB/);
    assert.equal(options.calls(), 0);
  }
});
