import { EndpointCapabilityGap, type EndpointLease, type NativeEndpointRequest } from './endpoint.js';
import { BytePath, decodeFileOffset, decodeObjectMetadata } from '@poe-code/safe-fs/contracts/object';
import { FsError } from '@poe-code/safe-fs/contracts/errors';
import type { CreatedFileObject, FileSystem, RetainedFileObject, WireObjectMetadata } from '@poe-code/safe-fs/core';
import type { EffectStore, CanonicalEffectManifest, FileEffect } from './effects.js';
import { encodeFileMetadata, type RetainedReadFile } from './files.js';
import type { NativeInvocation } from './materializations.js';
import { assertLogicalCwd } from './invocation-admission.js';
import { createDescriptorMaterialization, type MaterializedDescriptorHandles, type MaterializedDescriptorRight } from './descriptors.js';
import { admitCanonicalMetadata } from './canonical-metadata.js';
import { admitCanonicalCapabilities } from './canonical-capabilities.js';

export class JobEffectsError extends Error {
  constructor(cause: unknown, readonly effects: CanonicalEffectManifest) {
    super(cause instanceof Error ? cause.message : String(cause), { cause }); this.name = 'JobEffectsError';
  }
}

export class JobCallbackRecoveryError extends Error {
  readonly outcome = 'unknown';
  constructor(readonly sessionId: string, readonly epoch: string, readonly jobId: string) {
    super('Job callback retention ended; inspect the job before recovery');
    this.name = 'JobCallbackRecoveryError';
  }
}

export interface ReadinessWork {
  /** Metadata-only records namespace/identity setup without acquiring dependencies.
   * Speculative dependency preparation is advisory, including failed work.
   * Required work is the logically necessary admitted starting tree (such as cwd
   * and namespace installation); it must finish before process admission. Late
   * dependency discovery alone never makes that dependency required at startup. */
  kind: 'metadata-only' | 'speculative' | 'required';
  /** Unique within this workspace's readiness ledger. A source may have several
   * aliases, but one readiness obligation cannot have competing classifications. */
  identity: string;
  state: 'pending' | 'complete' | 'failed';
}
/** Replacing an observed data field with a getter cannot hide revoked work.
 * Existing metadata getters remain supported without a second invocation. */
function unchangedMetadata(record: object, key: string, before: PropertyDescriptor | undefined, value: unknown): boolean {
  const current = Object.getOwnPropertyDescriptor(record, key);
  if (!before || !current) return before === current;
  if ('value' in before) return 'value' in current && current.value === value;
  return !('value' in current) && current.get === before.get && current.set === before.set;
}
/** Own only admission metadata. Advisory acquisition/error payloads remain lazy;
 * neither an iterator nor an inherited slot can supply readiness evidence. */
export function snapshotReadiness(work: readonly ReadinessWork[]): ReadinessWork[] {
  if (!Array.isArray(work)) throw new Error('Incomplete required readiness');
  const length = work.length;
  const records: ReadinessWork[] = [];
  const descriptors: Record<string, PropertyDescriptor | undefined>[] = [];
  const slots: (PropertyDescriptor | undefined)[] = [];
  const snapshot = Array.from({ length }, (_, index) => {
    if (!Object.hasOwn(work, index)) throw new Error('Incomplete required readiness');
    slots.push(Object.getOwnPropertyDescriptor(work, index));
    const item = work[index];
    if (!item) throw new Error('Incomplete required readiness');
    records.push(item);
    descriptors.push(Object.fromEntries(['kind', 'identity', 'state']
      .map(key => [key, Object.getOwnPropertyDescriptor(item, key)])));
    return { kind: item.kind, identity: item.identity, state: item.state };
  });
  if (work.length !== length) throw new Error('Incomplete required readiness');
  // Later metadata accessors can revoke an earlier obligation without changing
  // ledger length. Check descriptors and data values without invoking getters again
  // or touching advisory acquisition/error payloads.
  for (let index = 0; index < length; index++) {
    if (!unchangedMetadata(work, String(index), slots[index], records[index]))
      throw new Error('Incomplete required readiness');
    for (const key of ['kind', 'identity', 'state'] as const) {
      if (!unchangedMetadata(records[index], key, descriptors[index][key], snapshot[index][key]))
        throw new Error('Incomplete required readiness');
    }
  }
  return snapshot;
}
export function assertRequiredReadiness(work: readonly ReadinessWork[], admitted?: readonly ReadinessWork[]): void {
  work = snapshotReadiness(work);
  if (admitted !== undefined) admitted = snapshotReadiness(admitted);
  const identities = new Set<string>();
  if (!work.some(item => item.kind === 'required')
    || work.some(item => {
      if (!item || typeof item.identity !== 'string' || !item.identity.length
        || identities.has(item.identity) || !['metadata-only', 'speculative', 'required'].includes(item.kind)
        || !['pending', 'complete', 'failed'].includes(item.state)
        || (item.kind === 'required' && item.state !== 'complete')) return true;
      identities.add(item.identity);
      return false;
    })) throw new Error('Incomplete required readiness');
  if (admitted !== undefined) {
    // Ledger order is bookkeeping, not authority. Keep the exact admitted set
    // of required identities while advisory records evolve independently.
    const required = new Set(work.filter(item => item.kind === 'required').map(item => item.identity));
    const expected = admitted.filter(item => item.kind === 'required');
    if (required.size !== expected.length || expected.some(item => !required.has(item.identity)))
      throw new Error('Incomplete or stale job materialization readiness');
  }
}
export interface ReadyJobWorkspace extends NativeInvocation {
  state: string;
  /** Unclassified entries are required for backward-compatible admission.
   * Advisory discovery must never be promoted to required file acquisition. */
  entries: readonly { state: string; kind?: ReadinessWork['kind'];
    /** Manifest entry identity, when this work belongs to a manifest. Namespace
     * setup without an entry index is identified by the readiness ledger. */
    index?: number;
  }[];
  readiness: readonly ReadinessWork[];
}
function completeStartingEntries(entries: ReadyJobWorkspace['entries']): boolean {
  const indexes = new Set<number>();
  return Array.isArray(entries) && Array.from(entries).every(entry => {
    if (!entry || !['pending', 'applied', 'failed', 'unknown'].includes(entry.state)
      || entry.kind !== undefined && !['metadata-only', 'speculative', 'required'].includes(entry.kind)) return false;
    if (entry.kind !== undefined && entry.kind !== 'required') return true;
    if (entry.state !== 'applied') return false;
    if (entry.index === undefined) return true;
    if (!Number.isSafeInteger(entry.index) || entry.index < 0 || indexes.has(entry.index)) return false;
    indexes.add(entry.index);
    return true;
  });
}
function requiredEntryIdentity(entries: ReadyJobWorkspace['entries']): string {
  const required = entries.filter(entry => entry.kind === undefined || entry.kind === 'required');
  // Indexed manifest records name obligations independently of observation
  // order. Unindexed namespace work retains its ordered admission evidence.
  const indexed = required.filter(entry => entry.index !== undefined).sort((a, b) => a.index! - b.index!);
  const unindexed = required.filter(entry => entry.index === undefined);
  return JSON.stringify({ indexed, unindexed });
}
interface AccessIdentity {
  sessionId: string; epoch: string; jobId: string; callbackId: string;
  fileId: string; stage: string;
}
export type JobFileRequest = AccessIdentity & (
  | { operation: 'descriptor-acquire'; fd: number; rights: MaterializedDescriptorRight[] }
  | { operation: 'descriptor-read'; handle: string; maxBytes: number }
  | { operation: 'descriptor-write'; handle: string; bytes: Uint8Array }
  | { operation: 'descriptor-seek'; handle: string; position: string }
  | { operation: 'descriptor-stat' | 'descriptor-close'; handle: string }
  | { operation: 'open'; path: number[]; access?: 'read' | 'write' | 'readwrite' }
  | { operation: 'create'; path: number[]; access?: 'read' | 'write' | 'readwrite'; flag?: 'w' | 'wx' | 'a' | 'ax'; mode?: number }
  | { operation: 'read'; handle: string; position: string; maxBytes: number }
  | { operation: 'write'; handle: string; position: string; bytes: number[] | Uint8Array }
  | { operation: 'append'; handle: string; bytes: number[] | Uint8Array }
  | { operation: 'stat' | 'close'; handle: string }
  | { operation: 'truncate'; handle: string; length: string }
  | { operation: 'rename'; path: number[]; destination: number[] }
  | { operation: 'mkdir'; path: number[]; mode?: number }
  | { operation: 'unlink'; path: number[] }
  | { operation: 'rmdir'; path: number[] }
  | { operation: 'readdir'; path: number[] }
  | { operation: 'readlink'; path: number[] }
  | { operation: 'capabilities'; path: number[]; create?: boolean; allowDirectory?: boolean }
  | { operation: 'path-access'; path: number[]; mode?: number }
  | { operation: 'realpath'; path: number[] }
  | { operation: 'path-stat'; path: number[] }
  | { operation: 'path-lstat'; path: number[] }
  | { operation: 'metadata'; handle: string; changes: WireObjectMetadata }
  | { operation: 'link'; handle: string; destination: number[] }
  | { operation: 'symlink'; path: number[]; target: number[] }
);
export interface BoundJobRun {
  jobId: string;
  invocation: NativeInvocation;
  /** Admission evidence only, never a replacement for live canonical access. */
  readiness: readonly ReadinessWork[];
  signal: AbortSignal;
  /** Called by the authenticated transport adapter with its locally retained
   * credential. Wire IDs and server paths cannot manufacture this capability. */
  access(credential: object, request: JobFileRequest): Promise<unknown>;
  /** Authenticated actual native socket stage; never called by discovery. */
  openEndpoint(credential: object, request: NativeEndpointRequest): Promise<EndpointLease>;
}
export interface JobBindingOptions {
  sessionId: string; epoch: string; buildId: string; sourceAuthorityId: string; bindingId: string;
  fs: Pick<FileSystem, 'objects'> & Partial<Pick<FileSystem, 'capabilities' | 'capabilitiesFor' | 'access' | 'realpath' | 'readlink' | 'symlink' | 'mkdir' | 'rmdir' | 'stat' | 'lstat'>>;
  credential: object;
  handles?: MaterializedDescriptorHandles;
  effects?: EffectStore;
  /** Fork an independently owned read retain at the actual output open. */
  retainOutput?(object: RetainedFileObject): Promise<RetainedReadFile>;
  /** Admission for the verified executing build. Missing access is a gap. */
  endpoints?: { buildDigest: string; access: { open(request: NativeEndpointRequest): Promise<EndpointLease> } };
  maxCallbacks: number; maxHandles: number; maxIoBytes?: number;
  maxDirectoryEntries?: number;
  /** Atomically pin the named current revision until run and cleanup finish.
   * Only required starting-tree work may block readiness; speculative failures
   * remain advisory. The driver must mediate all native/delegate filesystem IO. */
  prepare(invocation: NativeInvocation, signal: AbortSignal): Promise<ReadyJobWorkspace>;
  /** Revalidate logically required live inputs immediately before native admission.
   * Speculative dependencies remain deferred to authenticated native accesses. */
  validate?(input: { workspace: ReadyJobWorkspace; invocation: NativeInvocation; signal: AbortSignal }): Promise<void>;
  /** Public admission snapshot plus the exact acquired driver capability.
   * Release reservations through acquired, never mutable public revision IDs. */
  release?(workspace: ReadyJobWorkspace, acquired: ReadyJobWorkspace): Promise<void>;
  run(input: BoundJobRun): Promise<{ exitCode: number }>;
}
/** In-process source admission evidence. Capture methods and their receivers,
 * never dependency bytes, before asynchronous session/materialization binding.
 * Mutable filesystem containers cannot authorize a replacement scratch facet. */
