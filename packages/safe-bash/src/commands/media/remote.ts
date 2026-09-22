import { createClient, type BinaryFrame } from '@poe-code/remote-execution';
import { validateCallbackResult } from '@poe-code/remote-execution/protocol';
import type { Binding, CallbackResult, ChannelOpen, Control, Descriptor, Grant, Input, Limits } from '@poe-code/remote-execution/wire';
import { readBytes } from '@poe-code/safe-fs/core';
import type { CommandContext } from 'safe-bash-contracts/command';
import type { VirtualShellPlugin } from 'safe-bash-contracts/plugin';
import { mediaCommands } from './plugin.js';
import { grammarRevision, nativeReference } from '@poe-code/media-cli';
import { imageMagickGrammarRevision, imageMagickReference } from '@poe-code/media-cli';
import type { MediaEngineRequest } from '@poe-code/media-cli';
import { mediaFrontendContract } from '@poe-code/media-cli';

export { mediaFrontendContract };

export interface RemoteMediaControlContext {
  readonly signal: AbortSignal;
  /** Answer only the callback currently delivered to this invocation's handler.
   * The adapter retains session credentials, job identity and cleanup ownership. */
  respond(result: CallbackResult): Promise<CallbackResult>;
}

export interface RemoteMediaOptions {
  /** Use the shell registry's explicit replacement policy (default false). */
  readonly replace?: boolean;
  readonly service: string;
  readonly authToken: string;
  readonly buildDigest: string;
  readonly resource: Binding;
  readonly limits?: Limits;
  /** Explicit trusted provider, loaded only on media invocation.
   * The module exports createMediaProvider(settings). */
  readonly provider?: { readonly module: string; readonly options?: unknown };
  /** Inject a provider transport without changing native argv. */
  readonly fetch?: typeof globalThis.fetch;
  /** Explicit remote descriptor bindings, established by the trusted host. */
  readonly descriptors?: readonly Descriptor[];
  readonly grants?: readonly Grant[];
  readonly stdin?: Input;
  readonly onControl?: (control: Control, context: CommandContext, remote: RemoteMediaControlContext) => Promise<void>;
  /** Bind an authenticated, invocation-owned output channel before consuming it.
   * The returned sink is borrowed; remote END never closes the host destination.
   * Seekable access must use retained file callbacks rather than this byte stream. */
  readonly onOutputChannel?: (channel: ChannelOpen, context: CommandContext) => Promise<Pick<CommandContext['stdout'], 'write' | 'ownedOutput'>>;
  readonly onProgress?: (event: { direction: 'upload' | 'download'; bytes: number }) => void | Promise<void>;
  /** Host-qualified shell status projection for actual signal-only termination.
   * Native explicit exit codes never pass through this projection. */
  readonly signalStatus?: (name: string, number: number) => number;
}

export type MediaProviderSettings = Omit<RemoteMediaOptions, 'provider'> & { readonly providerOptions?: unknown };
export interface MediaProviderRuntime {
  readonly fetch: typeof globalThis.fetch;
  /** Optional existing remote engine: retains the entire scoped descriptor,
   * filesystem, environment, stream and cleanup context. Must execute only on
   * the verified remote build; no host process fallback is admitted. */
  execute?(request: MediaEngineRequest): Promise<{ exitCode: number }>;
  dispose?(): Promise<void>;
}

/** Connect only on explicit media invocation; server resource authority stays
 * server-owned. Local discovery supplies advisory transfer hints only. */
