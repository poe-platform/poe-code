import { createPythonNativeSyscalls } from '@poe-code/safe-fs/core';
import type { PythonAsyncExecutor, PythonExecutorStart } from './index.js';
import { PythonFailure } from './diagnostics.js';
import { parsePythonInvocation } from './invocation.js';
import { pythonExecution } from './execution.js';
import { pythonJspiSignatures } from './jspi-trampoline.js';
import { createPythonJspiScheduler, type PythonJspiCallback } from './jspi-scheduler.js';
import { pythonRuntimeRelocation, pythonImportMetadata, pythonDirectoryEntries, pythonStatProjection, pythonTreeCleanup } from './runtime-scripts.js';

export interface PythonJspiRuntimeConfiguration {
  readonly jsglobals: Record<string, never>;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  bindImports(imports: Record<string, Record<string, any>>): void;
  bindInstance(instance: { exports: Record<string, any> }): void;
  bindScheduler(api: {scheduleCallback: (callback: PythonJspiCallback, delay?: number) => void}): void;
}

export interface PythonJspiExecutorOptions {
  readonly trampoline: object;
  readonly nativeCall: object;
  readonly statResult: object;
  readonly loadRuntime: (configuration: PythonJspiRuntimeConfiguration) => Promise<any>;
}

export function createPythonJspiExecutor(options: PythonJspiExecutorOptions): PythonAsyncExecutor {
  const engine = (globalThis as any).WebAssembly;
  const active = new engine.Global({value:'i32', mutable:true}, 0);
  const syncify = new engine.Table({element:'anyfunc', initial:1});
  const controller = new AbortController();
  const scheduler = createPythonJspiScheduler();
  let admitted = false;
  let running: Promise<number> | undefined;
  let retirement: Promise<void> | undefined;
  let cleanup: Promise<void> | undefined;
  let runtime: any;
  let native: ReturnType<typeof createPythonNativeSyscalls> | undefined;
  let instanceBound = false;
  let importsBound = false;
  let schedulerBound = false;
  let methodDefinition = 0;
  let methodPointer: number | undefined;
  let statPointer: number | undefined;
  const originals: Record<string, (...args: any[]) => number> = {};

  const execute = async (start: PythonExecutorStart): Promise<number> => {
    const signal = AbortSignal.any([start.signal, controller.signal]);
    const configuration = parsePythonInvocation(start.invocation.args, start.invocation.env);
    try {
      signal.throwIfAborted();
      if (start.packages?.requirements.length || start.installOnly) throw new PythonFailure('runtime-assets', {cause:new Error('JSPI runtime requires statically qualified packages')});
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
          const shutdown = Object.fromEntries(Object.entries(request).map(([name, dispatch]) => [name, new engine.Suspending(dispatch)]));
          const bridge = new engine.Instance(options.trampoline, {original, request, shutdown, control:{active, syncify}});
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
        bindScheduler(api) {
          if (schedulerBound) throw new PythonFailure('runtime-abi');
          api.scheduleCallback = scheduler.scheduleCallback;
          schedulerBound = true;
        },
      });
      if (!importsBound || !instanceBound || !schedulerBound || runtime.version !== '314.0.6' || !runtime._module.jspiSupported) throw new PythonFailure('runtime-abi');
      signal.throwIfAborted();
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
      const module = runtime._module;
      const send = async (pointer: number): Promise<number> => {
        let response = await encode(async () => {
          signal.throwIfAborted();
          const [operation, path, follow] = JSON.parse(module.UTF8ToString(pointer, 16384));
          if (operation === 'stat') return native!.metadata(path, follow);
          if (typeof path !== 'string') throw Object.assign(new Error('Invalid native Python path'), {code:'EINVAL'});
          const target = absolute(path);
          if (operation === 'directory') {
            const entries = bootstrapPath(target) ? filesystem.readdir(target).filter((name: string) => name !== '.' && name !== '..')
              : (await start.dispatch({op:'readdir',args:[target]}) as {name:string}[]).map(entry => entry.name);
            return {entries};
          }
          if (operation === 'tree') {
            if (bootstrapPath(target) || !await start.dispatch({op:'rmtreeSupported',args:[target]})) return {supported:false};
            try { await start.dispatch({op:'rmtree',args:[target]}); return {supported:true}; }
            catch (error) { return {supported:true, errno:errno[(error as {code?:string}).code ?? ''] ?? errno.EIO}; }
          }
          throw Object.assign(new Error('Invalid native Python operation'), {code:'EINVAL'});
        });
        if (response.length > 1048576) response = JSON.stringify({errno:errno.EFBIG});
        let bytes = new TextEncoder().encode(response);
        if (bytes.length > 1048576) bytes = new TextEncoder().encode(JSON.stringify({errno:errno.EFBIG}));
        const output = module._malloc(bytes.length + 1);
        if (!output) return 0;
        module.HEAPU8.set(bytes, output);
        module.HEAPU8[output + bytes.length] = 0;
        return output;
      };
      const nativeCall = new engine.Instance(options.nativeCall, {
        python: {utf8:module._PyUnicode_AsUTF8, unicode:module._PyUnicode_FromString,
          free:module._free, noMemory:module._PyErr_NoMemory},
        request: {send}, shutdown: {send:new engine.Suspending(send)}, control: {active, syncify},
      });
      methodPointer = module.addFunction(nativeCall.exports.call, 'iii');
      methodDefinition = module._malloc(128);
      if (!methodDefinition) throw new PythonFailure('runtime-assets');
      module.HEAPU8.fill(0, methodDefinition, methodDefinition + 128);
      module.HEAPU8.set(new TextEncoder().encode('request\0_safe_native_fs\0'), methodDefinition + 16);
      module.HEAPU32.set([methodDefinition + 16, methodPointer, 8, 0], methodDefinition / 4);
      const extension = module._PyImport_AddModule(methodDefinition + 24);
      const callable = module._PyCFunction_NewEx(methodDefinition, 0, 0);
      if (!extension || !callable || module._PyModule_AddObject(extension, methodDefinition + 16, callable) < 0) throw new PythonFailure('runtime-abi');
      const fields = Number(runtime.runPython('os.stat_result.n_fields'));
      const statResult = new engine.Instance(options.statResult, {python: {
        fields: new engine.Global({value:'i32'}, fields), create:module._PyStructSequence_New,
        size:module._PyTuple_Size, item:module._PyTuple_GetItem, retain:module._Py_IncRef,
        set:module._PyStructSequence_SetItem, invalid:module._PyErr_BadArgument,
      }});
      statPointer = module.addFunction(statResult.exports.construct, 'iii');
      module.HEAPU8.set(new TextEncoder().encode('stat_result\0os\0'), methodDefinition + 80);
      module.HEAPU32.set([methodDefinition + 80, statPointer, 8, 0], (methodDefinition + 64) / 4);
      const osModule = module._PyImport_AddModule(methodDefinition + 92);
      const statType = module._PyObject_GetAttrString(osModule, methodDefinition + 80);
      const constructStat = module._PyCFunction_NewEx(methodDefinition + 64, statType, 0);
      module._Py_DecRef(statType);
      if (!constructStat || module._PyModule_AddObject(extension, methodDefinition + 80, constructStat) < 0) throw new PythonFailure('runtime-abi');
      runtime.runPython(`
from _safe_native_fs import request as _safe_native_request
def _safe_stat_projection(path, follow):
 return _safe_native_request(json.dumps(['stat', path, follow]))
def _safe_import_stat(path):
 return _safe_stat_projection(path, True)
def _safe_directory_entries(path):
 return _safe_native_request(json.dumps(['directory', path]))
def _safe_tree_cleanup(path):
 return _safe_native_request(json.dumps(['tree', path]))
`);
      for (const script of [pythonImportMetadata, pythonDirectoryEntries, pythonStatProjection, pythonTreeCleanup]) runtime.runPython(script);
      runtime.runPython(`
from _safe_native_fs import stat_result as _safe_construct_stat
_safe_stat_fields = os.stat_result.n_fields
_safe_stat_probe = os.stat_result(tuple(range(_safe_stat_fields)))
_safe_stat_indexes = {name: getattr(_safe_stat_probe, name) for name in dir(_safe_stat_probe) if name.startswith('st_')}
def _safe_native_stat_type(values, extras):
 fields = list(values) + [None] * (_safe_stat_fields - len(values))
 for name, value in extras.items():
  if name in _safe_stat_indexes:
   fields[_safe_stat_indexes[name]] = value
 return _safe_construct_stat(tuple(fields))
_safe_stat_type = _safe_native_stat_type
`);
      runtime.globals.set('_safe_invocation_json', JSON.stringify(start.invocation));
      runtime.globals.set('_safe_execution_code', pythonExecution);
      runtime.globals.set('_safe_is_cancelled', () => signal.aborted);
      active.value = 1;
      start.onReady();
      const exitCode = await runtime.runPythonAsync(`
try:
 exec(_safe_execution_code)
except BaseException:
 if not _safe_is_cancelled():
  raise
 _safe_exit = 130
_safe_exit
`);
      await runtime.runPythonAsync(`
import asyncio as _safe_asyncio
async def _safe_quiesce_tasks():
 current = _safe_asyncio.current_task()
 while True:
  pending = [task for task in _safe_asyncio.all_tasks() if task is not current]
  if not pending:
   break
  for task in pending:
   task.cancel()
  await _safe_asyncio.gather(*pending, return_exceptions=True)
 loop = _safe_asyncio.get_running_loop()
 await loop.shutdown_asyncgens()
 await loop.shutdown_default_executor()
await _safe_quiesce_tasks()
`);
      await scheduler.close();
      active.value = 2;
      const finalized = await engine.promising(runtime._module._Py_FinalizeEx)();
      signal.throwIfAborted();
      return finalized < 0 ? 120 : Number(exitCode) & 255;
    } finally {
      active.value = 0;
      cleanup = scheduler.close().finally(() => native?.close());
      try { await cleanup; }
      finally {
        if (methodDefinition) runtime?._module._free(methodDefinition);
        if (methodPointer !== undefined) runtime?._module.removeFunction(methodPointer);
        if (statPointer !== undefined) runtime?._module.removeFunction(statPointer);
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
        await running?.catch(() => {});
        await cleanup;
      })();
      return retirement;
    },
  };
}
