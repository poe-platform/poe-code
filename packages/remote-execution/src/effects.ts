import type { WireObjectMetadata } from '@poe-code/safe-fs/core';
import { createFileServer, type RetainedReadFile } from './files.js';
import { inspectOutputTree, retrieveOutputs, type OutputDestination, type OutputTransferCursor, type OutputFreshness } from './output-retrieval.js';
import type { EffectManifest } from './wire.generated.js';
import { UploadError } from './upload-protocol.js';

export type NativeSettlement = { state: 'running' } | { state: 'exited'; exitCode: number } | { state: 'failed' | 'cancelled'; error: string };
export interface FileEffect {
  sequence: number;
  operation: 'open' | 'created' | 'modified' | 'mkdir' | 'rmdir' | 'rename' | 'unlink' | 'write' | 'append' | 'truncate' | 'metadata' | 'link' | 'symlink';
  /** Observed logical spelling, never authority to reopen the retained object.
   * Concurrent namespace changes can invalidate it without this job observing. */
  path?: number[];
  destination?: number[];
  /** Actual canonical rename outcome; omission is unknown. */
  moved?: boolean;
  mode?: number;
  target?: number[];
  object?: string;
  position?: string;
  length?: string;
  bytes?: number[];
  /** Settled bytes, including zero-progress receipts. Zero-progress IO alone
   * does not make a previously existing retained file an output. */
  count?: number;
  changes?: WireObjectMetadata;
  callbackId?: string;
  stage?: string;
}
export interface CanonicalEffectManifest { effects: FileEffect[]; native: NativeSettlement; outputs: string[]; retrievalFailures?: { object: string; error: string }[] }
export interface CanonicalOutputTreeInspection {
  manifest: CanonicalEffectManifest;
  files: { path: number[]; relativePath: number[]; object: string }[];
  directories: { path: number[]; relativePath: number[] }[];
  retainedIdentities: string[];
  detachedIdentities: string[];
  unlocatedIdentities: string[];
  unavailablePaths: { path: number[]; relativePath: number[] }[];
  unresolvedEffects: string[];
}

// Reversible byte spelling for the shared projector. It is never a host path.
function spelling(bytes: number[]) {
  for (const byte of bytes) if (!Number.isInteger(byte) || byte < 1 || byte > 255) throw new TypeError('Invalid output byte path');
  return bytes.map(byte => String.fromCharCode(byte)).join('');
}
function bytePath(path: string) { return Array.from(path, char => char.charCodeAt(0)); }
/** Relative byte paths preserve native names without UTF-8 decoding. Resume
 * opens must preserve acknowledged bytes, as for OutputDestination. */
export interface CanonicalOutputDestination {
  /** Stable authority of the destination tree; defaults to this adapter. */
  readonly identity?: object | symbol;
  mkdir(relativePath: Uint8Array, signal?: AbortSignal): Promise<void>;
  open(relativePath: Uint8Array, metadata: Parameters<OutputDestination['open']>[1], signal?: AbortSignal): ReturnType<OutputDestination['open']>;
}
export interface EffectDestination {
  /** Stable authority whose acknowledged effects remain present on resume. */
  readonly identity?: object | symbol;
  /** Resolve only manifest byte paths in the destination authority. Await native
   * settlement of each operation; do not undo earlier operations on failure. */
  apply(effect: FileEffect, signal?: AbortSignal): Promise<void>;
}
export interface EffectTransferCursor {
  nextSequence: number;
  /** Preserve these bindings with progress; another invocation or tree cannot
   * reuse settled receipts. Issued by reconstruct, never pathname identities. */
  invocation?: object;
  destination?: object | symbol;
}

/** Invocation-local effect authority, populated by actual settled native IO,
 * never by directory enumeration or guessed output operands. Retains must be
 * independently owned; closing native descriptors must not invalidate retrieval.
 * A retain preserves identity, not an immutable content snapshot. */
