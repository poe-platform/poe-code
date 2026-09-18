import { createPythonNativeSyscalls } from '@poe-code/safe-fs/core';
import type { PythonAsyncExecutor, PythonExecutorStart } from '../../src/commands/python/index.js';
import { PythonFailure } from '../../src/commands/python/diagnostics.js';
import { parsePythonInvocation } from '../../src/commands/python/invocation.js';
import { pythonExecution } from '../../src/commands/python/execution.js';
import { pythonJspiSignatures } from '../../src/commands/python/jspi-trampoline.js';
import { pythonRuntimeRelocation, pythonImportMetadata, pythonDirectoryEntries, pythonStatProjection, pythonTreeCleanup } from '../../src/commands/python/runtime-scripts.js';

export interface PythonJspiRuntimeConfiguration {
  readonly jsglobals: Record<string, never>;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  bindImports(imports: Record<string, Record<string, any>>): void;
  bindInstance(instance: { exports: Record<string, any> }): void;
}

export interface PythonJspiExecutorOptions {
  readonly trampoline: object;
  readonly loadRuntime: (configuration: PythonJspiRuntimeConfiguration) => Promise<any>;
}

export function createPythonJspiQualificationExecutor(options: PythonJspiExecutorOptions): PythonAsyncExecutor {
  const engine = (globalThis as any).WebAssembly;
  const active = new engine.Global({value:'i32', mutable:true}, 0);
  const syncify = new engine.Table({element:'anyfunc', initial:1});
  const interrupted = new Uint8Array(1);
  const controller = new AbortController();
  let admitted = false;
  let running: Promise<number> | undefined;
  let retirement: Promise<void> | undefined;
  let cleanup: Promise<void> | undefined;
  let runtime: any;
  let native: ReturnType<typeof createPythonNativeSyscalls> | undefined;
  let instanceBound = false;
  let importsBound = false;
  const originals: Record<string, (...args: any[]) => number> = {};

  const execute = async (start: PythonExecutorStart): Promise<number> => {
    const signal = AbortSignal.any([start.signal, controller.signal]);
    const interrupt = () => { interrupted[0] = 2; };
    signal.addEventListener('abort', interrupt, {once:true});
    const configuration = parsePythonInvocation(start.invocation.args, start.invocation.env);
    try {
      signal.throwIfAborted();
      if (start.packages || start.installOnly) throw new PythonFailure('runtime-assets', {cause:new Error('JSPI runtime requires statically qualified packages')});
      runtime = await options.loadRuntime({jsglobals:Object.create(null) as Record<string, never>,
        args:configuration.startupArgs, env:configuration.env,
        bindImports(imports) {
          if (importsBound) throw new PythonFailure('runtime-abi');
          const namespaces = [...new Set(Object.values(imports))];
          for (const namespace of namespaces) {
            for (const [name, value] of Object.entries(namespace)) {
              if (typeof value !== 'function') continue;
              if (name in pythonJspiSignatures) originals[name] = value as (...args: any[]) => number;
              else if (name.startsWith('__syscall_') || name === '_maybe_connect_async') namespace[name] = () => -52;
              else if (name === '_emscripten_system') namespace[name] = (command: number) => command === 0 ? 0 : -52;
            }
          }
          if (!originals.fd_read || !originals.fd_write || !originals.__syscall_openat) throw new PythonFailure('runtime-abi');
          const original = Object.fromEntries(Object.keys(pythonJspiSignatures).map(name => [name, originals[name] ?? (() => -52)]));
          const request = Object.fromEntries(Object.keys(pythonJspiSignatures).map(name => [name,
            (...args: (number | bigint)[]) => native!.invoke(name, args)]));
          const bridge = new engine.Instance(options.trampoline, {original, request, control:{active, syncify}});
          for (const namespace of namespaces) for (const name of Object.keys(originals)) {
            if (typeof namespace[name] === 'function') namespace[name] = bridge.exports[name];
          }
          importsBound = true;
        },
        bindInstance(instance) {
          if (instanceBound || !importsBound || typeof instance.exports.syscall_syncify !== 'function') throw new PythonFailure('runtime-abi');
          syncify.set(0, instance.exports.syscall_syncify);
          instanceBound = true;
        },
      });
      if (!importsBound || !instanceBound || runtime.version !== '314.0.6' || !runtime._module.jspiSupported) throw new PythonFailure('runtime-abi');
      signal.throwIfAborted();
      runtime.setInterruptBuffer(interrupted);
      runtime.runPython('import sys, os, json, runpy, traceback, types, warnings, textwrap, io, struct, linecache, importlib.machinery, shutil, stat, pyodide.ffi');
      runtime.globals.set('_safe_runtime_mount', start.runtimeMount);
      const filesystem = runtime.FS;
      const bootstrap = filesystem.root;
      filesystem.root = null;
      filesystem.mount(filesystem.filesystems.MEMFS, {}, '/');
      filesystem.mkdir(start.runtimeMount);
      filesystem.mount({mount:() => bootstrap}, {}, start.runtimeMount);
      runtime.runPython(pythonRuntimeRelocation);
      filesystem.currentPath = start.invocation.cwd;
      native = createPythonNativeSyscalls({runtime:runtime._module, cwd:start.invocation.cwd,
        runtimeMount:start.runtimeMount, maxTransferBytes:start.maxTransferBytes, signal,
        dispatch:start.dispatch, original:(name, args) => originals[name]!(...args)});
      const errno = JSON.parse(runtime.runPython("__import__('json').dumps({name:value for name,value in vars(__import__('errno')).items() if name.startswith('E') and isinstance(value,int)})"));
      const encode = async (operation: () => Promise<unknown>): Promise<string> => {
        try { return JSON.stringify(await operation()); }
        catch (error) { return JSON.stringify({errno:signal.aborted ? errno.EINTR : (error as {errno?:number}).errno ?? errno[(error as {code?:string}).code ?? ''] ?? errno.EIO}); }
      };
      const absolute = (path: string): string => path.startsWith('/') ? path : filesystem.cwd() + '/' + path;
      const bootstrapPath = (path: string): boolean => path === start.runtimeMount || path.startsWith(start.runtimeMount + '/');
      runtime.globals.set('_safe_async_metadata', (path: string | number, follow: boolean) => encode(() => native!.metadata(path, follow)));
      runtime.globals.set('_safe_async_directory', (path: string) => encode(async () => {
        const target = absolute(path);
        const entries = bootstrapPath(target) ? filesystem.readdir(target).filter((name: string) => name !== '.' && name !== '..')
          : (await start.dispatch({op:'readdir',args:[target]}) as {name:string}[]).map(entry => entry.name);
        return {entries};
      }));
      runtime.globals.set('_safe_async_tree', (path: string) => encode(async () => {
        const target = absolute(path);
        if (bootstrapPath(target) || !await start.dispatch({op:'rmtreeSupported',args:[target]})) return {supported:false};
        try { await start.dispatch({op:'rmtree',args:[target]}); return {supported:true}; }
        catch (error) { return {supported:true, errno:errno[(error as {code?:string}).code ?? ''] ?? errno.EIO}; }
      }));
      runtime.runPython(`
from pyodide.ffi import run_sync as _safe_run_sync
def _safe_stat_projection(path, follow):
 return _safe_run_sync(_safe_async_metadata(path, follow))
def _safe_import_stat(path):
 return _safe_stat_projection(path, True)
def _safe_directory_entries(path):
 return _safe_run_sync(_safe_async_directory(path))
def _safe_tree_cleanup(path):
 return _safe_run_sync(_safe_async_tree(path))
`);
      for (const script of [pythonImportMetadata, pythonDirectoryEntries, pythonStatProjection, pythonTreeCleanup]) runtime.runPython(script);
      runtime.globals.set('_safe_invocation_json', JSON.stringify(start.invocation));
      active.value = 1;
      start.onReady();
      const exitCode = await runtime.runPythonAsync(pythonExecution);
      signal.throwIfAborted();
      const finalized = await runtime._module.createPromising(runtime._module._Py_FinalizeEx)();
      signal.throwIfAborted();
      return finalized < 0 ? 120 : Number(exitCode) & 255;
    } finally {
      active.value = 0;
      signal.removeEventListener('abort', interrupt);
      cleanup = native?.close();
      try { await cleanup; }
      finally {
        runtime = undefined;
        native = undefined;
        syncify.set(0, null);
        for (const name of Object.keys(originals)) delete originals[name];
      }
    }
  };
  return {
    run(start) {
      if (admitted || retirement) return Promise.reject(new PythonFailure('executor-unavailable'));
      admitted = true;
      running = execute(start);
      return running;
    },
    terminate() {
      retirement ??= (async () => {
        controller.abort();
        interrupted[0] = 2;
        await running?.catch(() => {});
        await cleanup;
      })();
      return retirement;
    },
  };
}
