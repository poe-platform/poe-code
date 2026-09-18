import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPythonJspiExecutor,
  createPythonJspiTrampoline, createPythonJspiNativeCall, createPythonJspiStatResult } from '../../../src/commands/python/index.js';

const WebAssembly = (globalThis as any).WebAssembly;

const start = () => ({ signal: new AbortController().signal,
  invocation: {args:['-c','pass'],cwd:'/',env:{}},runtimeMount:'/.runtime',maxTransferBytes:64,
  dispatch:async () => undefined, onReady() {} });

test('JSPI executor retires before admission without acquiring or disposing a borrowed loader', async () => {
  let acquisitions = 0;
  const executor = createPythonJspiExecutor({trampoline:new WebAssembly.Module(createPythonJspiTrampoline()),
    nativeCall:new WebAssembly.Module(createPythonJspiNativeCall()),
    statResult:new WebAssembly.Module(createPythonJspiStatResult()),
    async loadRuntime() { acquisitions++; throw new Error('should not load'); }});
  await executor.terminate();
  await assert.rejects(executor.run(start()));
  assert.equal(acquisitions,0);
});

test('JSPI executor requires the host to install imports before interpreter startup', async () => {
  const executor = createPythonJspiExecutor({trampoline:new WebAssembly.Module(createPythonJspiTrampoline()),
    nativeCall:new WebAssembly.Module(createPythonJspiNativeCall()),
    statResult:new WebAssembly.Module(createPythonJspiStatResult()),
    async loadRuntime() { return {version:'314.0.6'} as any; }});
  await assert.rejects(executor.run(start()), {category:'runtime-abi'});
  await executor.terminate();
});

test('an empty prepared package session does not require dynamic package loading', async () => {
  const failure = new Error('loader reached');
  const executor = createPythonJspiExecutor({trampoline:new WebAssembly.Module(createPythonJspiTrampoline()),
    nativeCall:new WebAssembly.Module(createPythonJspiNativeCall()), statResult:new WebAssembly.Module(createPythonJspiStatResult()),
    async loadRuntime() { throw failure; }});
  await assert.rejects(executor.run({...start(), packages:{session:'prepared',requirements:[],offline:true}}), error => error === failure);
  await executor.terminate();
});