export function captureJobSource(fs: JobBindingOptions['fs']) {
  const objects = fs.objects;
  return Object.freeze({ fs, objects, capabilities: fs.capabilities,
    objectMethods: Object.freeze({
      open: objects?.open, create: objects?.create, rename: objects?.rename,
      unlink: objects?.unlink, readdir: objects?.readdir,
    }),
    pathMethods: Object.freeze({
      access: fs.access, realpath: fs.realpath, stat: fs.stat, lstat: fs.lstat,
      mkdir: fs.mkdir, rmdir: fs.rmdir, readlink: fs.readlink,
      symlink: fs.symlink, capabilitiesFor: fs.capabilitiesFor,
    }),
  });
}
export type JobSourceAdmission = ReturnType<typeof captureJobSource>;

const fields = ['sessionId', 'epoch', 'buildId', 'sourceAuthorityId', 'bindingId', 'materializationId', 'manifestId', 'manifestRevision', 'directoryRevision'] as const;
function octets(value: number[], empty = false) {
  if (!Array.isArray(value) || (!empty && !value.length) || value.length > 1048576) throw new TypeError('Invalid native octets');
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) throw new TypeError('Invalid native octets');
    const n = value[index];
    if (!Number.isInteger(n) || n < 1 || n > 255) throw new TypeError('Invalid native octets');
  }
}

/** Includes one native NUL terminator per argument, including empty arguments. */
export const nativeArgvByteLimit = 1048576;

/** Validate the literal job description before handing it to a host adapter. */
export function assertJobInvocation(input: NativeInvocation): void {
  for (const field of fields) if (typeof input[field] !== 'string' || !input[field].length || input[field].length > 256) throw new TypeError('Incomplete job binding');
  assertNativeProcessView(input.cwd, input.originalArgv);
}

/** Admit literal process names independently of resource acquisition and session
 * binding. Dependency discovery must not run for an inadmissible process view. */
export function assertNativeProcessView(cwd: number[], originalArgv: number[][]): void {
  octets(cwd); assertLogicalCwd(cwd);
  if (!Array.isArray(originalArgv)) throw new TypeError('Original argv required');
  if (originalArgv.length > nativeArgvByteLimit) throw new TypeError('Native argv limit');
  let remaining = nativeArgvByteLimit;
  for (let index = 0; index < originalArgv.length; index++) {
    if (!Object.hasOwn(originalArgv, index)) throw new TypeError('Invalid native octets');
    const arg = originalArgv[index];
    octets(arg, true);
    if (arg.length >= remaining) throw new TypeError('Native argv limit');
    remaining -= arg.length + 1;
  }
}

/** Own the native indexed names, never advisory properties on their carriers.
 * Validate before allocation and again after observing caller-owned slots. */
function ownNativeProcessView(cwd: number[], originalArgv: number[][]) {
  assertNativeProcessView(cwd, originalArgv);
  const argumentCount = originalArgv.length;
  const indexed = (bytes: number[]) => {
    const length = bytes.length;
    const owned = Array.from({ length }, (_, index) => {
      if (!Object.hasOwn(bytes, index)) throw new TypeError('Invalid native octets');
      return bytes[index];
    });
    if (bytes.length !== length) throw new TypeError('Invalid native octets');
    return owned;
  };
  const owned = {
    cwd: indexed(cwd),
    originalArgv: Array.from({ length: argumentCount }, (_, index) => {
      if (!Object.hasOwn(originalArgv, index)) throw new TypeError('Invalid native octets');
      return indexed(originalArgv[index]);
    }),
  };
  // Indexed accessors can append a late operand during copying. A prefix is
  // neither the original argv nor a complete process binding.
  if (originalArgv.length !== argumentCount) throw new TypeError('Invalid native octets');
  assertNativeProcessView(owned.cwd, owned.originalArgv);
  return owned;
}

/** Invocation-local live authority. No staged pathname is ever a fallback.
 * Callback replay is process-local; a lost ledger requires unknown-outcome
 * recovery, never retransmission against a new binding instance. */
