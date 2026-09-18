import { PythonFileSystem, PythonStatTranslator, type FileStat } from '@poe-code/safe-fs/core';
import type { CommandContext, CommandDefinition, VirtualShellPlugin } from '../../contracts/index.js';
import { validateExitCode } from '../../contracts/command.js';
import { openCommandFile } from '../../contracts/filesystem-descriptor.js';
import { encodePythonReply } from './reply.js';
import { parsePythonInvocation, PythonInvocationError } from './invocation.js';
import { parsePythonInstallation, pythonInstallationHelp } from './installation.js';
import { createPythonPackageEnvironment, pythonDocumentPackages, type PythonPackageOptions, type PythonPackageStart, type PythonPackageEnvironment } from './provisioning.js';
import { readBytes, writeBytes } from '../../contracts/io.js';
import { createOutputOperation, type OutputOperation } from '../../contracts/output.js';
import { inheritYieldCheckpoint, yieldTurn } from '../../contracts/yield.js';
import { PythonFailure, isPythonFailureCategory, reportPythonFailure, type PythonDiagnosticObserver, type PythonFailureCategory } from './diagnostics.js';

class PythonInputChunkError extends RangeError {}

/** A dedicated interpreter worker. The service event loop must never block. */
export interface PythonWorkerEndpoint {
  postMessage(value: unknown): void;
  subscribe(listener: (value: unknown) => void, onError: (error: unknown) => void): () => void;
  terminate(): void | Promise<void>;
}
export interface PythonInitializationProgress {
  readonly phase: 'initializing' | 'ready' | 'finished';
  readonly command: string;
}
export interface PythonCommandsOptions {
  readonly createWorker?: () => PythonWorkerEndpoint;
  readonly createExecutor?: () => PythonAsyncExecutor;
  /** Explicit distribution requirements; no import scanning or implicit package downloads. */
  readonly packages?: readonly string[];
  /** Requirements files in the canonical filesystem. */
  readonly requirements?: readonly string[];
  readonly packageProfile?: 'documents';
  readonly provisioning?: PythonPackageOptions;
  readonly environment?: PythonPackageEnvironment;
  /** Host UI lifecycle; never written to guest stdout/stderr. */
  readonly onProgress?: (event: PythonInitializationProgress) => void;
  readonly onDiagnostic?: PythonDiagnosticObserver;
  readonly runtimeMount?: string;
  readonly maxTransferBytes?: number;
  readonly maxOpenFiles?: number;
  /** Fail immediately at capacity; queued pipeline stages can deadlock. Shared by both aliases. */
  readonly maxConcurrentWorkers?: number;
  /** Largest upstream stdin fragment retained by the bridge, independent of transfer size. */
  readonly maxInputChunkBytes?: number;
  readonly replace?: boolean;
}
export interface PythonWorkerStart {
  readonly type: 'start';
  readonly packages?: PythonPackageStart;
  readonly installOnly?: boolean;
  readonly shared: SharedArrayBuffer;
  readonly invocation: { readonly command?: string; readonly args: readonly string[]; readonly cwd: string; readonly env: Readonly<Record<string, string>> };
  readonly runtimeMount: string;
  readonly maxTransferBytes: number;
}

export interface PythonExecutorStart extends Omit<PythonWorkerStart, 'type' | 'shared'> {
  readonly signal: AbortSignal;
  dispatch(request: { readonly op: string; readonly args: unknown[] }): Promise<unknown>;
  onReady(): void;
}

export interface PythonAsyncExecutor {
  run(start: PythonExecutorStart): Promise<number>;
  terminate(): void | Promise<void>;
}