export function createEffectStore(options: { maxEffects: number; maxFrameBytes: number }) {
  options = { ...options };
  if (!Number.isSafeInteger(options.maxEffects) || options.maxEffects < 1) throw new TypeError('Invalid effect bound');
  const effects: FileEffect[] = [];
  const produced = new Set<string>();
  const resources = new Map<string, RetainedReadFile>();
  const retrievalFailures = new Map<string, string>();
  const handles = new Map<string, Promise<string>>();
  const scope = { tenantId: crypto.randomUUID(), sessionId: crypto.randomUUID(), epoch: crypto.randomUUID(), invocationId: crypto.randomUUID() };
  let native: NativeSettlement = { state: 'running' }; let closed = false; let retiring: Promise<void> | undefined;
  let started = false;
  const lifetime = new AbortController();
  const replayIdentity = Object.freeze({});
  let reservations = 0;
  const files = createFileServer({ maxHandles: options.maxEffects, maxFrameBytes: options.maxFrameBytes, async open(_scope, input) {
    const resource = resources.get(input.path);
    if (!resource) throw new Error('Unknown effect object');
    return resource;
  } });
  function check() { if (closed) throw new Error('Effect retention closed'); }
  function handle(object: string) {
    check();
    // Retention alone also covers write-capable opens of untouched inputs.
    // Only settled invocation effects grant output retrieval membership.
    if (!produced.has(object)) throw new Error('Not an invocation output');
    if (!resources.has(object)) throw new Error('Output retrieval unavailable');
    let value = handles.get(object);
    if (!value) { value = files.open(scope, { namespaceId: 'effects', path: object }, new AbortController().signal); handles.set(object, value); }
    return value;
  }
  function inspect(): CanonicalEffectManifest {
    check();
    // A write-capable open can retain a prior file without ever changing it.
    // Only actual settled effects establish output membership.
    const outputs = [...produced].filter(object => resources.has(object) || retrievalFailures.has(object));
    return structuredClone({ effects, native, outputs, ...(retrievalFailures.size ? { retrievalFailures: [...retrievalFailures].map(([object, error]) => ({ object, error })) } : {}) });
  }
  function outputManifest(snapshot: CanonicalEffectManifest): EffectManifest {
    return {
      jobId: scope.invocationId, outputs: snapshot.outputs.filter(object => resources.has(object)), effectBarrier: String(snapshot.effects.length), outputComplete: snapshot.native.state !== 'running',
      effects: snapshot.effects.flatMap(effect => {
        if (effect.operation === 'rename') {
          if (effect.moved === false) return [];
        }
        return [{ operationId: String(effect.sequence), sequence: String(effect.sequence), operation: effect.operation, state: effect.operation === 'rename' && effect.moved !== true ? 'unknown' as const : 'applied' as const, namespaceId: 'effects',
          ...(effect.count === undefined ? {} : { acknowledgedBytes: String(effect.count) }),
          ...(effect.path ? { path: spelling(effect.path) } : {}), ...(effect.destination ? { destination: spelling(effect.destination) } : {}), ...(effect.object ? { identityId: effect.object } : {}) }];
      }),
    };
  }
  return {
    inspect,
    inspectTree(logicalRoot: number[]): CanonicalOutputTreeInspection {
      const snapshot = inspect();
      const tree = inspectOutputTree(outputManifest(snapshot), spelling(logicalRoot));
      return { manifest: snapshot,
        files: tree.files.map(file => ({ path: bytePath(file.path), relativePath: bytePath(file.relativePath), object: file.identityId })),
        directories: tree.directories.map(directory => ({ path: bytePath(directory.path), relativePath: bytePath(directory.relativePath) })),
        retainedIdentities: tree.retainedIdentities, detachedIdentities: tree.detachedIdentities, unlocatedIdentities: tree.unlocatedIdentities,
        unavailablePaths: tree.unavailablePaths.map(file => ({ path: bytePath(file.path), relativePath: bytePath(file.relativePath) })),
        unresolvedEffects: tree.unresolvedEffects,
      };
    },
    assertCapacity() { check(); if (effects.length + reservations >= options.maxEffects) throw new Error('Effect receipt capacity'); },
    /** Reserve a receipt before awaiting a canonical mutation. Release on every
     * outcome; a failed operation does not consume a settled-effect slot. */
    reserve(bytes = 0) {
      check(); if (effects.length + reservations >= options.maxEffects) throw new Error('Effect receipt capacity');
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > options.maxFrameBytes) throw new TypeError('Effect receipt byte limit');
      reservations++;
      let released = false;
      return () => { if (!released) { released = true; reservations--; } };
    },
    record(effect: Omit<FileEffect, 'sequence'>) {
      check();
      if (effects.length >= options.maxEffects) throw new Error('Effect receipt capacity');
      // Observe structural receipts once and own their byte arrays before
      // validation. Re-reading accessors could retain different bytes from
      // those admitted, or change output membership after settlement.
      effect = structuredClone(effect);
      for (const path of [effect.path, effect.destination, effect.target]) if (path && (!path.length || path.includes(0) || path.some(n => !Number.isInteger(n) || n < 0 || n > 255))) throw new TypeError('Invalid effect path');
      if (effect.operation === 'write' || effect.operation === 'append' || effect.bytes !== undefined || effect.count !== undefined) {
        if (!Array.isArray(effect.bytes) || effect.bytes.length > options.maxFrameBytes
          || !Number.isSafeInteger(effect.count) || effect.count !== effect.bytes.length) throw new TypeError('Invalid settled effect bytes');
        for (const byte of effect.bytes) if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new TypeError('Invalid settled effect bytes');
      }
      effects.push({ ...effect, sequence: effects.length });
      if (effect.object && effect.operation !== 'open'
        && !(effect.operation === 'rename' && effect.moved === false)
        && !((effect.operation === 'write' || effect.operation === 'append') && effect.count === 0)) produced.add(effect.object);
    },
    retain(object: string, resource: RetainedReadFile) {
      check(); if (!object || resources.has(object) || resources.size >= options.maxEffects) throw new Error('Effect retain conflict or capacity');
      // Retrieval opens lazily. Pin the admitted capability now so mutation of
      // its public method table cannot redirect reads or replace owned cleanup.
      // Bound receivers still observe live canonical contents, not snapshots.
      resources.set(object, Object.freeze({
        identity: resource.identity, freshness: resource.freshness?.bind(resource),
        stat: resource.stat.bind(resource), read: resource.read.bind(resource),
        close: resource.close.bind(resource),
      }));
    },
    failRetrieval(object: string, error: unknown) { check(); retrievalFailures.set(object, error instanceof Error ? error.message : String(error)); },
    settle(result: NativeSettlement) {
      check();
      if (result.state === 'running' && started) throw new Error('Effect invocation already started');
      if (native.state !== 'running') throw new Error('Native settlement already recorded');
      started = true;
      native = structuredClone(result);
    },
    /** Obtain a host-qualified content version for direct range-download resume.
     * Preserve this capability across interruption; a retain alone cannot prove
     * that an acknowledged prefix still belongs to the current content. */
    async freshness(object: string, signal?: AbortSignal): Promise<OutputFreshness | undefined> {
      return files.freshness(scope, await handle(object), signal);
    },
    async stat(object: string, signal?: AbortSignal, freshness?: OutputFreshness) { return files.stat(scope, await handle(object), signal, freshness); },
    /** Optional freshness must originate from this store and this retained file.
     * Guarded reads fail when the content changes, including after interruption. */
    download(object: string, start: bigint, end: bigint, signal = new AbortController().signal, freshness?: OutputFreshness): ReadableStream<Uint8Array> {
      check();
      if (typeof start !== 'bigint' || typeof end !== 'bigint' || start < 0n || end < start || end > 9223372036854775807n) throw new UploadError(416, 'Unrepresentable file range');
      signal.throwIfAborted();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let position = start;
      const abort = new AbortController();
      const combined = AbortSignal.any([signal, abort.signal, lifetime.signal]);
      let finished = false; let pulling = false;
      let target: ReadableStreamDefaultController<Uint8Array>;
      const release = () => { reader?.releaseLock(); reader = undefined; };
      const finish = () => { finished = true; combined.removeEventListener('abort', cancelled); };
      const cancelled = () => {
        if (finished) return;
        finish(); target.error(combined.reason);
        if (!pulling) release();
      };
      return new ReadableStream<Uint8Array>({
        start(controller) {
          target = controller;
          combined.addEventListener('abort', cancelled, { once: true });
          if (combined.aborted) cancelled();
        },
        async pull(controller) {
          if (finished) return;
          pulling = true;
          try {
            combined.throwIfAborted();
            reader ??= files.stream(scope, await handle(object), start, end, combined, freshness).getReader();
            const part = await reader.read();
            if (part.done) {
              reader.releaseLock(); reader = undefined;
              if (position !== end) throw new Error('Output range interrupted');
              finish();
              controller.close();
            } else { position += BigInt(part.value.length); controller.enqueue(part.value); }
          } catch (error) {
            if (!finished) { finish(); controller.error(error); }
          } finally { pulling = false; if (finished) release(); }
        },
        async cancel(reason) { finish(); const cancellation = reader?.cancel(reason); abort.abort(reason); await cancellation; if (!pulling) release(); },
      }, { highWaterMark: 0 });
    },
    /** Replay ordered settled receipts. Preserve the returned cursor for bound
     * resume. Legacy numeric offsets leave prefix ownership to the caller. */
    async reconstruct(destination: EffectDestination, progress: number | EffectTransferCursor = 0, signal?: AbortSignal) {
      check();
      const cursor = typeof progress === 'number' ? { nextSequence: progress } : progress;
      let nextSequence = cursor.nextSequence;
      signal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
      const snapshot = inspect();
      try {
        if (!Number.isSafeInteger(nextSequence) || nextSequence < 0 || nextSequence > snapshot.effects.length) throw new TypeError('Invalid effect cursor');
        const identity = destination.identity ?? destination;
        if ((typeof identity !== 'object' || identity === null) && typeof identity !== 'symbol') throw new TypeError('Invalid effect destination identity');
        if (typeof progress !== 'number' && (cursor.invocation !== undefined || nextSequence > 0)
          && cursor.invocation !== replayIdentity) throw new Error('Effect resume cursor belongs to another invocation or has no invocation binding');
        if (typeof progress !== 'number' && (cursor.destination !== undefined || nextSequence > 0)
          && cursor.destination !== identity) throw new Error('Effect resume cursor belongs to another destination or has no destination binding');
        const apply = destination.apply.bind(destination);
        cursor.invocation = replayIdentity;
        cursor.destination = identity;
        for (; nextSequence < snapshot.effects.length; cursor.nextSequence = ++nextSequence) {
          check();
          signal?.throwIfAborted();
          const effect = snapshot.effects[nextSequence];
          if (effect.operation === 'open') continue;
          if (effect.operation === 'rename') {
            if (effect.moved === false) continue;
            if (effect.moved !== true) throw new Error('Canonical rename outcome unavailable');
          }
          await apply(structuredClone(effect), signal);
        }
        signal.throwIfAborted();
        return { manifest: snapshot, native: snapshot.native, transfer: { state: 'complete' as const, nextSequence, cursor } };
      } catch (error) { return { manifest: snapshot, native: snapshot.native, transfer: { state: 'failed' as const, nextSequence, cursor, error } }; }
    },
    /** Copy the surviving invocation-produced tree, even after native failure.
     * This does not replay mutations onto the live canonical execution tree.
     * Retained content remains live; resume requires unchanged source content. */
    async retrieve(logicalRoot: number[], destination: CanonicalOutputDestination, cursor: OutputTransferCursor = { completed: new Set(), offsets: new Map() }, signal?: AbortSignal) {
      const snapshot = inspect();
      signal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
      try {
        // Admit destination authority before retained IO can await host work.
        // Method replacement must not redirect an acknowledged transfer suffix.
        const mkdir = destination.mkdir.bind(destination);
        const open = destination.open.bind(destination);
        const identity = destination.identity ?? destination;
        const manifest = outputManifest(snapshot);
        const guards = new Map<string, OutputFreshness>();
        const result = await retrieveOutputs(manifest, spelling(logicalRoot), {
          async freshness(object, signal) {
            const guard = await files.freshness(scope, await handle(object), signal);
            if (guard) guards.set(object, guard);
            return guard;
          },
          async metadata(object, signal) { return files.stat(scope, await handle(object), signal, guards.get(object)); },
          async range(object, start, signal = new AbortController().signal) {
            const id = await handle(object); const guard = guards.get(object);
            const metadata = await files.stat(scope, id, signal, guard);
            return files.stream(scope, id, start, BigInt(metadata.size), signal, guard);
          },
        }, {
          identity,
          mkdir(path, signal) { check(); return mkdir(Uint8Array.from(path, char => char.charCodeAt(0)), signal); },
          async open(path, metadata, signal) {
            check();
            const file = await open(Uint8Array.from(path, char => char.charCodeAt(0)), metadata, signal);
            // Own the acquired destination before fallible method admission.
            // Getters can fail or replace its public cleanup method; retire the
            // acquired capability without touching settled canonical effects.
            const close = file.close.bind(file);
            try {
              const write = file.write.bind(file);
              const truncate = file.truncate.bind(file);
              return {
                write(position, bytes, signal) { check(); return write(position, bytes, signal); },
                truncate(size, signal) { check(); return truncate(size, signal); },
                close,
              };
            } catch (error) {
              try { await close(); }
              catch (cleanup) { throw new AggregateError([error, cleanup], 'Output destination admission cleanup failed', { cause: error }); }
              throw error;
            }
          },
        }, cursor, signal, { maxFrameBytes: options.maxFrameBytes });
        return { manifest: snapshot, native: snapshot.native, transfer: result.transfer };
      } catch (error) { return { manifest: snapshot, native: snapshot.native, transfer: { state: 'failed' as const, error, cursor } }; }
    },
    close(): Promise<void> {
      if (retiring) return retiring; closed = true;
      // Canonical cancellation listeners may synchronously reenter close.
      // Publish their shared drain before notifying any retained consumer.
      retiring = Promise.resolve().then(async () => {
      await Promise.allSettled([...handles.values()]);
      const results = await Promise.allSettled([files.disposeAll(), ...[...resources].filter(([object]) => !handles.has(object)).map(([, resource]) => Promise.resolve().then(() => resource.close()))]);
      resources.clear(); handles.clear();
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Effect retain cleanup failed');
      });
      lifetime.abort(new Error('Effect retention closed'));
      return retiring;
    },
  };
}
export type EffectStore = ReturnType<typeof createEffectStore>;