export function createJobBinding(options: JobBindingOptions) {
  options = Object.freeze({ ...options });
  if (!options.credential || (typeof options.credential !== 'object' && typeof options.credential !== 'function'))
    throw new TypeError('Callback credential capability required');
  const endpointBuild = options.endpoints?.buildDigest;
  const endpointOpen = options.endpoints?.access.open.bind(options.endpoints.access);
  const maxIo = options.maxIoBytes ?? 1048576;
  const maxEntries = options.maxDirectoryEntries ?? 4096;
  for (const n of [options.maxCallbacks, options.maxHandles, maxIo, maxEntries]) if (!Number.isSafeInteger(n) || n < 1) throw new TypeError('Invalid job bound');
  // Retain the canonical object facet when the host issues this capability,
  // before asynchronous engine binding can replace facets with scratch storage.
  // This retains authority, not bytes: each operation still observes live data.
  const sourceAdmission = captureJobSource(options.fs);
  const objects = sourceAdmission.objects;
  // Pin the mandatory acquisition capability as well as its receiver. A host
  // can mutate the facet during asynchronous engine binding; looking up open
  // again at execute would silently authorize its replacement scratch store.
  const open = sourceAdmission.objectMethods.open?.bind(objects);
  const source = {
    open,
    create: sourceAdmission.objectMethods.create?.bind(objects),
    rename: sourceAdmission.objectMethods.rename?.bind(objects),
    unlink: sourceAdmission.objectMethods.unlink?.bind(objects),
    readdir: sourceAdmission.objectMethods.readdir?.bind(objects),
  };
  const canonical = {
    access: sourceAdmission.pathMethods.access?.bind(options.fs),
    realpath: sourceAdmission.pathMethods.realpath?.bind(options.fs),
    stat: sourceAdmission.pathMethods.stat?.bind(options.fs),
    lstat: sourceAdmission.pathMethods.lstat?.bind(options.fs),
    mkdir: sourceAdmission.pathMethods.mkdir?.bind(options.fs),
    rmdir: sourceAdmission.pathMethods.rmdir?.bind(options.fs),
    readlink: sourceAdmission.pathMethods.readlink?.bind(options.fs),
    symlink: sourceAdmission.pathMethods.symlink?.bind(options.fs),
    capabilitiesFor: sourceAdmission.pathMethods.capabilitiesFor?.bind(options.fs),
  };
  const descriptorHandles = options.handles ? { acquire: options.handles.acquire.bind(options.handles) } : undefined;
  return {
    effects: options.effects,
    /** Engines pass their original scoped source capability to prevent reuse of
     * another invocation's binding. Direct callers use this binding's source. */
    async execute(input: NativeInvocation, signal: AbortSignal, sourceCapability?: JobBindingOptions['fs'], admittedSource?: JobSourceAdmission): Promise<{ exitCode: number }> {
      // The engine supplies its invocation's actual scoped capability. Serialized
      // authority IDs alone cannot detect a job borrowed from another invocation.
      if (sourceCapability !== undefined && sourceCapability !== options.fs) throw new Error('Job source capability mismatch');
      if (admittedSource && (admittedSource.fs !== sourceAdmission.fs
        || admittedSource.objects !== sourceAdmission.objects
        // Policy participates in canonical authority just like method facets.
        // Compare the issued facet, without freezing its live access guarantees.
        || admittedSource.capabilities !== sourceAdmission.capabilities
        || Object.keys(sourceAdmission.objectMethods).some(key =>
          Reflect.get(admittedSource.objectMethods, key) !== Reflect.get(sourceAdmission.objectMethods, key))
        || Object.keys(sourceAdmission.pathMethods).some(key =>
          Reflect.get(admittedSource.pathMethods, key) !== Reflect.get(sourceAdmission.pathMethods, key))))
        throw new Error('Job source capability mismatch');
      // Capture top-level observations once, then admit octets before retaining
      // their copy. Validate again after copying any caller-owned nested arrays.
      // Private staging and advisory discovery are not job admission fields.
      // Observing their getters could eagerly acquire dependencies or surface a
      // speculative failure before the process reaches its native access stage.
      const description = Object.fromEntries([...fields, 'cwd', 'originalArgv']
        .map(field => [field, Reflect.get(input, field)])) as unknown as NativeInvocation;
      assertJobInvocation(description);
      const invocation = { ...description, ...ownNativeProcessView(description.cwd, description.originalArgv) };
      // Validate exactly the owned description passed to preparation and launch.
      // Local structural callers can expose getters; checking the caller and
      // copying it later would authorize a different session or source binding.
      assertJobInvocation(invocation);
      for (const field of ['sessionId', 'epoch', 'buildId', 'sourceAuthorityId', 'bindingId'] as const) if (invocation[field] !== options[field]) throw new Error('Job authority mismatch');
      signal.throwIfAborted();
      const jobId = crypto.randomUUID();
      const handles = new Map<string, { fileId: string; object: RetainedFileObject; identity: string; access: 'read' | 'write' | 'readwrite'; path?: number[]; reads: AbortController }>();
      const reads = new AbortController();
      const descriptors = descriptorHandles ? createDescriptorMaterialization({ handles: descriptorHandles, maxHandles: options.maxHandles, maxIoBytes: maxIo }) : undefined;
      const descriptorOwners = new Map<string, string>();
      // Retiring handles still consume canonical retains until close settles.
      let closingHandles = 0;
      let acquiringHandles = 0;
      const namespaceChanges: { callbackId: string; path?: number[] }[] = [];
      options.effects?.settle({ state: 'running' });
      const outputIdentities = new Set<string>();
      const identities = new Map<object | symbol, { id: string; references: number; retainedOutput: boolean }>();
      const callbacks = new Map<string, { body: string; result: Promise<unknown> }>();
      const queues = new Map<string, Promise<unknown>>();
      const pending = new Set<Promise<unknown>>();
      const endpointLeases = new Set<EndpointLease>();
      let endpointAcquisitions = 0;
      let endpointCallbacks = 0;
      let closed = false;
      const openEndpoint: BoundJobRun['openEndpoint'] = async (credential, native) => {
        if (credential !== options.credential) throw new Error('Unauthorized endpoint callback');
        if (closed) throw new JobCallbackRecoveryError(invocation.sessionId, invocation.epoch, jobId);
        signal.throwIfAborted();
        if (!endpointOpen) throw new EndpointCapabilityGap();
        native = { ...native };
        const callerSignal = native.signal;
        native = { ...structuredClone({ ...native, signal: undefined }), signal: callerSignal };
        if (!endpointBuild || native.buildDigest !== endpointBuild) throw new Error('Endpoint build mismatch');
        if (endpointCallbacks >= options.maxCallbacks) throw new Error('Endpoint callback bound');
        if (endpointAcquisitions + endpointLeases.size >= options.maxHandles) throw new Error('Endpoint handle bound');
        endpointCallbacks++;
        endpointAcquisitions++;
        const acquisition = Promise.resolve().then(async () => {
          const lease = await endpointOpen({ ...native, signal: native.signal
            ? AbortSignal.any([signal, native.signal]) : signal });
          if (!lease || typeof lease.close !== 'function') throw new TypeError('Endpoint provider must return a retireable transport lease');
          const retire = lease.close.bind(lease);
          let closing: Promise<void> | undefined;
          const owned = { close() {
            return closing ??= Promise.resolve().then(retire).then(() => { endpointLeases.delete(owned); });
          } };
          endpointLeases.add(owned);
          if (closed || signal.aborted) {
            await owned.close();
            signal.throwIfAborted();
            throw new JobCallbackRecoveryError(invocation.sessionId, invocation.epoch, jobId);
          }
          return owned;
        });
        // Drain unawaited acquisitions without replacing the primary outcome.
        const drained = acquisition.then(() => {}, () => {});
        pending.add(drained);
        try { return await acquisition; }
        finally { endpointAcquisitions--; pending.delete(drained); }
      };
      let workspace: ReadyJobWorkspace | undefined;
      let acquiredWorkspace: ReadyJobWorkspace | undefined;
      function path(value: number[]): BytePath {
        octets(value);
        return new BytePath(Uint8Array.from(value[0] === 47 ? value : [...invocation.cwd, ...(invocation.cwd.at(-1) === 47 ? [] : [47]), ...value]));
      }
      async function retainOutput(object: RetainedFileObject, identity: string) {
        if (!options.effects || !options.retainOutput || outputIdentities.has(identity)) return;
        // Reserve identity admission before yielding: links and independent
        // handles may settle concurrently against the same canonical object.
        outputIdentities.add(identity);
        let output: RetainedReadFile | undefined;
        let closeOutput: (() => Promise<void>) | undefined;
        try {
          output = await options.retainOutput(object);
          closeOutput = output.close.bind(output);
          const outputIdentity = output.identity;
          // Unqualified live retrieval cannot establish cache/resume authority.
          // An explicit identity must designate this exact canonical object;
          // accepting another retain would expose unrelated storage as output.
          if (outputIdentity !== undefined && outputIdentity !== object.identity)
            throw new Error('Output retain identity does not match canonical object');
          output = Object.freeze({ identity: outputIdentity, freshness: output.freshness?.bind(output),
            stat: output.stat.bind(output), read: output.read.bind(output), close: closeOutput });
          options.effects.retain(identity, output);
          identities.get(object.identity)!.retainedOutput = true;
        } catch (error) {
          const cleanup = await Promise.allSettled([Promise.resolve().then(() => closeOutput?.())]);
          options.effects.failRetrieval(identity, cleanup[0].status === 'rejected' ? new AggregateError([error, cleanup[0].reason], 'Output retain failed') : error);
        }
      }
      const access: BoundJobRun['access'] = async (credential, raw) => {
        function admit(raw: JobFileRequest) {
          if (credential !== options.credential || raw.sessionId !== invocation.sessionId || raw.epoch !== invocation.epoch || raw.jobId !== jobId) throw new Error('Unauthorized file callback');
          for (const value of [raw.callbackId, raw.fileId, raw.stage]) if (typeof value !== 'string' || !value.length || value.length > 256) throw new TypeError('Incomplete file callback');
          if ('path' in raw) octets(raw.path);
          if ('destination' in raw) octets(raw.destination);
          if (raw.operation === 'descriptor-acquire') {
            if (!Array.isArray(raw.rights) || raw.rights.length > 4) throw new FsError('EINVAL');
            for (let index = 0; index < raw.rights.length; index++) {
              if (!Object.hasOwn(raw.rights, index) || !['read', 'write', 'seek', 'stat'].includes(raw.rights[index])) throw new FsError('EINVAL');
            }
          }
          if (raw.operation === 'symlink') {
            octets(raw.target);
            if (raw.target.length > maxIo) throw new FsError('EFBIG', { syscall: 'symlink' });
          }
          if (raw.operation === 'create' && raw.flag !== undefined && !['w', 'wx', 'a', 'ax'].includes(raw.flag)) throw new FsError('EINVAL', { syscall: 'create' });
          if (raw.operation === 'create' || raw.operation === 'mkdir') {
            if (raw.mode !== undefined && (!Number.isSafeInteger(raw.mode) || raw.mode < 0 || raw.mode > 0o7777)) throw new FsError('EINVAL', { syscall: raw.operation });
          }
          if (raw.operation === 'path-access' && raw.mode !== undefined
            && (!Number.isSafeInteger(raw.mode) || raw.mode < 0 || raw.mode > 7)) throw new FsError('EINVAL', { syscall: 'access' });
          if (raw.operation === 'capabilities') {
            for (const value of [raw.create, raw.allowDirectory]) if (value !== undefined && typeof value !== 'boolean') throw new FsError('EINVAL', { syscall: 'capabilities' });
          }
          // Enforce transfer admission before retaining/copying the caller's frame.
          // The authenticated transport still owns aggregate queue/wire budgets.
          if (raw.operation === 'write' || raw.operation === 'append' || raw.operation === 'descriptor-write') {
            if (!(raw.bytes instanceof Uint8Array) && (!Array.isArray(raw.bytes) || raw.operation === 'descriptor-write')) throw new FsError('EINVAL');
            const span = raw.bytes instanceof Uint8Array
              ? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(raw.bytes) as number
              : raw.bytes.length;
            if (span > maxIo) throw new FsError('EINVAL');
            if (!(raw.bytes instanceof Uint8Array)) for (let index = 0; index < span; index++) {
              if (!Object.hasOwn(raw.bytes, index)) throw new FsError('EINVAL');
              const byte = raw.bytes[index];
              if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new FsError('EINVAL');
            }
          }
          if (raw.operation === 'read' || raw.operation === 'descriptor-read') {
            if (!Number.isSafeInteger(raw.maxBytes) || raw.maxBytes < 0 || raw.maxBytes > maxIo) throw new FsError('EINVAL');
          }
        }
        admit(raw);
        if (closed) throw new JobCallbackRecoveryError(invocation.sessionId, invocation.epoch, jobId);
        // Only callback contract fields participate in admission and replay.
        // Private driver extensions may lazily acquire scratch storage; copying
        // them would turn staging into authority or expose speculative failures.
        const callbackFields = ['sessionId', 'epoch', 'jobId', 'callbackId', 'fileId', 'stage',
          'operation', 'fd', 'rights', 'handle', 'maxBytes', 'bytes', 'position', 'path',
          'access', 'flag', 'mode', 'length', 'destination', 'create', 'allowDirectory', 'changes', 'target'];
        const request = structuredClone(Object.fromEntries(callbackFields
          .filter(field => Object.hasOwn(raw, field))
          .map(field => {
            const value = Reflect.get(raw, field);
            // Path/rights/payload carriers authorize only their own indexed
            // values. Private enumerable getters can acquire live dependencies;
            // structuredClone must never evaluate them at this access stage.
            if (['path', 'destination', 'target', 'rights', 'bytes'].includes(field) && Array.isArray(value)) {
              const length = value.length;
              const limit = field === 'rights' ? 4 : field === 'bytes' ? maxIo : 1048576;
              if (length > limit) throw new FsError('EINVAL');
              const owned = Array.from({ length }, (_, index) => {
                if (!Object.hasOwn(value, index)) throw new FsError('EINVAL');
                return value[index];
              });
              // A late dependency or payload appended during indexed copying
              // cannot authorize its truncated prefix or enter the replay ledger.
              if (value.length !== length) throw new FsError('EINVAL');
              return [field, owned];
            }
            return [field, value];
          }))) as JobFileRequest;
        // Copying may observe accessor-backed structural host inputs again.
        // Only the owned, reauthorized frame may enter replay storage or queues.
        admit(request);
        // Binary payload identity is its octets, not the host carrier chosen by
        // a transport on replay. Keep all access metadata in the replay key.
        // Transport object-member order is not file/job identity. Normalize
        // records, including metadata changes, while preserving octet order.
        const body = JSON.stringify('bytes' in request
          ? { ...request, bytes: Array.from(request.bytes) } : request, (_key, value) =>
          value && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
        const previous = callbacks.get(request.callbackId);
        if (previous) { if (previous.body !== body) throw new Error('Callback identity conflict'); return structuredClone(await previous.result); }
        if (callbacks.size >= options.maxCallbacks) throw new Error('Callback limit');
        // Independent open descriptions must be able to unblock each other.
        // Live observations and acquisitions must not block a writer that can
        // settle their upstream work. Serialize namespace changes and each handle;
        // descriptor duplicates additionally share their canonical cursor queue.
        const queue = 'handle' in request ? request.handle
          : ['open', 'create', 'descriptor-acquire', 'path-stat', 'path-lstat', 'path-access', 'realpath', 'readlink', 'readdir', 'capabilities'].includes(request.operation)
            ? `observation:${request.callbackId}` : 'namespace';
        const result = (queues.get(queue) ?? Promise.resolve()).then(async () => {
          let releaseEffect: (() => void) | undefined;
          let acquisitionReserved = false;
          const namespaceObservation = namespaceChanges.length;
          try {
          signal.throwIfAborted();
          if (request.operation === 'open' || request.operation === 'create' || request.operation === 'descriptor-acquire') {
            if (handles.size + descriptorOwners.size + closingHandles + acquiringHandles >= options.maxHandles)
              throw new FsError('EMFILE', { syscall: request.operation });
            acquiringHandles++;
            acquisitionReserved = true;
          }
          if (request.operation === 'descriptor-acquire') {
            if (!descriptors) throw new FsError('ENOTSUP');
            const opened = await descriptors.acquire(request.fd, request.rights, signal);
            descriptorOwners.set(opened.handle, request.fileId);
            acquiringHandles--; acquisitionReserved = false;
            return opened;
          }
          if (request.operation === 'descriptor-read' || request.operation === 'descriptor-write'
            || request.operation === 'descriptor-seek' || request.operation === 'descriptor-stat' || request.operation === 'descriptor-close') {
            if (!descriptors || descriptorOwners.get(request.handle) !== request.fileId) throw new FsError('EBADF');
            if (request.operation === 'descriptor-read') return descriptors.read(request.handle, request.maxBytes, signal);
            if (request.operation === 'descriptor-write') return descriptors.write(request.handle, request.bytes, signal);
            if (request.operation === 'descriptor-seek') return descriptors.seek(request.handle, request.position, signal);
            if (request.operation === 'descriptor-stat') return descriptors.stat(request.handle, signal);
            descriptorOwners.delete(request.handle);
            closingHandles++;
            try { return await descriptors.close(request.handle, signal); }
            finally { closingHandles--; }
          }
          const fs = source;
          const effect = (value: Omit<FileEffect, 'sequence'>) => options.effects?.record({ ...value, callbackId: request.callbackId, stage: request.stage });
          // Opens also publish identity observations. Reserve their receipt
          // before acquisition so concurrent observations cannot consume the
          // slot promised to an already admitted canonical mutation.
          if (['open', 'create', 'mkdir', 'rmdir', 'write', 'append', 'truncate', 'metadata', 'rename', 'unlink', 'link', 'symlink'].includes(request.operation)) {
            releaseEffect = options.effects?.reserve(request.operation === 'write' || request.operation === 'append' ? request.bytes.length : 0);
          }
          if (request.operation === 'rmdir') {
            if (!canonical.rmdir) throw new FsError('ENOTSUP', { syscall: 'rmdir' });
            const removedPath = Array.from(path(request.path).bytes());
            let logical: string;
            try { logical = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(removedPath)); }
            catch { throw new FsError('EILSEQ', { syscall: 'rmdir' }); }
            const capabilities = canonical.capabilitiesFor
              ? await canonical.capabilitiesFor(logical, { signal, allowDirectory: true })
              : sourceAdmission.capabilities;
            let observed: FileSystem['capabilities'] | undefined;
            // Retain the issued policy facet, but observe its live values at
            // access time. Invalid selected-mount responses must never fall
            // through to a weaker global profile or authorize removal.
            if (capabilities !== undefined || canonical.capabilitiesFor) {
              observed = admitCanonicalCapabilities(capabilities, 'rmdir', logical);
            }
            // Snapshot-marker removal cannot reproduce native empty-only rmdir.
            // A mount query selects the actual path's profile, not the summary.
            if (observed?.snapshotRmdir === true) throw new FsError('ENOTSUP', { syscall: 'rmdir', path: logical });
            signal.throwIfAborted();
            await canonical.rmdir(logical, { signal });
            namespaceChanges.push({ callbackId: request.callbackId, path: removedPath });
            effect({ operation: 'rmdir', path: removedPath });
            for (const value of handles.values()) if (JSON.stringify(value.path) === JSON.stringify(removedPath)) value.path = undefined;
            return;
          }
          if (request.operation === 'symlink') {
            if (!canonical.symlink) throw new FsError('ENOTSUP', { syscall: 'symlink' });
            const destination = path(request.path).bytes();
            let logical: string; let target: string;
            try {
              const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
              logical = decoder.decode(destination);
              target = decoder.decode(Uint8Array.from(request.target));
            } catch { throw new FsError('EILSEQ', { syscall: 'symlink' }); }
            await canonical.symlink(target, logical, { signal });
            const linkedPath = Array.from(destination);
            namespaceChanges.push({ callbackId: request.callbackId, path: linkedPath });
            for (const value of handles.values()) if (JSON.stringify(value.path) === JSON.stringify(linkedPath)) value.path = undefined;
            effect({ operation: 'symlink', path: linkedPath, target: request.target });
            return;
          }
          if (request.operation === 'mkdir') {
            if (!canonical.mkdir) throw new FsError('ENOTSUP', { syscall: 'mkdir' });
            let logical: string;
            try { logical = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(path(request.path).bytes()); }
            catch { throw new FsError('EILSEQ', { syscall: 'mkdir' }); }
            await canonical.mkdir(logical, { signal, ...(request.mode === undefined ? {} : { mode: request.mode }) });
            namespaceChanges.push({ callbackId: request.callbackId, path: Array.from(path(request.path).bytes()) });
            effect({ operation: 'mkdir', path: Array.from(path(request.path).bytes()), ...(request.mode === undefined ? {} : { mode: request.mode }) }); return;
          }
          if (request.operation === 'open' || request.operation === 'create') {
            if (request.access !== undefined && !['read', 'write', 'readwrite'].includes(request.access)) throw new TypeError('Invalid file access');
            let object: RetainedFileObject;
            let creation: 'created' | 'opened' | 'truncated' | undefined;
            if (request.operation === 'open') {
              if (!open) throw new FsError('ENOTSUP', { syscall: 'open' });
              object = await open(path(request.path), { access: request.access ?? 'read', signal });
            } else if (fs.create) {
              const acquired = await fs.create(path(request.path), { flag: request.flag ?? 'w', access: request.access ?? 'read', ...(request.mode === undefined ? {} : { mode: request.mode }), signal });
              object = acquired;
            } else {
              // Native acquisition always requires the canonical flag/disposition
              // primitive, including the default truncating flag. A legacy hook
              // cannot prove creation, preserve exclusivity or acknowledge truncate.
              throw new FsError('ENOTSUP', { syscall: 'create' });
            }
            // Own cleanup before inspecting any backend admission properties.
            // A receipt/identity getter can fail after canonical truncation or
            // creation; neither that failure nor a changed method table may
            // abandon the acquired retain or redirect its cleanup.
            const close = object.close.bind(object);
            try {
              if (request.operation === 'create') {
                creation = (object as CreatedFileObject).creation;
                if (creation === 'created') namespaceChanges.push({ callbackId: request.callbackId, path: Array.from(path(request.path).bytes()) });
                // A disposition receipt must qualify this exact native flag.
                // Do not infer exclusivity or truncation from a later stat.
                // Rejected receipts still report completed canonical effects
                // through the acquisition cleanup below; nothing rolls back.
                const flag = request.flag ?? 'w';
                if (creation !== 'created' && !(flag === 'w' && creation === 'truncated')
                  && !(flag === 'a' && creation === 'opened')) throw new FsError('EIO', { syscall: 'create' });
              }
              // Retain the acquired capability, not its mutable public method table.
              // Bound receivers keep live backend state; no content is snapshotted.
              const admittedAccess = request.access ?? 'read';
              object = Object.freeze({
                identity: object.identity, type: object.type,
                stat: object.stat?.bind(object) as RetainedFileObject['stat'], close,
                read: admittedAccess !== 'write' ? object.read?.bind(object) : undefined,
                write: admittedAccess !== 'read' ? object.write?.bind(object) : undefined,
                append: admittedAccess !== 'read' ? object.append?.bind(object) : undefined,
                truncate: admittedAccess !== 'read' ? object.truncate?.bind(object) : undefined,
                metadata: object.metadata?.bind(object), link: object.link?.bind(object),
              });
              if (object.identity === null || !['object', 'symbol'].includes(typeof object.identity)
                || !['file', 'directory', 'symlink'].includes(object.type)) throw new FsError('ENOTSUP');
            } catch (error) {
              // Canonical acquisition can already have created or truncated the
              // entry. Refusing its returned retain does not undo that effect.
              // No admitted identity exists here; report only the native receipt.
              if (creation === 'truncated') effect({ operation: 'truncate', path: Array.from(path(request.path).bytes()), length: '0' });
              else if (creation === 'created') effect({ operation: 'created', path: Array.from(path(request.path).bytes()) });
              try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Rejected object cleanup failed', { cause: error }); }
              throw error;
            }
            const handle = crypto.randomUUID();
            let correlation = identities.get(object.identity);
            if (!correlation) {
              correlation = { id: crypto.randomUUID(), references: 0, retainedOutput: false };
              identities.set(object.identity, correlation);
            }
            correlation.references++;
            const identity = correlation.id;
            const openedPath = Array.from(path(request.path).bytes());
            // A delayed open retains its object even if the namespace changes
            // before it returns. Its former spelling cannot locate later writes.
            const changedDuringOpen = namespaceChanges.slice(namespaceObservation).some(change =>
              change.callbackId !== request.callbackId && (change.path === undefined
                || change.path.every((byte, i) => openedPath[i] === byte)
                && (openedPath.length === change.path.length || openedPath[change.path.length] === 47)));
            // A fresh canonical open can prove that a prior retained object no
            // longer occupies this spelling. Its IO remains on the old identity.
            if (!changedDuringOpen) for (const value of handles.values()) if (value.identity !== identity && JSON.stringify(value.path) === JSON.stringify(openedPath)) value.path = undefined;
            handles.set(handle, { fileId: request.fileId, object, identity, access: request.access ?? 'read', path: changedDuringOpen ? undefined : openedPath, reads: new AbortController() });
            acquiringHandles--; acquisitionReserved = false;
            // Overlapping namespace callbacks retire the acquisition spelling;
            // the retain still proves the created/truncated/opened identity.
            const effectPath = changedDuringOpen ? undefined : openedPath;
            if (creation === 'truncated') effect({ operation: 'truncate', path: effectPath, object: identity, length: '0' });
            else if (creation === 'created') effect({ operation: 'created', path: effectPath, object: identity });
            // Preserve the initial namespace observation even before this
            // identity becomes an output. A later rename can retire the handle
            // spelling before its first write. Projection promotes only
            // identities with settled mutations, so untouched inputs stay out.
            else effect({ operation: 'open', path: effectPath, object: identity });
            if (request.operation === 'create' || (request.access && request.access !== 'read')) await retainOutput(object, identity);
            signal.throwIfAborted();
            return { handle, object: identity };
          }
          if (request.operation === 'rename') {
            if (!fs.rename) throw new FsError('ENOTSUP', { syscall: 'rename' });
            const receipt = await fs.rename(path(request.path), path(request.destination), { signal });
            // One canonical observation governs namespace retirement, effect
            // publication and the replayed acknowledgment. Backend accessors
            // cannot substitute another outcome between these stages.
            const moved = receipt?.moved;
            const source = Array.from(path(request.path).bytes()); const destination = Array.from(path(request.destination).bytes());
            const samePath = JSON.stringify(source) === JSON.stringify(destination);
            if (!samePath && moved !== false) namespaceChanges.push({ callbackId: request.callbackId });
            // Namespace settlement does not identify the former pathname's
            // occupant. An external writer may have replaced it since our open.
            effect({ operation: 'rename', path: source, destination, ...(samePath ? { moved: false } : typeof moved === 'boolean' ? { moved } : {}) });
            // Literal paths cannot prove which aliases traverse a moved parent
            // or displaced entry. Keep every retain and its live methods, but
            // retire unverified path hints, including delayed acquisitions.
            if (!samePath && moved !== false) for (const value of handles.values()) value.path = undefined;
            return typeof moved === 'boolean' ? { moved } : undefined;
          }
          if (request.operation === 'unlink') {
            if (!fs.unlink) throw new FsError('ENOTSUP', { syscall: 'unlink' });
            await fs.unlink(path(request.path), { signal });
            const source = Array.from(path(request.path).bytes());
            namespaceChanges.push({ callbackId: request.callbackId });
            effect({ operation: 'unlink', path: source });
            for (const value of handles.values()) value.path = undefined;
            return;
          }
          if (request.operation === 'readdir') {
            if (!fs.readdir) throw new FsError('ENOTSUP', { syscall: 'readdir' });
            const entries = await fs.readdir(path(request.path), { signal, maxEntries });
            if (!Array.isArray(entries)) throw new FsError('EIO', { syscall: 'readdir' });
            const length = entries.length;
            if (length > maxEntries) throw new FsError('EFBIG', { syscall: 'readdir' });
            let bytes = 0;
            const listing = Array.from({ length }, (_, index) => {
              if (!Object.hasOwn(entries, index)) throw new FsError('EIO', { syscall: 'readdir' });
              const entry = entries[index];
              if (!entry) throw new FsError('EIO', { syscall: 'readdir' });
              const { name: component, type } = entry;
              if (!['file', 'directory', 'symlink', 'character', 'fifo', 'socket'].includes(type)) throw new FsError('EIO', { syscall: 'readdir' });
              // Read the genuine owned carrier, not a public override that can
              // replace an authoritative byte name with another spelling.
              let carrier: Uint8Array;
              try { carrier = BytePath.prototype.bytes.call(component); }
              catch { throw new FsError('EIO', { syscall: 'readdir' }); }
              if (!(carrier instanceof Uint8Array)) throw new FsError('EIO', { syscall: 'readdir' });
              // Admit against the remaining aggregate transfer budget before
              // retaining a backend-owned fragment in execution memory.
              const span = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(carrier) as number;
              if (span > maxIo - bytes) throw new FsError('EFBIG', { syscall: 'readdir' });
              const name = new Uint8Array(carrier);
              bytes += name.length;
              if (!name.length || name.includes(0) || name.includes(47)
                || (name.length <= 2 && name.every(byte => byte === 46))) throw new FsError('EIO', { syscall: 'readdir' });
              if (bytes > maxIo) throw new FsError('EFBIG', { syscall: 'readdir' });
              return { name: Array.from(name), type };
            });
            // Never acknowledge a prefix after backend metadata access changed
            // the admitted listing. This is carrier validation, not a promise
            // of an atomic directory snapshot against external writers.
            if (entries.length !== length) throw new FsError('EIO', { syscall: 'readdir' });
            return listing;
          }
          if (request.operation === 'capabilities' || request.operation === 'readlink'
            || request.operation === 'path-access' || request.operation === 'realpath'
            || request.operation === 'path-stat' || request.operation === 'path-lstat') {
            const bytes = path(request.path).bytes();
            let logical: string;
            try { logical = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
            catch { throw new FsError('EILSEQ', { syscall: request.operation === 'path-access' ? 'access' : request.operation }); }
            if (request.operation === 'path-access') {
              if (!canonical.access) throw new FsError('ENOTSUP', { syscall: 'access' });
              return canonical.access(logical, request.mode ?? 0, { signal });
            }
            if (request.operation === 'realpath') {
              if (!canonical.realpath) throw new FsError('ENOTSUP', { syscall: 'realpath' });
              const resolved = await canonical.realpath(logical, { signal });
              if (typeof resolved !== 'string' || !resolved.startsWith('/') || resolved.includes('\0'))
                throw new FsError('EIO', { syscall: 'realpath' });
              if (resolved.length > maxIo) throw new FsError('EFBIG', { syscall: 'realpath' });
              const encoded = new TextEncoder().encode(resolved);
              if (encoded.length > maxIo) throw new FsError('EFBIG', { syscall: 'realpath' });
              if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(encoded) !== resolved)
                throw new FsError('EILSEQ', { syscall: 'realpath' });
              return Array.from(encoded);
            }
            if (request.operation === 'path-stat' || request.operation === 'path-lstat') {
              const method = request.operation === 'path-stat' ? 'stat' : 'lstat';
              if (!canonical[method]) throw new FsError('ENOTSUP', { syscall: method });
              // Path metadata is an observation, never retained wire identity.
              return admitCanonicalMetadata(await canonical[method]!(logical, { signal }), method);
            }
            if (request.operation === 'capabilities') {
              if (!canonical.capabilitiesFor && sourceAdmission.capabilities === undefined) throw new FsError('ENOTSUP', { syscall: 'capabilities' });
              const capabilities = canonical.capabilitiesFor ? await canonical.capabilitiesFor(logical, { signal,
                ...(request.create === undefined ? {} : { create: request.create }),
                ...(request.allowDirectory === undefined ? {} : { allowDirectory: request.allowDirectory }) }) : sourceAdmission.capabilities;
              const observed = admitCanonicalCapabilities(capabilities, 'capabilities', logical, maxIo) as Record<string, boolean | undefined>;
              // A legacy backend guarantee alone cannot admit an operation on
              // this retained-object route. Method presence is necessary, never
              // sufficient: keep unknown/false guarantees and only narrow true.
              // Do not acquire a file merely to probe its optional handle methods.
              const namespaceSupport = {
                // Descriptor-only jobs need no pathname acquisition. Legacy
                // read/resize guarantees cannot qualify a missing object route;
                // refuse at the actual access without consulting scratch files.
                read: !!fs.open,
                streamingRead: !!fs.open,
                retainedRead: !!fs.open,
                truncate: !!fs.open,
                retainedResize: !!fs.open,
                readdir: !!fs.readdir,
                // Ordinary writes and append streams may create a missing
                // file. Writable existing retains alone cannot supply those
                // routes, even if legacy pathname methods advertise them.
                write: !!fs.create,
                append: !!fs.create,
                streamingWrite: !!fs.create,
                streamingAppend: !!fs.create,
                descriptorWriteStream: !!fs.create,
                // safe-fs defines this legacy flag as eligibility for the
                // shell's bounded whole-file offset replacement strategy.
                // It cannot qualify retained positional writes, large offsets
                // or sparse allocation. Actual writes use the admitted object
                // operation and preserve its ENOTSUP/EFBIG/partial receipts.
                randomAccessWrite: false,
                exclusiveCreate: !!fs.create,
                rename: !!fs.rename,
                atomicRename: !!fs.rename,
                mkdir: !!canonical.mkdir,
                remove: !!fs.unlink,
                removeDirectory: !!canonical.rmdir && observed.snapshotRmdir !== true,
                readlink: !!canonical.readlink,
                symlinks: !!canonical.symlink,
                stat: !!canonical.stat && !!canonical.lstat,
                access: !!canonical.access,
                realpath: !!canonical.realpath,
                // The byte rename contract has no no-replace precondition.
                atomicRenameNoReplace: false,
                // These require canonical primitives absent from this route.
                // A sequence of retained writes or namespace callbacks cannot
                // inherit a legacy backend's compound/atomic guarantee.
                copy: false,
                exclusiveCopy: false,
                recursiveMkdir: false,
                recursiveRemove: false,
                atomicFileStaging: false,
                atomicFileMutation: false,
                atomicDirectoryMetadata: false,
                atomicResize: false,
              };
              for (const [capability, supported] of Object.entries(namespaceSupport)) {
                if (observed[capability] === true && !supported) observed[capability] = false;
              }
              if (observed.readOnly === true) {
                for (const capability of ['write', 'append', 'truncate', 'streamingWrite', 'streamingAppend', 'descriptorWriteStream', 'randomAccessWrite', 'exclusiveCreate', 'mkdir', 'recursiveMkdir', 'remove', 'removeDirectory', 'recursiveRemove', 'rename', 'copy', 'exclusiveCopy', 'symlinks', 'hardlinks', 'permissions', 'timestamps', 'atomicRename', 'atomicRenameNoReplace', 'atomicFileStaging', 'atomicFileMutation', 'atomicDirectoryMetadata', 'atomicResize', 'retainedResize']) {
                  if (observed[capability] === true) observed[capability] = false;
                }
              }
              // Narrowing true guarantees to false adds one JSON octet per
              // member. Bound the final reply as well as backend admission.
              if (new TextEncoder().encode(JSON.stringify(observed)).length > maxIo) throw new FsError('EFBIG', { syscall: 'capabilities', path: logical });
              return observed;
            }
            if (!canonical.readlink) throw new FsError('ENOTSUP', { syscall: 'readlink' });
            const spelling = await canonical.readlink(logical, { signal });
            if (typeof spelling !== 'string' || !spelling.length || spelling.includes('\0'))
              throw new FsError('EIO', { syscall: 'readlink' });
            // UTF-8 encoding replaces unpaired UTF-16 surrogates. A legacy
            // string backend cannot authorize those manufactured target bytes.
            // Bound the string before allocating its binary representation.
            if (spelling.length > maxIo) throw new FsError('EFBIG', { syscall: 'readlink' });
            const target = new TextEncoder().encode(spelling);
            if (target.length > maxIo) throw new FsError('EFBIG', { syscall: 'readlink' });
            if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(target) !== spelling)
              throw new FsError('EILSEQ', { syscall: 'readlink' });
            return Array.from(target);
          }
          const retained = handles.get(request.handle);
          if (!retained || retained.fileId !== request.fileId) throw new FsError('EBADF');
          const object = retained.object;
          if (request.operation === 'close') {
            handles.delete(request.handle);
            closingHandles++;
            try { return await object.close(); }
            finally {
              closingHandles--;
              const correlation = identities.get(object.identity)!;
              if (--correlation.references === 0 && !correlation.retainedOutput) identities.delete(object.identity);
            }
          }
          if (request.operation === 'stat') {
            if (!object.stat) throw new FsError('ENOTSUP', { syscall: 'stat' });
            // ExactFileStat is structural: native backends may return prototype
            // accessors. Observe only contract fields, once, at this fstat stage;
            // enumerable private state is neither metadata nor wire authority.
            const { type, size, allocatedBytes, nlink, mode, uid, gid, atimeNs, mtimeNs, ctimeNs } = await object.stat({ signal });
            const observed = { type, size, allocatedBytes, nlink, mode, uid, gid, atimeNs, mtimeNs, ctimeNs };
            if (observed.type !== object.type) throw new FsError('EIO', { syscall: 'stat' });
            try { encodeFileMetadata(observed); }
            catch { throw new FsError('EIO', { syscall: 'stat' }); }
            // Object correlation comes from the admitted retain. Backend identity
            // scopes and device/inode pairs cannot grant wire authority.
            return observed;
          }
          if (request.operation === 'read') {
            if (retained.access === 'write') throw new FsError('EBADF');
            if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 0 || request.maxBytes > maxIo) throw new FsError('EINVAL');
            if (!object.read) throw new FsError('ENOTSUP', { syscall: 'read' });
            const readSignal = AbortSignal.any([signal, reads.signal, retained.reads.signal]);
            readSignal.throwIfAborted();
            const bytes = await object.read(decodeFileOffset(request.position), request.maxBytes, { signal: readSignal });
            if (!(bytes instanceof Uint8Array)) throw new FsError('EIO', { syscall: 'read' });
            const span = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(bytes) as number;
            if (span > request.maxBytes) throw new FsError('EIO', { syscall: 'read' });
            return new Uint8Array(bytes);
          }
          if (request.operation === 'write' || request.operation === 'append') {
            if (retained.access === 'read') throw new FsError('EBADF');
            if (!(request.bytes instanceof Uint8Array) && !Array.isArray(request.bytes)) throw new FsError('EINVAL');
            if (request.bytes.length > maxIo) throw new FsError('EINVAL');
            if (!(request.bytes instanceof Uint8Array)) for (const n of request.bytes) if (!Number.isInteger(n) || n < 0 || n > 255) throw new FsError('EINVAL');
            const owned = Uint8Array.from(request.bytes);
            let count: number;
            if (request.operation === 'append') {
              if (!object.append) throw new FsError('ENOTSUP', { syscall: 'append' });
              count = await object.append(owned, { signal });
            } else {
              if (!object.write) throw new FsError('ENOTSUP', { syscall: 'write' });
              count = await object.write(decodeFileOffset(request.position), owned, { signal });
            }
            if (!Number.isSafeInteger(count) || count < 0 || count > request.bytes.length) throw new FsError('EIO', { syscall: request.operation });
            effect({ operation: request.operation, object: retained.identity, path: retained.path, ...(request.operation === 'write' ? { position: request.position } : {}), bytes: Array.from(request.bytes).slice(0, count), count });
            return count;
          }
          if (request.operation === 'truncate') {
            if (retained.access === 'read') throw new FsError('EBADF');
            if (!object.truncate) throw new FsError('ENOTSUP', { syscall: 'truncate' });
            await object.truncate(decodeFileOffset(request.length), { signal });
            effect({ operation: 'truncate', object: retained.identity, path: retained.path, length: request.length });
            return;
          }
          if (request.operation === 'metadata') {
            if (!object.metadata) throw new FsError('ENOTSUP');
            await object.metadata(decodeObjectMetadata(request.changes), { signal });
            effect({ operation: 'metadata', object: retained.identity, path: retained.path, changes: request.changes });
            await retainOutput(object, retained.identity);
            return;
          }
          if (request.operation === 'link') {
            if (!object.link) throw new FsError('ENOTSUP', { syscall: 'link' });
            const destination = path(request.destination);
            await object.link(destination, { signal });
            const linkedPath = Array.from(destination.bytes());
            namespaceChanges.push({ callbackId: request.callbackId, path: linkedPath });
            // A settled link proves which object occupies this new spelling.
            // Other retained identities still live, but their old path hint may
            // have become stale through an external namespace operation.
            for (const value of handles.values()) if (value.identity !== retained.identity && JSON.stringify(value.path) === JSON.stringify(linkedPath)) value.path = undefined;
            effect({ operation: 'link', object: retained.identity, destination: linkedPath });
            await retainOutput(object, retained.identity);
            return;
          }
          throw new FsError('ENOTSUP');
          } finally {
            if (acquisitionReserved) acquiringHandles--;
            releaseEffect?.();
          }
        }).then(value => structuredClone(value));
        callbacks.set(request.callbackId, { body, result });
        const settled = result.catch(() => {});
        queues.set(queue, settled);
        pending.add(settled);
        void settled.then(() => {
          pending.delete(settled);
          if (queues.get(queue) === settled) queues.delete(queue);
        });
        // Publish replay and cursor barriers before abort listeners can reenter.
        // Waiting to cancel inside the queued close deadlocks behind an idle
        // upstream read. Only the authenticated owner can retire this consumer.
        if (request.operation === 'descriptor-close' && descriptorOwners.get(request.handle) === request.fileId)
          descriptors?.retireReads(request.handle);
        if (request.operation === 'close') {
          const retained = handles.get(request.handle);
          if (retained?.fileId === request.fileId) retained.reads.abort(new FsError('EBADF'));
        }
        return structuredClone(await result);
      };
      let primary: { cause: unknown } | undefined;
      const dispose = async () => {
        closed = true;
        reads.abort(new FsError('EBADF'));
        descriptors?.retireReads();
        await Promise.all([...pending]);
        const cleanup = await Promise.allSettled([...handles.values()].map(({ object }) => Promise.resolve().then(() => object.close())));
        cleanup.push(...await Promise.allSettled([...endpointLeases].map(lease => lease.close())));
        cleanup.push(...await Promise.allSettled([descriptors?.dispose()]));
        descriptorOwners.clear();
        handles.clear(); callbacks.clear(); identities.clear(); queues.clear();
        if (acquiredWorkspace) cleanup.push(...await Promise.allSettled([Promise.resolve().then(() => options.release?.(workspace ?? acquiredWorkspace!, acquiredWorkspace!))]));
        const failures = cleanup.filter(result => result.status === 'rejected');
        if (failures.length) {
          const error = new AggregateError([...(primary ? [primary.cause] : []), ...failures.map(result => result.reason)], 'Job handle cleanup failed', primary);
          throw options.effects ? new JobEffectsError(error, options.effects.inspect()) : error;
        }
      };
      try {
        // Own the acquisition before snapshot admission can fail. Cancellation
        // during preparation still retires the late workspace and keeps its cause.
        acquiredWorkspace = await options.prepare(structuredClone(invocation), signal);
        signal.throwIfAborted();
        const acquired = acquiredWorkspace;
        // Snapshot the public binding, not private driver capabilities. Retain
        // those capabilities for release without letting mutable IDs redirect it.
        const snapshot = () => {
          // Observe each public field once. Reading it again after admission
          // could replace a stale revision or incomplete tree with a ready one.
          const publicFields = [...fields, 'cwd', 'originalArgv', 'state', 'entries', 'readiness'];
          const publicDescriptors = Object.fromEntries(publicFields
            .map(key => [key, Object.getOwnPropertyDescriptor(acquired, key)]));
          const observed = Object.fromEntries(publicFields.map(key => [key, Reflect.get(acquired, key)])) as unknown as ReadyJobWorkspace;
          const entryCount = observed.entries?.length;
          const entryRecords: ReadyJobWorkspace['entries'][number][] = [];
          const entryDescriptors: Record<string, PropertyDescriptor | undefined>[] = [];
          const entrySlots: (PropertyDescriptor | undefined)[] = [];
          // Private driver accessors may acquire scratch storage or do advisory
          // work. They are not admission evidence and must never run as part of
          // startup or revalidation. Preserve inert extension values for cleanup;
          // the exact acquired capability remains the second release argument.
          const extensions = Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(acquired))
            .filter(([key, descriptor]) => !publicFields.includes(key) && descriptor.enumerable && 'value' in descriptor)
            .map(([key, descriptor]) => [key, descriptor.value]));
          const captured = { ...extensions, ...observed, ...structuredClone({
            ...Object.fromEntries(fields.map(field => [field, observed[field]])),
            ...ownNativeProcessView(observed.cwd, observed.originalArgv),
            state: observed.state,
            // Records may also contain lazy acquisition/failure capabilities.
            // Read only the metadata used to admit the starting tree, both now
            // and after live validation; speculative payloads are not evidence.
            // Driver iterators and inherited slots cannot replace the records
            // belonging to the acquired starting tree.
            entries: Array.isArray(observed.entries) ? Array.from({ length: observed.entries.length }, (_, index) => {
              if (!Object.hasOwn(observed.entries, index)) throw new Error('Incomplete or stale job materialization');
              entrySlots.push(Object.getOwnPropertyDescriptor(observed.entries, index));
              const entry = observed.entries[index];
              entryRecords.push(entry);
              if (!entry) return entry;
              entryDescriptors[index] = Object.fromEntries(['state', 'kind', 'index']
                .map(key => [key, Object.getOwnPropertyDescriptor(entry, key)]));
              const { state, kind } = entry;
              // Manifest indexes are required-work identity, not advisory
              // acquisition payload. Never inspect speculative index accessors.
              const manifestIndex = kind === undefined || kind === 'required' ? entry.index : undefined;
              return { state, ...(kind === undefined ? {} : { kind }), ...(manifestIndex === undefined ? {} : { index: manifestIndex }) };
            }) : observed.entries,
            readiness: snapshotReadiness(observed.readiness),
          }) };
          // Later metadata observations must not replace an earlier binding
          // field or either ledger. Inspect property descriptors without invoking
          // driver getters again: a second getter result is not fresh authority.
          for (const key of publicFields) {
            if (!unchangedMetadata(acquired, key, publicDescriptors[key], Reflect.get(observed, key)))
              throw new Error('Incomplete or stale job materialization');
          }
          // A metadata accessor can add required work while either ledger is
          // copied. Never admit a prefix as the complete installed tree.
          if (observed.entries?.length !== entryCount) throw new Error('Incomplete or stale job materialization');
          for (let index = 0; index < entryRecords.length; index++) {
            const record = entryRecords[index];
            if (!unchangedMetadata(observed.entries, String(index), entrySlots[index], record))
              throw new Error('Incomplete or stale job materialization');
            if (!record) continue;
            const entry = captured.entries[index];
            // Advisory indexes are acquisition payloads, not startup evidence.
            const keys = entry.kind === undefined || entry.kind === 'required'
              ? ['state', 'kind', 'index'] as const : ['state', 'kind'] as const;
            for (const key of keys) {
              if (!unchangedMetadata(record, key, entryDescriptors[index][key], entry[key]))
                throw new Error('Incomplete or stale job materialization');
            }
          }
          return captured;
        };
        workspace = snapshot();
        signal.throwIfAborted();
        assertRequiredReadiness(workspace.readiness);
        if (fields.some(field => workspace![field] !== invocation[field]) || workspace.state !== 'ready'
          || !completeStartingEntries(workspace.entries)
          || JSON.stringify(workspace.cwd) !== JSON.stringify(invocation.cwd)
          || JSON.stringify(workspace.originalArgv) !== JSON.stringify(invocation.originalArgv)) throw new Error('Incomplete or stale job materialization');
        if (options.validate) {
          await options.validate({ workspace: acquired, invocation: structuredClone(invocation), signal });
          signal.throwIfAborted();
          const current = snapshot();
          assertRequiredReadiness(current.readiness, workspace.readiness);
          // Revalidation may observe drift, but cannot replace the pinned binding
          // or remove required entries to manufacture a complete starting tree.
          if (fields.some(field => current[field] !== workspace![field])
            || current.state !== 'ready'
            || !completeStartingEntries(current.entries)
            || JSON.stringify(current.cwd) !== JSON.stringify(workspace.cwd)
            || JSON.stringify(current.originalArgv) !== JSON.stringify(workspace.originalArgv)
            || requiredEntryIdentity(current.entries) !== requiredEntryIdentity(workspace.entries))
            throw new Error('Incomplete or stale job materialization');
          workspace = current;
        }
        // Reading the driver's live readiness can itself observe lease loss.
        // Finish that admission work before checking cancellation at launch.
        signal.throwIfAborted();
        const result = await options.run({ jobId, invocation: structuredClone(invocation), readiness: structuredClone(workspace.readiness), signal, access, openEndpoint });
        const exitCode = result?.exitCode;
        if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) throw new TypeError('Invalid native exit status');
        // Completion is also the effect barrier: stop admitting callbacks before
        // draining those already accepted. Their canonical effects remain live
        // and acknowledged individually, regardless of the native exit code.
        closed = true;
        reads.abort(new FsError('EBADF'));
        descriptors?.retireReads();
        await Promise.all([...pending]);
        options.effects?.settle({ state: 'exited', exitCode });
        signal.throwIfAborted();
        return { exitCode };
      } catch (cause) {
        primary = { cause };
        closed = true;
        reads.abort(new FsError('EBADF'));
        descriptors?.retireReads();
        await Promise.all([...pending]);
        if (options.effects?.inspect().native.state === 'running') options.effects.settle({ state: signal.aborted ? 'cancelled' : 'failed', error: cause instanceof Error ? cause.message : String(cause) });
        throw options.effects ? new JobEffectsError(cause, options.effects.inspect()) : cause;
      } finally {
        await dispose();
      }
    },
  };
}
