import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPythonJspiQualificationExecutor } from '../../integration/python-jspi-executor.fixture.js';
import { createPythonJspiTrampoline } from '../../../src/commands/python/jspi-trampoline.js';

const WebAssembly = (globalThis as any).WebAssembly;

const start = () => ({ signal: new AbortController().signal,
  invocation: {args:['-c','pass'],cwd:'/',env:{}},runtimeMount:'/.runtime',maxTransferBytes:64,
  dispatch:async () => undefined, onReady() {} });

test('JSPI executor retires before admission without acquiring or disposing a borrowed loader', async () => {
  let acquisitions = 0;
  const executor = createPythonJspiQualificationExecutor({trampoline:new WebAssembly.Module(createPythonJspiTrampoline()),
    async loadRuntime() { acquisitions++; throw new Error('should not load'); }});
  await executor.terminate();
  await assert.rejects(executor.run(start()));
  assert.equal(acquisitions,0);
});

test('JSPI executor requires the host to install imports before interpreter startup', async () => {
  const executor = createPythonJspiQualificationExecutor({trampoline:new WebAssembly.Module(createPythonJspiTrampoline()),
    async loadRuntime() { return {version:'314.0.6'} as any; }});
  await assert.rejects(executor.run(start()), {category:'runtime-abi'});
  await executor.terminate();
});
