import { mountPythonFileSystem } from '@poe-code/safe-fs/core';
import { pythonExecution } from './execution.js';
import { pythonRuntimeRelocation, pythonImportMetadata, pythonDirectoryEntries, pythonStatProjection, pythonTreeCleanup } from './runtime-scripts.js';
import { parsePythonInvocation } from './invocation.js';
import { installPythonPackages } from './provisioning-runtime.js';
import type { PythonPackageStart } from './provisioning.js';
import { PythonFailure, type PythonFailureCategory } from './diagnostics.js';

export interface PythonWorkerStart {
  readonly packages?: PythonPackageStart;
  readonly installOnly?: boolean;
  readonly shared: SharedArrayBuffer;
  readonly invocation: { readonly args: readonly string[]; readonly cwd: string; readonly env: Readonly<Record<string, string>> };
  readonly runtimeMount: string;
  readonly maxTransferBytes: number;
}

/** Runtime-owned dynamic Emscripten ABI, supplied explicitly by the host. */
export interface PythonWorkerRuntime {
  readonly version: string;
  readonly FS: any;
  readonly _module: any;
  readonly globals: { set(name: string, value: unknown): void; delete(name: string): void };
  runPython(source: string): any;
  setStdin(options: {read(buffer: Uint8Array): number}): void;
  setStdout(options: {write(buffer: Uint8Array): number}): void;
  setStderr(options: {write(buffer: Uint8Array): number}): void;
}

export function createPythonWorkerRequest(
  shared: SharedArrayBuffer,
  postMessage: (message: unknown) => void,
  error: (code: string) => Error,
): (operation: string, ...args: any[]) => any {
  let control: Int32Array<SharedArrayBuffer>;
  let payload: Uint8Array<SharedArrayBuffer>;
  try {
    control = new Int32Array(shared, 0, 2);
    payload = new Uint8Array(shared, 8);
  } catch (cause) { throw new PythonFailure('transport-unavailable', { cause }); }
  return (op, ...args) => {
    let length: number;
    let status: number;
    try {
      Atomics.store(control, 0, 0);
      postMessage({op, args});
      while (Atomics.load(control, 0) === 0) Atomics.wait(control, 0, 0);
      length = Atomics.load(control, 1);
      status = Atomics.load(control, 0);
    } catch (cause) { throw cause instanceof PythonFailure ? cause : new PythonFailure('transport-unavailable', { cause }); }
    if (length < 0 || length > payload.length) throw error('EIO');
    // Browser TextDecoder does not accept shared backing stores.
    const result = JSON.parse(new TextDecoder().decode(payload.slice(0, length)));
    if (status !== 1) {
      if (op.startsWith('package-') && typeof result.message === 'string') throw new Error(result.message);
      throw error(result.code ?? 'EIO');
    }
    return result;
  };
}


interface WasmImports { readonly env?: Record<string, unknown> }
interface WasmEngine {
 instantiate(source: unknown, imports?: WasmImports): Promise<unknown>;
 instantiateStreaming?: (source: unknown, imports?: WasmImports) => Promise<unknown>;
}

/** Intercept the pinned native syscall imports before the interpreter exists.
 * Only call on the dedicated worker's event loop; no host-global mutation is safe here.
 * This blocks ordinary libc routes, not deliberate trusted JavaScript escapes.
 */
async function loadPythonRuntime(
 load: () => Promise<PythonWorkerRuntime>,
): Promise<PythonWorkerRuntime> {
 const wasm = (globalThis as unknown as { WebAssembly: WasmEngine }).WebAssembly;
 const instantiate = wasm.instantiate;
 const instantiateStreaming = wasm.instantiateStreaming;
 let protectedSystem = false;
 let protectedSockets = false;
 const restrict = (imports?: WasmImports): void => {
  const env = imports?.env;
  if (!env) return;
  if (typeof env._emscripten_system === 'function') {
   // Emscripten libc converts the negative errno to system() == -1 / ENOSYS.
   env._emscripten_system = (command: number) => command === 0 ? 0 : -52;
   protectedSystem = true;
  }
  if (typeof env.__syscall_socket === 'function') protectedSockets = true;
  for (const name of ['__syscall_socket', '__syscall_connect', '__syscall_bind', '__syscall_listen', '__syscall_accept4', '__syscall_sendto', '__syscall_sendmsg', '_maybe_connect_async']) {
   if (typeof env[name] === 'function') env[name] = () => -52;
  }
 };
 wasm.instantiate = ((source: unknown, imports?: WasmImports) => {
  restrict(imports);
  return instantiate(source, imports);
 });
 if (instantiateStreaming) wasm.instantiateStreaming = (source, imports) => {
  restrict(imports);
  return instantiateStreaming(source, imports);
 };
 try {
  const runtime = await load();
  if (!protectedSystem || !protectedSockets) throw new PythonFailure('runtime-abi', { cause: new Error('Python native syscall isolation ABI unavailable') });
  // Public convenience APIs otherwise expose direct host FS/socket bindings via pyodide_js.
  const unavailable = () => { throw new Error('Host filesystem and native socket capabilities are unavailable'); };
  const api = runtime as unknown as Record<string, unknown>;
  for (const name of ['mountNodeFS', 'mountNativeFS', 'useNodeSockFS']) {
   if (name in api) api[name] = unavailable;
  }
  if (runtime.FS?.filesystems) delete runtime.FS.filesystems.NODEFS;
  if (runtime._module) {
   delete runtime._module.NODEFS;
   if ('__emscripten_system' in runtime._module) runtime._module.__emscripten_system = (command: number) => command === 0 ? 0 : -52;
   if (runtime._module.SOCKFS) runtime._module.SOCKFS.createSocket = unavailable;
  }
  return runtime;
 } finally {
  wasm.instantiate = instantiate;
  if (instantiateStreaming) wasm.instantiateStreaming = instantiateStreaming;
 }
}