export function createRemoteMediaCommands(options: RemoteMediaOptions): VirtualShellPlugin & { dispose(): Promise<void> } {
  if (!options.service || !options.authToken || !options.buildDigest || !options.resource) throw new TypeError('Explicit media service/auth/build/resource configuration required');
  options = { ...options,
    resource: structuredClone(options.resource),
    ...(options.provider ? { provider: structuredClone(options.provider) } : {}),
    ...(options.limits ? { limits: structuredClone(options.limits) } : {}),
    ...(options.grants ? { grants: structuredClone(options.grants) } : {}),
    ...(options.descriptors ? { descriptors: structuredClone(options.descriptors) } : {}),
    ...(options.stdin ? { stdin: structuredClone(options.stdin) } : {}),
  };
  const resource = structuredClone(options.resource);
  let provider: Promise<MediaProviderRuntime> | undefined;
  const transport: typeof globalThis.fetch = async (input, init) => {
    if (!options.provider) return (options.fetch ?? globalThis.fetch)(input, init);
    provider ??= import(options.provider.module).then(async module => {
      if (typeof module.createMediaProvider !== 'function') throw new TypeError('Media provider must export createMediaProvider(settings)');
      const { provider: configuration, ...settings } = options;
      const runtime: MediaProviderRuntime = await module.createMediaProvider({ ...settings, providerOptions: configuration!.options });
      if (!runtime || typeof runtime.fetch !== 'function' || (runtime.execute !== undefined && typeof runtime.execute !== 'function')) throw new TypeError('Media provider must return a Fetch transport and optional remote engine');
      return runtime;
    });
    return (await provider).fetch(input, init);
  };
  async function run(invocation: { tool: string; argv: readonly Uint8Array[]; discovery: NonNullable<MediaEngineRequest['discovery']>; context: CommandContext }) {
    // Each invocation owns credential/data admission. Input and output must
    // progress together, with a third slot for independent process control.
    // Input frame sends remain serialized on their single ordered lane below.
    const client = createClient({ baseUrl: options.service, token: async () => options.authToken,
      fetch: transport, maxConcurrentUploads: 3 });
    const context = invocation.context;
    const controller = new AbortController();
    const signal = AbortSignal.any([context.signal, controller.signal]);
    const inputController = new AbortController();
    const inputSignal = AbortSignal.any([signal, inputController.signal]);
    let session: Awaited<ReturnType<typeof client.openSession>> | undefined;
    let job: Awaited<ReturnType<typeof client.submitJob>> | undefined;
    let cleanup: Promise<void> | undefined;
    let acquisition: Promise<unknown> | undefined;
    let processExited = false;
    let primaryFailed = false;
    let finalization: Promise<void> | undefined;
    let unsubscribe: ReturnType<NonNullable<CommandContext['processSignals']>['subscribe']> | undefined;
    let cleanupAdmission = true;
    const ownedCleanups: (() => Promise<void>)[] = [];
    const leases = new Map<number, Awaited<ReturnType<NonNullable<CommandContext['admittedHandles']>['acquire']>>>();
    const work = new Set<Promise<unknown>>();
    const close = () => cleanup ??= (async () => {
      cleanupAdmission = false;
      controller.abort(new Error('Media invocation finalized'));
      await acquisition?.catch(() => {});
      const retirement = Promise.resolve().then(() => unsubscribe?.());
      // Provider resources belong to this invocation even when the borrowed
      // shell context has no registrar. Start retirement before waiting for
      // execution: a cooperative cleanup can release a blocked dependency.
      // Both barriers drain before remote session release or public settlement.
      const retired = Promise.allSettled(ownedCleanups.map(close => Promise.resolve().then(close)));
      const results = await Promise.allSettled([...work, retirement]);
      const failures: unknown[] = (await retired).filter(result => result.status === 'rejected').map(result => result.reason);
      if (job && session) {
        try {
          const canceled = await client.cancelJob(session, job.jobId, { reason: 'Media invocation finalized' }, crypto.randomUUID());
          if (canceled.outcome?.kind === 'unknown' || canceled.cleanup === 'unknown') throw new Error('Remote termination could not be confirmed');
        } catch (cause) { failures.push(cause); }
      }
      const releases = await Promise.allSettled([
        ...Array.from(leases.values(), lease => Promise.resolve().then(() => lease.close())),
        ...(session ? [client.closeSession(session, crypto.randomUUID())] : []), retirement,
      ]);
      for (const result of releases) if (result.status === 'rejected') failures.push(result.reason);
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, 'Media invocation cleanup failed');
      // Stream failures are reported by the primary invocation, after cleanup.
      void results;
    })();
    const finalize = () => finalization ??= (async () => {
      try { await close(); }
      catch (cause) {
        if (!primaryFailed) throw cause;
        // Cleanup diagnostics must not replace the original stream/cancellation
        // failure, including falsey thrown reasons. The shell owns precedence.
        try { await context.onInternalError?.(cause); } catch { /* Preserve primary failure. */ }
      }
    })();
    context.registerCleanup?.(finalize);
    try {
      const capabilities = await client.capabilities(signal);
      const build = capabilities.builds.find(build => build.digest === options.buildDigest);
      if (!build || build.grammarRevision !== mediaFrontendContract.grammarRevision || build.sourceRevision !== mediaFrontendContract.sourceRevision || !Object.hasOwn(build.executables, invocation.tool)) throw new Error('Remote build does not match the pinned media frontend');
      const byteArgv = capabilities.features.includes('byte-argv');
      if (!byteArgv && !capabilities.features.includes('utf8-argv')) throw new Error('Remote media requires byte argv or lossless UTF-8 argv capabilities');
      const limits = options.limits ?? capabilities.limits;
      if (!Number.isSafeInteger(limits.maxArgvBytes) || limits.maxArgvBytes < 1) throw new TypeError('Invalid remote argv byte bound');
      let argvBytes = 0;
      for (const arg of invocation.argv) {
        argvBytes += arg.length + 1;
        if (argvBytes > limits.maxArgvBytes) throw new TypeError('Remote argv byte bound');
      }
      for (const arg of invocation.argv) {
        if (arg.includes(0)) throw new TypeError('NUL in native argv');
        if (!byteArgv) {
          try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(arg); }
          catch { throw new TypeError('Remote UTF-8 launcher cannot preserve these argv bytes'); }
        }
      }
      if (!capabilities.features.includes('live-files') || resource.profile !== 'live') throw new Error('Remote media requires admitted live resource capabilities');
      const backend = await provider;
      if (backend?.execute) {
        const execution = Promise.resolve().then(() => {
          signal.throwIfAborted();
          return backend.execute!({ ...context, command: invocation.tool, args: invocation.argv, discovery: invocation.discovery, signal,
            registerCleanup(close) {
              if (!cleanupAdmission) throw new Error('Media invocation cleanup admission closed');
              if (typeof close !== 'function') throw new TypeError('Invalid media invocation cleanup');
              ownedCleanups.push(close);
            },
          });
        });
        work.add(execution);
        return await execution;
      }
      const input = context.stdinInput;
      if ((input?.seek || input?.stat?.type === 'file') && !options.stdin?.seekable) throw new Error('Explicit remote descriptor bindings required for seekable native stdin');
      const sinks = new Map<number, Pick<CommandContext['stdout'], 'write' | 'ownedOutput'>>([[2, context.stdout], [3, context.stderr]]);
      const descriptors = options.descriptors ?? [];
      if (descriptors.length > limits.maxHandles || new Set(descriptors.map(descriptor => descriptor.fd)).size !== descriptors.length || descriptors.some(descriptor => !Number.isSafeInteger(descriptor.fd) || descriptor.fd < 3 || descriptor.fd > limits.maxHandles + 2)) throw new TypeError('Remote descriptor count or mapping exceeds admission');
      const streamedDescriptors = (options.descriptors ?? []).filter(descriptor => !descriptor.seekable && descriptor.rights.some(right => right === 'read' || right === 'write'));
      if (streamedDescriptors.length && (!capabilities.features.includes('descriptors') || !context.admittedHandles)) throw new Error('Remote descriptors require admitted host leases and server capabilities');
      for (const descriptor of streamedDescriptors) {
        const rights = descriptor.rights.filter(right => right === 'read' || right === 'write');
        const acquiring = context.admittedHandles!.acquire(descriptor.fd, rights, signal).then(lease => { leases.set(descriptor.fd, lease); return lease; });
        work.add(acquiring);
        const lease = await acquiring;
        if (rights.includes('read') && !lease.read || rights.includes('write') && !lease.write) throw new TypeError('Host descriptor lease lacks requested operations');
        if (rights.includes('write')) sinks.set(descriptor.fd + 1, { async write(bytes) {
          let offset = 0;
          while (offset < bytes.length) {
            signal.throwIfAborted();
            lease.consumerClosed?.throwIfAborted();
            const remaining = Math.min(bytes.length - offset, 65536);
            const count = await lease.write!(bytes.subarray(offset, offset + remaining), signal);
            if (!Number.isSafeInteger(count) || count < 1 || count > remaining) throw new TypeError('Invalid admitted descriptor write count');
            offset += count;
          }
        } });
      }
      acquisition = client.openSession({ buildDigest: build.digest, bindings: [resource], limits }, crypto.randomUUID(), signal).then(value => { session = value; });
      await acquisition;
      acquisition = client.submitJob(session!, {
        buildDigest: build.digest, toolId: invocation.tool, args: invocation.argv.map(arg => Array.from(arg)),
        namespaceId: resource.namespaceId, materializationRevision: null, cwd: context.cwd, env: { ...context.env },
        stdin: options.stdin ?? { kind: 'stream', seekable: false }, descriptors: [...options.descriptors ?? []], grants: [...options.grants ?? []],
        freshness: 'live', limits, frontendContract: mediaFrontendContract,
      }, crypto.randomUUID(), signal).then(value => { job = value; });
      await acquisition;
      const identity = session!;
      const nativeJob = job!;
      unsubscribe = context.processSignals?.subscribe(async event => {
        signal.throwIfAborted();
        if (event.target !== 'process-group') throw new TypeError('Remote signals require process-group authority');
        const operation = client.signalJob(identity, nativeJob.jobId, event.name, `signal:${nativeJob.jobId}:${event.sequence}`, signal);
        work.add(operation);
        try { await operation; return { sequence: event.sequence }; }
        finally { work.delete(operation); }
      });
      const output = await client.attach(identity, nativeJob.jobId, { direction: 'output', consumerId: crypto.randomUUID() }, crypto.randomUUID(), signal);
      const binaryLimits = { maxFrameBytes: output.maxFrameBytes, maxControlBytes: output.maxFrameBytes, channels: [...sinks.keys()], maxChannels: limits.maxHandles + 2 };
      const cursor = { ...identity, jobId: nativeJob.jobId, laneId: output.laneId, nextSequence: BigInt(output.floorSequence), offsets: new Map([...sinks.keys()].map(channel => [channel, 0n])), endedChannels: new Set<number>() };
      const download = client.resumeStream(cursor, binaryLimits, async frame => {
        if (frame.kind === 'data') {
          const sink = sinks.get(frame.channelId);
          if (!sink) throw new Error('Remote channel requires an explicit host control binding');
          signal.throwIfAborted();
          sink.ownedOutput?.consumerClosed.throwIfAborted();
          await (sink.ownedOutput ?? sink).write(frame.payload);
          await options.onProgress?.({ direction: 'download', bytes: frame.payload.length });
        } else if (frame.kind === 'control') {
          const control = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame.payload)) as Control;
          if (control.type === 'ChannelOpen' && control.direction === 'write') {
            if (control.seekable || !options.onOutputChannel) throw new Error('Remote output channel requires an explicit host stream binding');
            const sink = await options.onOutputChannel(control, context);
            if (!sink || typeof sink.write !== 'function') throw new TypeError('Remote output channel requires a writable host sink');
            sinks.set(control.channelId, sink);
          } else if (control.type === 'Callback' || control.type === 'CanonicalCallback' || control.type === 'ChannelOpen') {
            if (!options.onControl) throw new Error('Remote resource callback requires an explicit host control binding');
            const callback = structuredClone(control);
            const remote: RemoteMediaControlContext = { signal, async respond(result) {
              signal.throwIfAborted();
              if (callback.type !== 'Callback' || callback.epoch !== identity.epoch
                || callback.namespaceId !== resource.namespaceId || callback.owner.kind !== 'job'
                || callback.owner.id !== nativeJob.jobId || Date.parse(callback.expiresAt) <= Date.now()
                || !options.grants?.some(grant => grant.grantId === callback.grantId
                  && grant.operations.includes(callback.operation.op))) throw new Error('Unauthorized remote callback response');
              const owned = structuredClone(result);
              if (owned.callbackId !== callback.callbackId || owned.operationId !== callback.operationId)
                throw new Error('Remote callback response belongs to another operation');
              validateCallbackResult(callback.operation, owned);
              const response = client.answerCallback(identity, nativeJob.jobId, owned, crypto.randomUUID(), signal);
              work.add(response);
              try {
                const receipt = await response;
                if (receipt.callbackId !== callback.callbackId || receipt.operationId !== callback.operationId)
                  throw new Error('Remote callback acknowledgement belongs to another operation');
                return receipt;
              } finally { work.delete(response); }
            } };
            await options.onControl(control, context, remote);
          } else if (control.type === 'Failure') throw new Error(control.error.message);
          else if (control.type === 'JobState' && (control.job.processOutcome || control.job.state === 'terminal')) { processExited = true; inputController.abort(new Error('Native process exited')); }
        }
      }, signal);
      work.add(download);
      void download.catch(() => controller.abort(new Error('Remote output failed')));
      const upload = (async () => {
        let receiptFailed = false;
        let inputFailure: { cause: unknown } | undefined;
        try {
        const reads = streamedDescriptors.filter(descriptor => descriptor.rights.includes('read'));
        const streamStdin = !options.stdin || options.stdin.kind === 'stream';
        if (!streamStdin && !reads.length) return;
        const input = await client.attach(identity, nativeJob.jobId, { direction: 'input', consumerId: crypto.randomUUID() }, crypto.randomUUID(), inputSignal);
        const channels = [...(streamStdin ? [1] : []), ...reads.map(descriptor => descriptor.fd + 1)];
        const offsets = new Map(channels.map(channel => [channel, 0n]));
        let sequence = BigInt(input.nextSequence); let tail = Promise.resolve();
        function send(channelId: number, kind: BinaryFrame['kind'], payload: Uint8Array) {
          const operation = tail.then(async () => {
            inputSignal.throwIfAborted();
            const offset = offsets.get(channelId)!;
            // Exit retires new reads, not a dispatched native write's receipt.
            // Caller cancellation still owns both scopes.
            try {
              await client.sendFrames(identity, nativeJob.jobId, input.laneId, [{ kind, channelId, sequence, offset, correlationId: 0n, payload }], { maxFrameBytes: input.maxFrameBytes, maxControlBytes: input.maxFrameBytes, channels }, crypto.randomUUID(), signal);
            } catch (cause) { receiptFailed = true; throw cause; }
            sequence++; offsets.set(channelId, offset + BigInt(payload.length));
          });
          tail = operation;
          return operation;
        }
        const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;
        async function* readInput(read: (count: number, signal: AbortSignal) => Promise<IteratorResult<Uint8Array>>, description: string) {
          for (;;) {
            const count = Math.min(input.maxFrameBytes, 65536);
            const next = await read(count, inputSignal);
            if (!next || typeof next !== 'object' || Array.isArray(next)) throw new TypeError('Invalid process input read result');
            const done = next.done;
            if (done === true) return;
            if (done !== false && done !== undefined) throw new TypeError('Invalid process input read result');
            const fragment = next.value;
            if (!(fragment instanceof Uint8Array) || byteLength.call(fragment) > count) throw new TypeError(`Invalid ${description} read size`);
            yield fragment;
          }
        }
        // Borrow one cursor and retain its operation/receiver for the invocation.
        // Empty fragments remain data; only an explicit done=true admits END.
        const stdinRead = context.stdinInput?.read.bind(context.stdinInput);
        const stdin = stdinRead ? { [Symbol.asyncIterator]: () => readInput(stdinRead, 'stdinInput') } : context.stdin;
        const sources: [number, AsyncIterable<Uint8Array>][] = streamStdin ? [[1, readBytes(stdin, inputSignal)]] : [];
        for (const descriptor of reads) {
          const lease = leases.get(descriptor.fd)!;
          const read = lease.read!.bind(lease);
          sources.push([descriptor.fd + 1, readBytes({ [Symbol.asyncIterator]: () => readInput(read, 'admitted descriptor') }, inputSignal)]);
        }
        const producers = sources.map(async ([channel, source]) => {
          for await (const incoming of source) {
            for (let start = 0; start < incoming.length; start += input.maxFrameBytes) {
              const bytes = Uint8Array.from(incoming.subarray(start, start + input.maxFrameBytes));
              await send(channel, 'data', bytes);
              await options.onProgress?.({ direction: 'upload', bytes: bytes.length });
            }
          }
          await send(channel, 'end', new Uint8Array());
        });
        // Retire siblings on failure and observe every admitted source before cleanup.
        for (const producer of producers) void producer.catch(cause => {
          // Record the originating failure before canceling competing readers.
          // A sibling's retirement must not replace it, even for falsey causes.
          if (!(processExited && !receiptFailed && inputSignal.aborted && cause === inputSignal.reason)) inputFailure ??= { cause };
          inputController.abort(new Error('Remote descriptor input failed'));
        });
        const results = await Promise.allSettled(producers);
        if (inputFailure) throw inputFailure.cause;
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
        } catch (cause) {
          if (!receiptFailed && processExited && !signal.aborted && cause === inputSignal.reason) return;
          throw cause;
        }
      })();
      work.add(upload);
      void upload.catch(() => controller.abort(new Error('Remote input failed')));
      await Promise.all([download, upload]);
      const settled = await client.waitJob(identity, nativeJob.jobId, signal);
      if (!settled.outputComplete || settled.cleanup !== 'complete') throw new Error('Remote media cleanup or output is incomplete');
      if (settled.outcome?.kind === 'exited') return { exitCode: settled.outcome.exitCode };
      if (settled.outcome?.kind === 'signaled' && options.signalStatus) {
        const exitCode = options.signalStatus(settled.outcome.signal, settled.outcome.signalNumber);
        if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) throw new TypeError('Invalid shell signal status');
        return { exitCode };
      }
      throw new Error(`Remote media outcome: ${settled.outcome?.kind ?? 'unknown'}`);
    } catch (cause) {
      primaryFailed = true;
      throw cause;
    } finally { await finalize(); }
  }
  const plugin = mediaCommands({
    ...(options.replace !== undefined ? { replace: options.replace } : {}),
    ffmpeg: { build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live', run },
    imageMagick: { build: imageMagickReference.id, grammarRevision: imageMagickGrammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live', run },
  });
  return { ...plugin, async dispose() {
    const runtime = await provider?.catch(() => undefined);
    await runtime?.dispose?.();
  } };
}
