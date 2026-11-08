import assert from 'node:assert/strict';
import test from 'node:test';
import { installPythonLlmDependencies, pythonLlmDependencies } from '../../src/commands/python/llm-dependencies.js';

test('offline LLM dependencies reject incompatible runtimes and incomplete bundles before extraction', async () => {
  let extracted = 0;
  const runtime = {version:'314.0.6', unpackArchive() { extracted++; }};
  await assert.rejects(installPythonLlmDependencies({...runtime,version:'wrong'},[]), /314.0.6/);
  await assert.rejects(installPythonLlmDependencies(runtime,[]), /complete/);
  const archives = pythonLlmDependencies.archives.map(({fileName,byteLength}) => ({fileName,bytes:new Uint8Array(byteLength)}));
  await assert.rejects(installPythonLlmDependencies(runtime,archives.map(() => archives[0]!)), /complete/);
  await assert.rejects(installPythonLlmDependencies(runtime,archives), /digest/);
  assert.equal(extracted,0);
});

test('the pinned dependency contract is immutable and identifies native modules inside authenticated archives', () => {
  assert.ok(Object.isFrozen(pythonLlmDependencies));
  assert.ok(Object.isFrozen(pythonLlmDependencies.archives));
  for (const archive of pythonLlmDependencies.archives) {
    assert.ok(Object.isFrozen(archive));
    assert.equal(archive.sha256.length,64);
  }
  for (const native of pythonLlmDependencies.nativeModules) {
    assert.ok(Object.isFrozen(native));
    assert.ok(pythonLlmDependencies.archives.some(archive => archive.fileName === native.archive));
    assert.equal(native.sha256.length,64);
  }
});