/** Run inside a dedicated interpreter worker. Backend requests must run elsewhere. */
export async function runPythonWorker(options: {
  loadRuntime(configuration: {jsglobals: Record<string, never>; args: string[]; env: Record<string, string>; stdout(message: string): void; stderr(message: string): void}): Promise<PythonWorkerRuntime>;
  start: PythonWorkerStart;
  postMessage(message: unknown): void;
}): Promise<void> {
  const {start} = options;
  const postMessage = (message: unknown): void => {
    try { options.postMessage(message); }
    catch (cause) { throw new PythonFailure('transport-unavailable', { cause }); }
  };
  let category: PythonFailureCategory = 'startup';
  try {
    const startupRequest = createPythonWorkerRequest(start.shared, postMessage, code => new Error(code));
    const startupWrite = (stream: string, message: string) => {
      const bytes = new TextEncoder().encode(message + '\n');
      for (let offset = 0; offset < bytes.length; offset += start.maxTransferBytes) {
        startupRequest(stream, Array.from(bytes.subarray(offset, offset + start.maxTransferBytes)));
      }
    };
    let configuration;
    try { configuration = parsePythonInvocation(start.invocation.args, start.invocation.env); }
    catch (error) {
      startupWrite('stderr', 'python: ' + (error instanceof Error ? error.message : String(error)));
      postMessage({type:'exit', exitCode:2});
      return;
    }
    // Removes accidental `import js` access to process/fetch/globalThis. This is
    // defense in depth, not a sandbox: Python JS proxies can recover JS execution.
    category = 'runtime-assets';
    const runtime = await loadPythonRuntime(() => options.loadRuntime({jsglobals: Object.create(null) as Record<string, never>, args:[...configuration.startupArgs], env:{...configuration.env},
      stdout: message => { startupWrite('stdout', message); },
      stderr: message => { startupWrite('stderr', message); },
    }));
    // Namespace relocation is qualified against this ABI only.
    if (runtime.version !== '314.0.6') throw new PythonFailure('runtime-abi', { cause: new Error('Python worker requires Pyodide 314.0.6') });
    if (start.packages) await installPythonPackages(runtime, start.packages, startupRequest, start.maxTransferBytes);
    const unavailablePackage = () => { throw new Error('Python package transport is only available during installation'); };
    const publicRuntime = runtime as unknown as Record<string, any>;
    if ('loadPackage' in publicRuntime) publicRuntime.loadPackage = unavailablePackage;
    if (publicRuntime._api?.packageManager) publicRuntime._api.packageManager.downloadPackage = unavailablePackage;
    if (start.installOnly) {
      startupWrite('stdout', 'Successfully installed requested Python packages');
      postMessage({type:'exit', exitCode:0});
      return;
    }
    category = 'runtime-abi';
    const errno: Record<string, number> = JSON.parse(runtime.runPython("__import__('json').dumps({k:v for k,v in vars(__import__('errno')).items() if k.startswith('E') and isinstance(v,int)})"));
    const request = createPythonWorkerRequest(start.shared, postMessage, code => new runtime.FS.ErrnoError(errno[code] ?? errno.EIO));
    const libraries = runtime._module?.LDSO?.loadedLibsByName;
    if (!libraries) throw new Error('Python runtime native loader ABI unavailable');
    if (typeof runtime._module._Py_FinalizeEx !== 'function') throw new Error('Python runtime finalization ABI unavailable');
    // Preload relocation helpers before application root replaces bootstrap paths.
    runtime.runPython('import sys, zipimport, importlib.machinery, json, os, runpy, traceback');
    runtime.setStdin({read(buffer) {
      const bytes = request('stdin', Math.min(buffer.length, start.maxTransferBytes));
      if (!Array.isArray(bytes) || bytes.length > buffer.length) throw new runtime.FS.ErrnoError(errno.EIO);
      buffer.set(bytes); return bytes.length;
    }});
    for (const [name, configure] of [
      ['stdout', runtime.setStdout.bind(runtime)], ['stderr', runtime.setStderr.bind(runtime)],
    ] as const) {
      configure({write(buffer) {
        let offset = 0;
        while (offset < buffer.length) {
          const chunk = Array.from(Uint8Array.from(buffer.subarray(offset, offset + start.maxTransferBytes)));
          try { request(name, chunk); } catch (error) { if (offset) return offset; throw error; }
          offset += chunk.length;
        }
        return offset;
      }});
    }
    mountPythonFileSystem(runtime.FS, {
      request, cwd: start.invocation.cwd, runtimeMount: start.runtimeMount,
      maxTransferBytes: start.maxTransferBytes, errno, runtimeModule: runtime._module,
      synchronizationFlags: runtime.runPython("__import__('os').O_SYNC | __import__('os').O_DSYNC"),
    });
    for (const [name, library] of Object.entries(libraries)) {
      if (name.startsWith('/lib/')) libraries[start.runtimeMount + name] = library;
    }
    runtime.globals.set('_safe_runtime_mount', start.runtimeMount);
    runtime.runPython(pythonRuntimeRelocation);
    // Importlib needs only type, modification time and size. Its internal stat
    // consumer must not force fabrication of optional POSIX metadata in os.stat.
    runtime.globals.set('_safe_import_stat', (path: string) => {
      try {
        const stat = runtime.FS.stat(path);
        return JSON.stringify({mode:stat.mode, size:stat.size, mtimeMs:stat.mtimeMs ?? stat.mtime.getTime()});
      } catch (error) {
        return JSON.stringify({errno:(error as {errno?:number}).errno ?? errno.EIO});
      }
    });
    runtime.runPython(pythonImportMetadata);
    runtime.globals.set('_safe_directory_entries', (path: string) => {
      try { return JSON.stringify({entries:runtime.FS.readdir(path).filter((name: string) => name !== '.' && name !== '..')}); }
      catch (error) { return JSON.stringify({errno:(error as {errno?:number}).errno ?? errno.EIO}); }
    });
    runtime.runPython(pythonDirectoryEntries);
    runtime.globals.set('_safe_stat_projection', (path: string | number, follow: boolean) => {
      try {
        const value = typeof path === 'number' ? runtime.FS.fstat(path) : follow ? runtime.FS.stat(path) : runtime.FS.lstat(path);
        return JSON.stringify({mode:value.mode, ino:value.ino, dev:value.dev, nlink:value.nlink,
          uid:value.uid, gid:value.gid, size:value.size,
          atimeMs:value.atimeMs ?? value.atime.getTime(), mtimeMs:value.mtimeMs ?? value.mtime.getTime(),
          ctimeMs:value.ctimeMs ?? value.ctime.getTime(), blocks:value.blocks, blksize:value.blksize, rdev:value.rdev});
      } catch (error) { return JSON.stringify({errno:(error as {errno?:number}).errno ?? errno.EIO}); }
    });
    runtime.runPython(pythonStatProjection);
    runtime.globals.set('_safe_tree_cleanup', (path: string) => {
      const absolute = path.startsWith('/') ? path : `${runtime.FS.cwd()}/${path}`;
      if (absolute === start.runtimeMount || absolute.startsWith(start.runtimeMount + '/')) return JSON.stringify({ supported: false });
      try {
        if (!request('rmtreeSupported', absolute)) return JSON.stringify({ supported: false });
        request('rmtree', absolute);
        return JSON.stringify({ supported: true });
      } catch (error) { return JSON.stringify({ supported: true, errno: (error as { errno?: number }).errno ?? errno.EIO }); }
    });
    runtime.runPython(pythonTreeCleanup);
    runtime.globals.set('_safe_invocation_json', JSON.stringify(start.invocation));
    postMessage({type:'ready'});
    category = 'runtime';
    const exitCode = runtime.runPython(pythonExecution);
    // Finalize CPython while canonical storage and stream RPC remain live.
    // This runs atexit and releases buffered files retained by guest modules.
    const finalized = runtime._module._Py_FinalizeEx();
    postMessage({type:'exit', exitCode: finalized < 0 ? 120 : Number(exitCode) & 255});
  } catch (error) {
    postMessage({type:'error', category: error instanceof PythonFailure ? error.category : category,
      message: String(error instanceof PythonFailure && error.cause !== undefined ? error.cause : error)});
  }
}
