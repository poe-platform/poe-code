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

test('distinguishes drained native descriptor close failures from incomplete termination in a capacity-1 executor pool (#1110)', async () => {
  const { createPythonExecutorPool } = await import('../../../src/commands/python/executor-pool.js');
  const conflict = Object.assign(new Error('EAGAIN: conditional publication conflict'), { code: 'EAGAIN' });
  const origSuspending = WebAssembly.Suspending;
  const origPromising = WebAssembly.promising;
  const origInstance = WebAssembly.Instance;
  const origTable = WebAssembly.Table;
  WebAssembly.Suspending = function Suspending(fn: any) { return fn; };
  WebAssembly.promising = (fn: any) => fn;
  let currentInvoke: ((name: string, args: number[]) => Promise<number>) | undefined;
  WebAssembly.Instance = function Instance(_mod: any, imports: any) {
    if (imports?.request?.__syscall_openat) {
      currentInvoke = (_name: string, args: number[]) => imports.request.__syscall_openat(...args);
    }
    this.exports = imports?.original ?? {};
  };
  WebAssembly.Table = function Table() {
    return { set() {} };
  };

  try {
    let runCount = 0;
    let releaseHang: (() => void) | undefined;

    const makeExecutor = (onOpenAndClose: (native: any) => Promise<void>) => createPythonJspiExecutor({
      trampoline: {},
      nativeCall: {},
      statResult: {},
      async loadRuntime(cfg) {
        cfg.bindImports({
          env: {
            fd_read: () => 0,
            fd_write: () => 0,
            __syscall_openat: () => 3,
          },
        });
        cfg.bindInstance({ exports: { syscall_syncify: () => 0 } });
        cfg.bindScheduler({ scheduleCallback: () => {} });
        const memory = new Uint8Array(65536);
        const streams: any[] = [];
        return {
          version: '314.0.6',
          _module: {
            jspiSupported: true,
            HEAPU8: memory,
            FS: {
              streams,
              createStream(stream: any) {
                const fd = Math.max(3, streams.length);
                streams[fd] = { ...stream, fd };
                return streams[fd];
              },
              closeStream(fd: number) { streams[fd] = null; },
            },
            _Py_FinalizeEx: () => 0,
            _free: () => {},
            removeFunction: () => {},
            addFunction: () => 1,
            getValue: () => 0,
            setValue: () => {},
            UTF8ToString: () => '["stat","/",false]',
            lengthBytesUTF8: () => 2,
            stringToUTF8: () => {},
            _malloc: () => 16,
          },
          globals: new Map(),
          FS: {
            root: {},
            filesystems: { MEMFS: {} },
            mount: () => {},
            mkdir: () => {},
            currentPath: '/',
            cwd: () => '/',
            readdir: () => ['.', '..'],
          },
          runPython: (code: string) => code.includes('errno') ? '{"EIO":5,"EINTR":4,"EINVAL":22}' : 0,
          runPythonAsync: async (code: string) => {
            if (code.includes('_safe_execution_code')) {
              await onOpenAndClose(memory);
            }
            return 0;
          },
        };
      },
    });


    const pool = createPythonExecutorPool({
      maxConcurrentExecutors: 1,
      createExecutor: () => {
        const idx = ++runCount;
        return createPythonJspiExecutor({
          trampoline: {},
          nativeCall: {},
          statResult: {},
          async loadRuntime(cfg) {
            cfg.bindImports({
              env: {
                fd_read: () => 0,
                fd_write: () => 0,
                __syscall_openat: (...args: number[]) => {
                  // Trigger native __syscall_openat via request bound by bindImports
                  return 3;
                },
              },
            });
            cfg.bindInstance({ exports: { syscall_syncify: () => 0 } });
            cfg.bindScheduler({ scheduleCallback: () => {} });
            const memory = new Uint8Array(65536);
            memory.set(new TextEncoder().encode('/dirty\0'), 256);
            const streams: any[] = [];
            const mod = {
              jspiSupported: true,
              HEAPU8: memory,
              HEAPU32: new Uint32Array(memory.buffer),
              _PyImport_AddModule: () => 1,
              _PyCFunction_NewEx: () => 1,
              _PyModule_AddObject: () => 0,
              _PyObject_GetAttrString: () => 1,
              _Py_DecRef: () => {},
              FS: {
                streams,
                createStream(stream: any) {
                  const fd = Math.max(3, streams.length);
                  streams[fd] = { ...stream, fd };
                  return streams[fd];
                },
                closeStream(fd: number) { streams[fd] = null; },
              },
              _Py_FinalizeEx: () => 0,
              _free: () => {},
              removeFunction: () => {},
              addFunction: () => 1,
              getValue: () => 0,
              setValue: () => {},
              UTF8ToString: () => '["stat","/",false]',
              lengthBytesUTF8: () => 2,
              stringToUTF8: () => {},
              _malloc: () => 16,
            };
            return {
              version: '314.0.6',
              _module: mod,
              globals: new Map(),
              FS: {
                root: {},
                filesystems: { MEMFS: {} },
                mount: () => {},
                mkdir: () => {},
                currentPath: '/',
                cwd: () => '/',
                readdir: () => ['.', '..'],
              },
              runPython: (code: string) => code.includes('errno') ? '{"EIO":5,"EINTR":4,"EINVAL":22}' : 0,
              runPythonAsync: async (code: string) => {
                if (code.includes('_safe_execution_code') && idx !== 2) {
                  await currentInvoke?.('__syscall_openat', [-100, 256, 1, 0]);
                }
                return 0;
              },
            };
          },
        });
      },
    });



    // 1. First run: open a native descriptor whose close rejects with EAGAIN during JSPI teardown.
    const first = pool.createExecutor();
    await assert.rejects(
      first.run({
        ...start(),
        dispatch: async (req: any) => {
          if (req.op === 'open') return 1;
        if (req.op === 'descriptorCapabilities') return { positionedRead: true, positionedWrite: true, truncate: true, synchronization: 'storage' };
          if (req.op === 'close') throw conflict;
          return undefined;
        },
      }),
      (err: any) => err instanceof AggregateError && err.errors[0] === conflict
    );
    await first.terminate();
    assert.equal(pool.inspect().active, 0);

    // 2. Second run in the same capacity-1 pool succeeds!
    const second = pool.createExecutor();
    assert.equal(await second.run(start()), 0);
    await second.terminate();
    assert.equal(pool.inspect().active, 0);

    // 3. Third run: hanging native close continues to hold pool admission until close drains.
    const hangPromise = new Promise<void>(resolve => { releaseHang = resolve; });
    const third = pool.createExecutor();
    let thirdSettled = false;
    const thirdRun = third.run({
      ...start(),
      dispatch: async (req: any) => {
        if (req.op === 'open') return 1;
        if (req.op === 'descriptorCapabilities') return { positionedRead: true, positionedWrite: true, truncate: true, synchronization: 'storage' };
        if (req.op === 'close') {
          await hangPromise;
          throw conflict;
        }
        return undefined;
      },
    }).finally(() => { thirdSettled = true; });

    await new Promise(resolve => setTimeout(resolve, 20));
    const thirdTerminate = third.terminate();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(thirdSettled, false);
    assert.equal(pool.inspect().active, 1);
    assert.throws(() => pool.createExecutor(), { category: 'capacity' });

    releaseHang!();
    await assert.rejects(thirdRun, (err: any) => err instanceof AggregateError && err.errors[0] === conflict);
    await thirdTerminate;
    assert.equal(pool.inspect().active, 0);
  } finally {
    WebAssembly.Suspending = origSuspending;
    WebAssembly.promising = origPromising;
    WebAssembly.Instance = origInstance;
    WebAssembly.Table = origTable;
  }
});