export function createPythonCommands(options: PythonCommandsOptions): readonly CommandDefinition[] {
  if (!options || (typeof options.createWorker === 'function') === (typeof options.createExecutor === 'function')
    || options.createWorker !== undefined && typeof options.createWorker !== 'function'
    || options.createExecutor !== undefined && typeof options.createExecutor !== 'function') throw new PythonFailure('executor-unavailable');
  if (options.onDiagnostic !== undefined && typeof options.onDiagnostic !== 'function') throw new TypeError('Python onDiagnostic must be a function');
  if (options.environment && options.provisioning) throw new TypeError('A borrowed Python environment cannot be combined with provisioning options');
  const maxTransferBytes = options.maxTransferBytes ?? 65536;
  const maxOpenFiles = options.maxOpenFiles ?? 256;
  const maxConcurrentWorkers = options.maxConcurrentWorkers ?? 4;
  const maxInputChunkBytes = options.maxInputChunkBytes ?? 1048576;
  if (!Number.isSafeInteger(maxConcurrentWorkers) || maxConcurrentWorkers < 1 || maxConcurrentWorkers > 64) throw new RangeError('Invalid Python worker concurrency limit');
  if (!Number.isSafeInteger(maxInputChunkBytes) || maxInputChunkBytes < 1 || maxInputChunkBytes > 16777216) throw new RangeError('Invalid Python input chunk limit');
  let activeWorkers = 0;
  for (const size of [maxTransferBytes, maxOpenFiles]) if (!Number.isSafeInteger(size) || size < 1 || size > 1048576) throw new RangeError('Invalid Python resource limit');
  const runtimeMount = options.runtimeMount ?? '/.pyodide-runtime';
  if (!runtimeMount.startsWith('/') || runtimeMount === '/' || runtimeMount.slice(1).includes('/') || runtimeMount.includes('\0') || runtimeMount.split('/').some(part => part === '..' || part === '.')) throw new TypeError('Python runtime mount must be an absolute top-level canonical path');
  const environment = options.environment ?? createPythonPackageEnvironment(options.provisioning);
  const execute = async (context: CommandContext) => {
    let installation;
    try {
      parsePythonInvocation(context.args, context.env);
      installation = parsePythonInstallation(context.args);
    } catch (error) {
      if (!(error instanceof PythonInvocationError)) throw error;
      await writeBytes(context.stderr, new TextEncoder().encode('python: ' + error.message + '\n'), context.signal);
      return { exitCode: 2 };
    }
    if (installation?.help) {
      await writeBytes(context.stdout, new TextEncoder().encode(pythonInstallationHelp), context.signal);
      return { exitCode: 0 };
    }
    context.signal.throwIfAborted();
    if (activeWorkers >= maxConcurrentWorkers) {
      const failure = reportPythonFailure('capacity', undefined, options.onDiagnostic);
      await writeBytes(context.stderr, new TextEncoder().encode('python: ' + failure.message + '\n'), context.signal);
      return { exitCode: 1 };
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([context.signal, controller.signal]);
    inheritYieldCheckpoint(context.signal, signal);
    // The service is the single registered owner of descriptors and late acquisition.
    const fileContext = { ...context, descriptorCleanup: "caller" as const };
    const metadata = new PythonStatTranslator();
    const service = new PythonFileSystem(context.fs, { cwd: context.cwd, signal, maxTransferBytes, maxOpenFiles,
      open: (path, settings) => openCommandFile(fileContext, path, settings) });
    let stdoutOperation: OutputOperation | undefined;
    let stderrOperation: OutputOperation | undefined;
    let endpoint: PythonWorkerEndpoint | undefined;
    let executor: PythonAsyncExecutor | undefined;
    let packages: PythonPackageStart | undefined;
    let unsubscribe: (() => void) | undefined;
    let admitted = false;
    let closed = false;
    let closing: Promise<void> | undefined;
    const pending = new Set<Promise<void>>();
    const input = readBytes(context.stdin, signal)[Symbol.asyncIterator]();
    let fragment: Uint8Array | undefined;
    let offset = 0;
    let inputBytes = 0;
    let rejectRun!: (reason: unknown) => void;
    const close = (): Promise<void> => {
      if (closing) return closing;
      let finish!: () => void;
      let fail!: (reason: unknown) => void;
      closing = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
      closed = true;
      controller.abort(new Error('Python invocation retired'));
      void (async () => {
        signal.removeEventListener('abort', aborted);
        const subscription = Promise.resolve().then(() => unsubscribe?.());
        const termination = Promise.resolve().then(() => executor ? executor.terminate() : endpoint?.terminate());
        const filesystemRetirement = termination.finally(() => service.close());
        const results = await Promise.allSettled([subscription, termination, filesystemRetirement, stdoutOperation?.close(), stderrOperation?.close(), ...pending]);
        await input.return?.(undefined);
        fragment = undefined;
        if (packages) environment.finish(packages);
        for (const result of results) if (result.status === 'rejected') throw result.reason;
      })().then(() => {
        if (admitted) { activeWorkers--; admitted = false; }
        finish();
      }, reason => {
        // A failed termination cannot establish retirement: retain its capacity slot.
        fail(reportPythonFailure('cleanup', reason, options.onDiagnostic));
      });
      return closing;
    };
    const aborted = (): void => { rejectRun?.(signal.reason); };
    context.registerCleanup?.(close);
    let primary: { reason: unknown } | undefined;
    let ready = false;
    const filesystemDiagnostics = new Set<PythonFailureCategory>();
    let result = 1;
    try {
      signal.throwIfAborted();
      activeWorkers++;
      admitted = true;
      const outputContext = { signal, ...(context.registerCleanup ? { registerCleanup: context.registerCleanup } : {}) };
      stdoutOperation = createOutputOperation(outputContext, context.stdout);
      stderrOperation = createOutputOperation(outputContext, context.stderr);
      const diagnoseFilesystemFailure = async (operation: string, error: unknown): Promise<void> => {
        if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOTSUP') return;
        const category: PythonFailureCategory = operation === 'open' ? 'filesystem-open'
          : operation === 'read' ? 'filesystem-read'
            : operation === 'write' || operation === 'ftruncate' ? 'filesystem-write'
              : operation === 'readdir' ? 'filesystem-directory' : 'filesystem-operation';
        if (!filesystemDiagnostics.has(category)) {
          filesystemDiagnostics.add(category);
          const failure = reportPythonFailure(category, error, options.onDiagnostic);
          await writeBytes(stderrOperation!.output, new TextEncoder().encode('python: ' + failure.message + '\n'), signal);
        }
      };
      const dispatch = async (request: { op: string; args: unknown[] }): Promise<unknown> => {
        if (request.op === 'close') return service.dispatch(request);
        signal.throwIfAborted();
        if (request.op.startsWith('package-')) return environment.dispatch(request.op, request.args, {fs:context.fs, cwd:context.cwd, signal});
        if (request.op === 'stdin') {
          const length = request.args[0];
          if (!Number.isSafeInteger(length) || (length as number) < 1 || (length as number) > maxTransferBytes) throw new RangeError('Invalid Python input request');
          let pulls = 0;
          while (!fragment || offset === fragment.length) {
            if (++pulls % 128 === 0) await yieldTurn(signal);
            const next = await input.next();
            if (next.done) return [];
            inputBytes += next.value.length;
            context.inputBudget?.check(inputBytes);
            if (next.value.length > maxInputChunkBytes) throw new PythonInputChunkError('Python input chunk exceeds maxInputChunkBytes');
            // The retained fragment owns its bytes before producer advancement/finalization.
            fragment = Uint8Array.from(next.value);
            offset = 0;
          }
          const end = Math.min(fragment.length, offset + (length as number));
          const bytes = Array.from(fragment.subarray(offset, end));
          offset = end;
          return bytes;
        }
        if (request.op === 'stdout' || request.op === 'stderr') {
          const bytes = request.args[0];
          if (!Array.isArray(bytes) || bytes.length > maxTransferBytes || bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw new TypeError('Invalid Python output bytes');
          const operation = request.op === 'stdout' ? stdoutOperation! : stderrOperation!;
          await writeBytes(operation.output, Uint8Array.from(bytes), signal);
          return bytes.length;
        }
        const value = await service.dispatch(request);
        return request.op === 'stat' || request.op === 'lstat' || request.op === 'fstat'
          ? metadata.translate(value as FileStat) : value;
      };
      options.onProgress?.({ phase: 'initializing', command: context.command });
      const preparation = environment.prepare({ fs: context.fs, cwd: context.cwd, signal,
        requirements: [...(options.packages ?? []), ...(options.packageProfile ? pythonDocumentPackages : []), ...(installation?.packages ?? [])],
        requirementFiles: [...(options.requirements ?? []), ...(installation?.requirements ?? [])],
      }).then(value => { packages = value; });
      pending.add(preparation);
      try { await preparation; } finally { pending.delete(preparation); }
      signal.throwIfAborted();
      if (options.createExecutor) {
        try { executor = options.createExecutor(); }
        catch (reason) { throw reportPythonFailure(reason instanceof PythonFailure ? reason.category : 'startup', reason, options.onDiagnostic); }
        if (!executor || typeof executor.run !== 'function' || typeof executor.terminate !== 'function') throw reportPythonFailure('executor-unavailable', undefined, options.onDiagnostic);
        let requesting = false;
        let running = true;
        const start: PythonExecutorStart = {
          invocation: { command: context.command, args: [...context.args], cwd: context.cwd, env: { ...context.env } },
          runtimeMount, maxTransferBytes, signal, ...(packages ? { packages } : {}), installOnly: !!installation,
          onReady() {
            if (closed || !running || signal.aborted || ready) return;
            ready = true;
            try { options.onProgress?.({ phase: 'ready', command: context.command }); }
            catch (reason) { running = false; rejectRun?.(reason); throw reason; }
          },
          async dispatch(request) {
            if (!request || typeof request.op !== 'string' || !Array.isArray(request.args)) throw reportPythonFailure('transport-unavailable', undefined, options.onDiagnostic);
            const releasing = request.op === 'close';
            if (!releasing) signal.throwIfAborted();
            if (closed && !releasing || !running || requesting) throw reportPythonFailure('transport-unavailable', undefined, options.onDiagnostic);
            requesting = true;
            const operation = Promise.resolve().then(() => dispatch(request)).catch(async error => {
              if (releasing) throw error;
              signal.throwIfAborted();
              if (error instanceof PythonInputChunkError) rejectRun?.(error);
              if (request.op.startsWith('package-')) throw Object.assign(reportPythonFailure('runtime-assets', error, options.onDiagnostic), { code: 'EPACKAGE' });
              await diagnoseFilesystemFailure(request.op, error);
              throw error;
            });
            const tracked = operation.then(() => {}, () => {});
            pending.add(tracked);
            try { return await operation; }
            finally { requesting = false; pending.delete(tracked); }
          },
        };
        const execution = Promise.resolve().then(() => {
          signal.throwIfAborted();
          return executor!.run(start);
        }).catch(reason => {
          running = false;
          if (signal.aborted) throw signal.reason;
          throw reportPythonFailure(reason instanceof PythonFailure ? reason.category : ready ? 'runtime' : 'startup', reason, options.onDiagnostic);
        }).then(status => {
          running = false;
          if (requesting) throw reportPythonFailure('transport-unavailable', undefined, options.onDiagnostic);
          try { return validateExitCode(status); }
          catch (reason) { throw reportPythonFailure('transport-unavailable', reason, options.onDiagnostic); }
        });
        const tracked = execution.then(() => {}, () => {});
        pending.add(tracked);
        void tracked.then(() => pending.delete(tracked));
        result = await new Promise<number>((resolve, reject) => {
          rejectRun = reject;
          signal.addEventListener('abort', aborted, { once: true });
          if (signal.aborted) aborted();
          execution.then(resolve, reject);
        });
      } else {
      let shared: SharedArrayBuffer;
      try { shared = new SharedArrayBuffer(8 + maxTransferBytes * 6 + 65536); }
      catch (reason) { throw reportPythonFailure('transport-unavailable', reason, options.onDiagnostic); }
      const control = new Int32Array(shared, 0, 2);
      const payload = new Uint8Array(shared, 8);
      const reply = (value: unknown, status: number): void => {
        if (closed) return;
        let bytes: Uint8Array;
        try { bytes = encodePythonReply(value, payload.length); }
        catch (error) {
          if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'EFBIG') throw error;
          bytes = encodePythonReply({ code: 'EFBIG' }, payload.length); status = 2;
        }
        payload.set(bytes);
        try {
          Atomics.store(control, 1, bytes.length);
          Atomics.store(control, 0, status);
          Atomics.notify(control, 0);
        } catch (reason) { throw reportPythonFailure('transport-unavailable', reason, options.onDiagnostic); }
      };
      try { endpoint = options.createWorker!(); }
      catch (reason) { throw reportPythonFailure(reason instanceof PythonFailure ? reason.category : 'startup', reason, options.onDiagnostic); }
      signal.throwIfAborted();
      result = await new Promise<number>((resolve, reject) => {
        let settled = false;
        const fail = (reason: unknown): void => { settled = true; reject(reason); };
        rejectRun = fail;
        signal.addEventListener('abort', aborted, { once: true });
        const transportFailure = (reason: unknown): void => { fail(reportPythonFailure('transport-unavailable', reason, options.onDiagnostic)); };
        try { unsubscribe = endpoint!.subscribe(value => {
          if (closed || settled) return;
          if (typeof value !== 'object' || value === null) { transportFailure(new TypeError('Invalid Python worker message')); return; }
          const message = value as Record<string, unknown>;
          if (message.type === 'ready') {
            ready = true;
            try { options.onProgress?.({ phase: 'ready', command: context.command }); }
            catch (error) { fail(error); }
            return;
          }
          if (message.type === 'exit') {
            if (pending.size) { transportFailure(new TypeError('Python worker exited with an outstanding request')); return; }
            try {
              const status = validateExitCode(message.exitCode as number);
              settled = true;
              resolve(status);
            } catch (error) { transportFailure(error); }
            return;
          }
          if (message.type === 'error') {
            fail(reportPythonFailure(isPythonFailureCategory(message.category) ? message.category : ready ? 'runtime' : 'startup', message.message, options.onDiagnostic));
            return;
          }
          if (typeof message.op !== 'string' || !Array.isArray(message.args) || pending.size) { transportFailure(new TypeError('Invalid concurrent Python worker request')); return; }
          const work = dispatch({ op: message.op, args: message.args }).then(
            value => { pending.delete(work); reply(value, 1); },
            async error => {
              if (signal.aborted) { pending.delete(work); fail(signal.reason); return; }
              if (typeof message.op === 'string' && message.op.startsWith('package-')) {
                const failure = reportPythonFailure('runtime-assets', error, options.onDiagnostic);
                pending.delete(work);
                reply({code:'EPACKAGE', message:failure.message}, 2);
                return;
              }
              if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') { pending.delete(work); fail(error); return; }
              await diagnoseFilesystemFailure(message.op as string, error);
              pending.delete(work);
              reply({ code: error.code }, 2);
            },
          );
          pending.add(work);
          void work.catch(reason => { pending.delete(work); fail(reason); });
        }, transportFailure); }
        catch (reason) { transportFailure(reason); }
        if (settled) return;
        const start: PythonWorkerStart = { type: 'start', shared, invocation: { command: context.command, args: [...context.args], cwd: context.cwd, env: { ...context.env } }, runtimeMount, maxTransferBytes, ...(packages ? {packages} : {}), installOnly: !!installation };
        signal.throwIfAborted();
        try { endpoint!.postMessage(start); }
        catch (reason) { transportFailure(reason); }
      });
      }
    } catch (reason) {
      if (!signal.aborted && reason instanceof PythonInputChunkError) {
        try { await writeBytes(stderrOperation!.output, new TextEncoder().encode('python: ' + reason.message + '\n'), signal); }
        catch (error) { primary = {reason:error}; }
      } else if (!signal.aborted && typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'EPACKAGE') {
        primary = { reason: reportPythonFailure('runtime-assets', reason, options.onDiagnostic) };
      } else primary = { reason };
    }
    try { await close(); } catch (reason) {
      primary ??= { reason };
    }
    try { options.onProgress?.({ phase: 'finished', command: context.command }); }
    catch (reason) { primary ??= { reason }; }
    context.signal.throwIfAborted();
    if (primary) {
      if (!(primary.reason instanceof PythonFailure)) throw primary.reason;
      const failure = primary.reason;
      await writeBytes(context.stderr, new TextEncoder().encode('python: ' + failure.message + '\n'), context.signal);
      return { exitCode: 1 };
    }
    return { exitCode: result };
  };
  return ['python', 'python3'].map(name => ({ name, description: 'Python with an explicit interpreter executor and canonical filesystem', execute }));
}

export function pythonCommands(options: PythonCommandsOptions): VirtualShellPlugin {
  if (!options || (typeof options.createWorker === 'function') === (typeof options.createExecutor === 'function')) throw new PythonFailure('executor-unavailable');
  if (options?.environment && options.provisioning) throw new TypeError('A borrowed Python environment cannot be combined with provisioning options');
  const { provisioning, ...configuration } = options;
  const environment = options.environment ?? createPythonPackageEnvironment(provisioning);
  const commands = createPythonCommands({ ...configuration, environment });
  return { name: 'python-commands', ...(options.environment ? {} : { dispose: environment.dispose }), setup(host) {
    if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}

export { createPythonPackageEnvironment, pythonDocumentPackages } from './provisioning.js';
export type { PythonPackageOptions, PythonPackageCache, PythonPackageProgress, PythonPackageStart, PythonPackageContext, PythonPackageEnvironment, PythonPackagePrepareContext } from './provisioning.js';
export { PythonPackageConflictError, createPythonPackageManifestStore } from './manifest.js';
export type { PythonPackageManifest, PythonPackageManifestStore } from './manifest.js';
export { createPythonPackageCache } from './cache.js';
export { createPythonExecutorPool } from './executor-pool.js';
export type { PythonExecutorPool, PythonExecutorPoolOptions } from './executor-pool.js';
export { PythonFailure, inspectPythonCapabilities } from './diagnostics.js';
export type { PythonFailureCategory, PythonDiagnostic, PythonDiagnosticObserver, PythonFileSystemRequirement, PythonCapabilityOptions, PythonCapabilityReport } from './diagnostics.js';
