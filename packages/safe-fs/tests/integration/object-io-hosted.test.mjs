import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { admitObjectIoArtifacts, runHostedObjectIoQualification } from './object-io-hosted.mjs';

const nonce = 'abcdef0123456789abcdef0123456789';
const token = 'synthetic-token-'.repeat(4);
const accountId = '0123456789abcdef0123456789abcdef';

function artifacts() {
  const bytes = new TextEncoder().encode('export default {fetch(){return new Response("fixture")}}');
  const manifest = { compatibilityDate:'2026-09-17', artifacts:[
    {name:'main.mjs',type:'ESModule',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},
  ] };
  return {manifest, readArtifact:async () => bytes};
}

function fixture(failure) {
  const calls = [];
  let owner = nonce;
  const api = async (path, options = {}) => {
    const method = options.method ?? 'GET';
    calls.push({path,method,body:options.body});
    if (failure === method + ' ' + path.split('/').at(-1)) return {status:500,success:false};
    if (path.endsWith('/workers/subdomain')) return {status:200,success:true,result:{subdomain:'isolated-test'}};
    if (method === 'GET' && path.endsWith('/settings')) return {status:200,success:true,
      result:{bindings:[{name:'QUALIFICATION_OWNER',type:'plain_text',text:owner}]}};
    if (method === 'GET') return {status:404,success:false};
    return {status:200,success:true,result:{}};
  };
  const qualify = async () => {
    if (failure === 'qualify') throw new Error('synthetic qualification failure');
    if (failure === 'ownership') owner = 'changed-owner';
    return {exactBytes:true};
  };
  const clean = async () => ({empty:true,deletedObjects:0});
  return {calls,api,qualify,clean, accountId,nonce,token,runId:'1234',
    sourceRevision:'3eae1df1fc87219fb6fbe761e4327f2a417ac7cb'};
}

test('hosted artifact admission authenticates bytes and rejects path or type drift', async () => {
  const inputs = artifacts();
  const admitted = await admitObjectIoArtifacts(inputs);
  assert.equal(admitted.mainModule, 'main.mjs');
  assert.equal(admitted.modules.length, 1);
  assert.notEqual(admitted.modules[0].contents, await inputs.readArtifact());
  for (const changes of [{name:'../main.mjs'},{type:'Unknown'},{bytes:1},{sha256:'0'.repeat(64)}]) {
    await assert.rejects(admitObjectIoArtifacts({...inputs,manifest:{...inputs.manifest,
      artifacts:[{...inputs.manifest.artifacts[0],...changes}]}}));
  }
});

test('hosted artifact admission rejects duplicate modules and absent main', async () => {
  const inputs = artifacts();
  await assert.rejects(admitObjectIoArtifacts({...inputs,manifest:{...inputs.manifest,
    artifacts:[...inputs.manifest.artifacts,...inputs.manifest.artifacts]}}));
  await assert.rejects(admitObjectIoArtifacts({...inputs,manifest:{...inputs.manifest,artifacts:[]}}));
});

test('hosted success qualifies the admitted artifact then removes only fresh owned resources', async () => {
  const inputs = fixture();
  const result = await runHostedObjectIoQualification({...inputs,artifact:await admitObjectIoArtifacts(artifacts())});
  assert.deepEqual(result.qualification, {exactBytes:true});
  assert.equal(result.cleanupComplete, true);
  const deletions = inputs.calls.filter(call => call.method === 'DELETE');
  assert.equal(deletions.length, 2);
  assert.ok(deletions.every(call => call.path.includes('poe-code-io-1234-abcdef012345')));
  const upload = inputs.calls.find(call => call.method === 'PUT');
  const metadata = JSON.parse(await upload.body.get('metadata').text());
  assert.equal(metadata.main_module, 'main.mjs');
  assert.equal(metadata.bindings.find(binding => binding.name === 'SCRATCH').bucket_name, result.bucketName);
  assert.equal(metadata.bindings.find(binding => binding.name === 'QUALIFICATION_TOKEN').type, 'secret_text');
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('hosted qualification failure still drains and removes both owned resources', async () => {
  const inputs = fixture('qualify');
  await assert.rejects(runHostedObjectIoQualification({...inputs,artifact:await admitObjectIoArtifacts(artifacts())}),
    error => error.message === 'synthetic qualification failure' && error.cleanupComplete === true);
  assert.equal(inputs.calls.filter(call => call.method === 'DELETE').length, 2);
});

test('hosted cleanup never overwrites or deletes a worker whose ownership changed', async () => {
  const inputs = fixture('ownership');
  await assert.rejects(runHostedObjectIoQualification({...inputs,artifact:await admitObjectIoArtifacts(artifacts())}), /ownership/);
  assert.equal(inputs.calls.filter(call => call.method === 'PUT').length, 1);
  assert.equal(inputs.calls.filter(call => call.method === 'DELETE').length, 0);
});

test('hosted preflight refusal performs no writes', async () => {
  const inputs = fixture();
  inputs.api = async (path, options = {}) => {
    inputs.calls.push({path,method:options.method ?? 'GET'});
    return {status:200,success:true,result:{}};
  };
  await assert.rejects(runHostedObjectIoQualification({...inputs,artifact:await admitObjectIoArtifacts(artifacts())}));
  assert.ok(inputs.calls.every(call => call.method === 'GET'));
});

test('hosted cleanup refuses deletion when bucket draining cannot verify emptiness', async () => {
  const inputs = fixture();
  inputs.clean = async () => ({empty:false});
  await assert.rejects(runHostedObjectIoQualification({...inputs,artifact:await admitObjectIoArtifacts(artifacts())}),
    /emptiness/);
  assert.equal(inputs.calls.filter(call => call.method === 'DELETE').length, 0);
});

test('hosted failed upload still cleans a committed worker authenticated by its owner binding', async () => {
  const inputs = fixture('PUT poe-code-io-1234-abcdef012345');
  await assert.rejects(runHostedObjectIoQualification({...inputs,artifact:await admitObjectIoArtifacts(artifacts())}),
    /upload failed/);
  assert.equal(inputs.calls.filter(call => call.method === 'DELETE').length, 2);
});

test('hosted cleanup preserves both primary and drain failures', async () => {
  const inputs = fixture('qualify');
  inputs.clean = async () => {throw new Error('synthetic drain failure');};
  await assert.rejects(runHostedObjectIoQualification({...inputs,artifact:await admitObjectIoArtifacts(artifacts())}),
    error => error instanceof AggregateError
      && error.errors[0].message === 'synthetic qualification failure'
      && error.errors[1].message === 'synthetic drain failure');
  assert.equal(inputs.calls.filter(call => call.method === 'DELETE').length, 0);
});

test('hosted cleanup checks ownership again after draining before deleting resources', async () => {
  const inputs = fixture();
  const api = inputs.api;
  let drained = false;
  inputs.clean = async () => {drained=true;return {empty:true};};
  inputs.api = async (path, options) => {
    const response = await api(path,options);
    if (drained && path.endsWith('/settings')) {
      response.result.bindings[0].text = 'replacement-owner';
    }
    return response;
  };
  await assert.rejects(runHostedObjectIoQualification({...inputs,artifact:await admitObjectIoArtifacts(artifacts())}),
    /ownership/);
  assert.equal(inputs.calls.filter(call => call.method === 'DELETE').length, 0);
});
