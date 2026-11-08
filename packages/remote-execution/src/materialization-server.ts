import {parseWireJson} from './wire-json.js';
import { validateNativeResult } from './native-result.js';
import { createHash, randomUUID } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import { createUploadServer, type UploadPrincipal, type UploadServerOptions } from './server.js';
import { validateDependencyManifest, validateDependencyMaterializeRequest, validateManifestInvocation, type DependencyManifest } from './protocol.js';
import { UploadError } from './upload-protocol.js';
import { admitTree, assertTreeIdentity, entryPath, TreeError, verifyTree, type TreeFs, type TreeRootIdentity } from './materialization-tree.js';
import { assertRequiredReadiness, snapshotReadiness, type ReadinessWork } from './job-binding.js';
import { assertLogicalCwd } from './invocation-admission.js';
import type { MaterializationStatus, NativeInvocation, NativeJob, NativeResult, StoredManifest } from './materializations.js';

/** Trusted mediated namespace, not a copy of canonical files. Installation only
 * registers admitted mappings and completes required starting-tree work. Native
 * accesses (including delegates) must use authenticated canonical callbacks. */
export interface LiveWorkspace {
  readonly readiness: readonly ReadinessWork[];
  /** Validate required starting-tree integrity and access readiness only. Report
   * integrity violations as TreeError; speculative access failures stay deferred
   * to execute at the equivalent native access point. */
  validate(input: { invocation: NativeInvocation; signal: AbortSignal }): Promise<void>;
  /** Jobs may overlap on this installed namespace. Each owns its descriptors;
   * accesses observe live canonical storage without snapshot isolation. */
  execute(input: { jobId: string; invocation: NativeInvocation; signal: AbortSignal }): Promise<NativeResult>;
  close(): Promise<void>;
}

export interface MaterializationServerOptions {
  /** Existing operator-owned private directory, never a canonical output root.
   * No other actor (including jobs) may mutate this storage. */
  privateRoot: string;
  fs?: TreeFs;
  maxDocumentBytes: number; maxEntries: number; maxPathBytes: number; maxTreeBytes: bigint; maxRecords: number;
  /** Native argv admission, including one NUL terminator per argument. Each
   * defaults to maxDocumentBytes; path limits apply only to paths, not argv. */
  maxArguments?: number; maxArgvBytes?: number;
  /** Host-issued authority for exact namespace/root, source paths, snapshots,
   * output-intent registration and entry rights. IDs alone grant nothing.
   * Immutable files must be independent uploads or have a stable snapshot lease.
   * Overlapping logical roots must use the same bindingId. */
  authorize(principal: UploadPrincipal, manifest: DependencyManifest, bindingId: string): Promise<boolean>;
  liveNamespace?: {
    buildId: string;
    /** Bind principal, source capability and manifest in authenticated host state.
     * Do not resolve speculative dependencies here. Keep this workspace installed
     * until close; execute must not rebuild it or restart native work for late IO. */
    materialize(input: { principal: UploadPrincipal; manifest: DependencyManifest; bindingId: string; signal: AbortSignal }): Promise<LiveWorkspace>;
  };
  namespace?: {
    buildId: string;
    /** Trusted qualified native adapter. Install the tree at logicalRoot for the
     * process AND delegates, preserving argv/cwd octets and diagnostics. Staging
     * must remain inaccessible and immutable (read-only mount); command writes
     * use a separate isolated layer. No cwd-prefix or argv rewriting fallback.
     * Reject unsupported platform/build semantics before spawning. */
    execute(input: { physicalRoot: string; logicalRoot: number[]; invocation: NativeInvocation; signal: AbortSignal }): Promise<NativeResult>;
  };
}
interface ManifestRecord { scope: string; bytes: Uint8Array; manifest: DependencyManifest; receipt: StoredManifest; expiresAt: number }
interface Operation { scope: string; status: MaterializationStatus; manifest: ManifestRecord; bindingId: string; physicalRoot?: string; physicalRootIdentity?: TreeRootIdentity; live?: LiveWorkspace; requiredReadiness?: readonly ReadinessWork[]; expiresAt: number; busy: boolean; activeJobs: number }

export function createExecutionServer(options: UploadServerOptions & { materializations: MaterializationServerOptions }) {
  const uploads = createUploadServer(options);
  const config = options.materializations; const fs = config.fs ?? nodeFs; const now = options.now ?? Date.now;
  // The operator-issued staging destination cannot change while admission awaits
  // host authority. A later configuration edit must never redirect preparation
  // into canonical storage, even when that directory has private mode bits.
  const privateRoot = config.privateRoot;
  // Retain the issued host authority, not a mutable method-table lookup. The
  // bound receiver still checks current permissions at installation and launch;
  // no past grant or content hash authorizes a later native access.
  const authorize = config.authorize.bind(config);
  // A build ID and its qualified driver are one issued capability. Retain both
  // before asynchronous admission; replacing public configuration must not put
  // a different build on an installed workspace or admit scratch as its source.
  const liveDriver = config.liveNamespace;
  const liveNamespace = liveDriver && Object.freeze({ buildId: liveDriver.buildId,
    materialize: liveDriver.materialize.bind(liveDriver) });
  const nativeDriver = config.namespace;
  const namespace = nativeDriver && Object.freeze({ buildId: nativeDriver.buildId,
    execute: nativeDriver.execute.bind(nativeDriver) });
  for (const limit of [config.maxDocumentBytes, config.maxEntries, config.maxPathBytes, config.maxRecords]) if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('Invalid materialization limit');
  if (typeof config.maxTreeBytes !== 'bigint' || config.maxTreeBytes < 0n) throw new TypeError('Invalid tree byte limit');
  const invocationLimits = { maxArguments: config.maxArguments ?? config.maxDocumentBytes, maxArgvBytes: config.maxArgvBytes ?? config.maxDocumentBytes, maxPathBytes: config.maxPathBytes };
  for (const limit of [invocationLimits.maxArguments, invocationLimits.maxArgvBytes]) if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('Invalid invocation limit');
  const manifests = new Map<string, ManifestRecord>(); const operations = new Map<string, Operation>();
  const jobs = new Map<string, { scope: string; job: NativeJob; expiresAt: number; running: boolean }>();
  const keys = new Map<string, { body: string; id: string }>();
  const revisions = new Map<string, string>(); const locks = new Set<string>();
  const namespaceJobs = new Map<string, number>();
  function scope(p: UploadPrincipal) { return JSON.stringify([p.tenantId, p.principalId, p.sessionId, p.epoch]); }
  function check(p: UploadPrincipal, signal: AbortSignal) {
    signal.throwIfAborted();
    if (p.sessionSignal?.aborted) throw new UploadError(410, 'Session retired');
    if ([p.tenantId, p.principalId, p.sessionId, p.epoch].some(value => typeof value !== 'string' || !value.length))
      throw new UploadError(401, 'Invalid authenticated scope');
    if (!Number.isFinite(p.expiresAt) || p.expiresAt <= now()) throw new UploadError(401, 'Authentication expired');
    if (!Number.isFinite(p.sessionExpiresAt) || p.sessionExpiresAt <= now()) throw new UploadError(410, 'Session expired');
  }
  function visible<T extends { scope: string; expiresAt: number }>(record: T | undefined, p: UploadPrincipal): T { if (!record || record.scope !== scope(p)) throw new UploadError(404, 'Unknown record'); if (record.expiresAt <= now()) throw new UploadError(410, 'Record expired'); return record; }
  function bounded(value: unknown, allowed: string[]) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new UploadError(400, 'Invalid record'); }
  function id(value: unknown) { if (typeof value !== 'string' || !value.length || value.length > 256) throw new UploadError(400, 'Invalid ID'); }
  async function body(request: Request): Promise<Uint8Array> {
    const reader = request.body?.getReader(); if (!reader) throw new UploadError(400, 'Missing document');
    const chunks: Uint8Array[] = []; let length = 0;
    const cancel = () => { void reader.cancel(request.signal.reason).catch(() => {}); };
    request.signal.addEventListener('abort', cancel, { once: true });
    try { for (;;) { request.signal.throwIfAborted(); const part = await reader.read(); request.signal.throwIfAborted(); if (part.done) break; length += part.value.length; if (length > config.maxDocumentBytes) throw new UploadError(413, 'Document limit'); chunks.push(part.value); }
      const result = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result;
    } finally { request.signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  function reserve(size: number) { if (size >= config.maxRecords) throw new UploadError(429, 'Record limit'); }
  async function removeOwnedTree(op: Operation) {
    if (!op.physicalRoot) return;
    // Exclusive ownership is the concurrency guarantee. A pathname that no
    // longer names our pinned tree is not authority to delete its replacement.
    const current = await fs.lstat(op.physicalRoot);
    assertTreeIdentity(current);
    if (!op.physicalRootIdentity || !current.isDirectory() || current.isSymbolicLink()
      || current.dev !== op.physicalRootIdentity.dev || current.ino !== op.physicalRootIdentity.ino
      || await fs.realpath(op.physicalRoot) !== op.physicalRoot) throw new TreeError('collision');
    await fs.rm(op.physicalRoot, { recursive: true, force: true });
    op.physicalRoot = undefined;
    op.physicalRootIdentity = undefined;
  }
  async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url); const path = url.pathname.split('/');
    if (path[4] === 'uploads' || path[4] === 'blobs') return uploads.fetch(request);
    let epoch = '';
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      if (url.search || path[1] !== 'v1' || path[2] !== 'sessions' || path.length < 5 || path.length > 6) throw new UploadError(404, 'Unknown endpoint');
      request.signal.throwIfAborted();
      const authenticated = await options.authenticate(request, request.signal);
      request.signal.throwIfAborted();
      if (!authenticated) throw new UploadError(401, 'Authentication required');
      // Authentication may return shared host state. Pin request authority before
      // awaiting document reads, blob admission or namespace preparation.
      const p = { ...authenticated };
      epoch = p.epoch; check(p, request.signal);
      const controller = new AbortController();
      request = new Request(request, { signal: AbortSignal.any([request.signal, controller.signal,
        ...(p.sessionSignal ? [p.sessionSignal] : [])]) });
      const sessionFirst = p.sessionExpiresAt <= p.expiresAt;
      deadline = setTimeout(() => controller.abort(new UploadError(sessionFirst ? 410 : 401, 'Execution authority expired')),
        Math.min(2147483647, Math.max(0, Math.min(p.expiresAt, p.sessionExpiresAt) - now())));
      if (path[3] !== encodeURIComponent(p.sessionId)) throw new UploadError(404, 'Unknown session');
      if (request.headers.get('Execution-Epoch') !== epoch) throw new UploadError(410, 'Epoch expired');
      if (request.headers.get('Execution-Profile') !== 'dependency-manifest-v1') throw new UploadError(400, 'Profile required');
      const json = (value: unknown) => Response.json(value, { headers: { 'Execution-Epoch': epoch, 'Execution-Profile': 'dependency-manifest-v1', 'Cache-Control': 'no-store', 'Execution-Recovery': 'process-local' } });
      if (request.method === 'GET') {
        if (path[4] === 'manifests' && path[5]) {
          const record = visible(manifests.get(path[5]), p);
          return new Response(record.bytes.slice(), { headers: { 'Execution-Epoch': epoch, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
        }
        if (path[4] === 'materializations') return json(path[5] ? visible(operations.get(path[5]), p).status : [...operations.values()].filter(o => o.scope === scope(p) && o.expiresAt > now()).map(o => o.status));
        if (path[4] === 'jobs' && path[5]) return json(visible(jobs.get(path[5]), p).job);
        throw new UploadError(404, 'Unknown endpoint');
      }
      if (request.method !== 'POST' || path.length !== 5 || !['manifests', 'materializations', 'jobs'].includes(path[4])) throw new UploadError(404, 'Unknown endpoint');
      const key = request.headers.get('Idempotency-Key'); id(key);
      const bytes = await body(request); check(p, request.signal);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); const input = parseWireJson(text);
      const keyScope = JSON.stringify([scope(p), path[4], key]); const previous = keys.get(keyScope);
      if (previous) {
        if (previous.body !== text) throw new UploadError(409, 'Idempotency conflict');
        if (path[4] === 'manifests') return json(visible(manifests.get(previous.id), p).receipt);
        if (path[4] === 'materializations') return json(visible(operations.get(previous.id), p).status);
        return json(visible(jobs.get(previous.id), p).job);
      }
      if (path[4] === 'manifests') {
        validateDependencyManifest(input, config);
        if (input.sessionId !== p.sessionId || input.epoch !== p.epoch) throw new UploadError(403, 'Manifest scope mismatch');
        for (const stored of manifests.values()) if (stored.scope === scope(p) && stored.manifest.namespaceId === input.namespaceId && stored.manifest.revision === input.revision) {
          if (!Buffer.from(stored.bytes).equals(bytes)) throw new UploadError(409, 'Manifest revision conflict');
          keys.set(keyScope, { body: text, id: stored.receipt.manifestId });
          return json(stored.receipt);
        }
        reserve(manifests.size);
        const receipt = { manifestId: randomUUID(), revision: input.revision, sha256: createHash('sha256').update(bytes).digest('hex') };
        manifests.set(receipt.manifestId, { scope: scope(p), bytes, manifest: input, receipt, expiresAt: p.sessionExpiresAt });
        keys.set(keyScope, { body: text, id: receipt.manifestId }); return json(receipt);
      }
      if (path[4] === 'materializations') {
        validateDependencyMaterializeRequest(input);
        const data = input;
        if (data.sessionId !== p.sessionId || data.epoch !== epoch || data.operationKey !== key) throw new UploadError(403, 'Operation scope mismatch');
        const manifest = visible(manifests.get(data.manifestId), p);
        if (data.manifestRevision !== manifest.manifest.revision) throw new UploadError(409, 'Stale manifest');
        reserve(operations.size);
        // Serialize the entire authenticated namespace, including overlapping roots
        // and different bindings; intentionally conservative.
        const lock = JSON.stringify([scope(p), manifest.manifest.namespaceId]);
        if (locks.has(lock) || namespaceJobs.has(lock)) throw new UploadError(409, 'Namespace busy');
        if ((revisions.get(lock) ?? null) !== data.expectedDirectoryRevision) throw new UploadError(409, 'Stale directory revision');
        locks.add(lock);
        const status: MaterializationStatus = { operationId: randomUUID(), manifestId: data.manifestId, manifestRevision: data.manifestRevision, directoryRevision: null, state: 'accepted', logicalRoot: manifest.manifest.logicalRoot, cwd: manifest.manifest.cwd, entries: manifest.manifest.entries.map((_, index) => ({ index, state: 'pending', revision: null })), callbackGrantIds: [] };
        const op: Operation = { scope: scope(p), status, manifest, bindingId: data.bindingId, expiresAt: p.sessionExpiresAt, busy: true, activeJobs: 0 };
        operations.set(status.operationId, op); keys.set(keyScope, { body: text, id: status.operationId });
        let failureIndex: number | undefined;
        try {
          if (!await authorize({ ...p }, structuredClone(manifest.manifest), data.bindingId)) throw new TreeError('unauthorized');
          check(p, request.signal);
          let total = 0n;
          const receipts = new Map<number, ReturnType<typeof uploads.resolveBlob>>();
          for (const [index, entry] of manifest.manifest.entries.entries()) if (entry.kind === 'file') {
            // Live installation binds canonical callbacks, not uploaded bytes.
            // Even a valid old blob cannot authorize today's native open or
            // consume the immutable staging quota on behalf of a live resource.
            // Snapshot drivers still require every admitted upload receipt.
            if (liveNamespace && entry.source.freshness !== 'immutable') continue;
            failureIndex = index;
            total += BigInt(entry.blob.size); if (total > config.maxTreeBytes) throw new TreeError('unsupported');
            try { receipts.set(index, uploads.resolveBlob(p, { blobId: entry.blob.blobId, size: entry.blob.size, digest: entry.blob.sha256 })); }
            catch (error) { if (error instanceof UploadError && error.status === 404) throw new TreeError('missing-blob'); if (error instanceof UploadError && error.code) throw new TreeError(error.code); throw error; }
          }
          failureIndex = undefined;
          if (liveNamespace) {
            status.state = 'applying';
            op.live = await liveNamespace.materialize({ principal: { ...p }, manifest: structuredClone(manifest.manifest), bindingId: data.bindingId, signal: request.signal });
            // Own cleanup before admitting the public driver surface. Pin the
            // acquired methods without freezing live readiness or backend data.
            const acquired = op.live;
            const close = acquired.close.bind(acquired);
            op.live = Object.create(null) as LiveWorkspace;
            Object.defineProperties(op.live, {
              readiness: { get: () => acquired.readiness }, close: { value: close },
            });
            Object.defineProperties(op.live, {
              validate: { value: acquired.validate.bind(acquired) },
              execute: { value: acquired.execute.bind(acquired) },
            });
            check(p, request.signal);
            status.readiness = snapshotReadiness(op.live.readiness);
            assertRequiredReadiness(status.readiness);
            op.requiredReadiness = structuredClone(status.readiness.filter(work => work.kind === 'required'));
            // Live metadata observation can retire a lease or reveal cancellation.
            // Publish readiness only under the still-admitted authority; a failed
            // observation must release the acquired driver without advancing the
            // namespace revision or repairing its starting tree.
            check(p, request.signal);
            const revision = randomUUID();
            status.entries = status.entries.map(entry => ({ ...entry, state: 'applied', revision }));
            status.directoryRevision = revision; revisions.set(lock, revision);
            status.callbackGrantIds = [...new Set(manifest.manifest.entries.flatMap(entry => entry.source.callbackGrantId ? [entry.source.callbackGrantId] : []))];
            status.state = 'ready';
            return json(status);
          }
          admitTree(manifest.manifest);
          // Never mkdir the configured parent: an absent/private-root mistake is
          // an admission failure, not permission to create a canonical directory.
          const parent = await fs.lstat(privateRoot);
          assertTreeIdentity(parent);
          if (!process.getuid || parent.uid !== process.getuid() || (parent.mode & 0o077) !== 0
            || await fs.realpath(privateRoot) !== privateRoot || !parent.isDirectory() || parent.isSymbolicLink()) throw new TreeError('unsupported');
          op.physicalRoot = await fs.mkdtemp(`${privateRoot}/materialization-`);
          const root = await fs.lstat(op.physicalRoot);
          assertTreeIdentity(root);
          // Pin owned staging across requests; equal content at a replaced
          // pathname does not preserve the materialization's physical identity.
          if (!root.isDirectory() || root.isSymbolicLink() || root.uid !== process.getuid!()
            || (root.mode & 0o077) !== 0 || await fs.realpath(op.physicalRoot) !== op.physicalRoot) throw new TreeError('unsupported');
          op.physicalRootIdentity = { dev: root.dev, ino: root.ino, uid: root.uid, mode: root.mode };
          status.state = 'applying';
          for (const [index, entry] of manifest.manifest.entries.entries()) {
            failureIndex = index;
            check(p, request.signal);
            const destination = `${op.physicalRoot}/${entryPath(entry)}`;
            if (entry.kind === 'directory') await fs.mkdir(destination, { mode: 0o700 });
            if (entry.kind === 'file') {
              const receipt = receipts.get(index)!; const file = await fs.open(destination, 'wx', 0o600);
              try {
                const hash = createHash('sha256');
                for (let offset = 0n; offset < receipt.size;) {
                  check(p, request.signal);
                  const count = Number(receipt.size - offset > BigInt(options.limits.maxChunkBytes) ? BigInt(options.limits.maxChunkBytes) : receipt.size - offset);
                  const chunk = await options.storage.read(receipt.storageId, offset, count, request.signal);
                  if (!chunk.length || chunk.length > count) throw new TreeError('wrong-length');
                  hash.update(chunk); let written = 0;
                  while (written < chunk.length) { const result = await file.write(chunk, written, chunk.length - written); if (!result.bytesWritten) throw new TreeError('wrong-length'); written += result.bytesWritten; }
                  offset += BigInt(chunk.length);
                }
                if ((await options.storage.read(receipt.storageId, receipt.size, 1, request.signal)).length) throw new TreeError('wrong-length');
                if (hash.digest('hex') !== receipt.digest) throw new TreeError('wrong-hash');
              } finally { await file.close(); }
            }
            if (entry.kind === 'symlink') await fs.symlink(Buffer.from(entry.target), destination);
            // output-intent only registers; no parent creation or writing handle.
            const revision = randomUUID(); status.directoryRevision = revision;
            // Entry receipts describe private staging progress. Publish the
            // namespace successor only after the complete tree is verified.
            status.entries[index] = { index, state: 'applied', revision };
          }
          failureIndex = undefined;
          try { await verifyTree(fs, op.physicalRoot, manifest.manifest, op.physicalRootIdentity, request.signal); }
          catch (error) {
            if (!request.signal.aborted && !(error instanceof UploadError && [401, 403, 410].includes(error.status))
              && !(error instanceof TreeError && error.code === 'unsupported')) status.failureCategory = 'integrity';
            throw error;
          }
          check(p, request.signal);
          status.readiness = [{ kind: 'required', identity: 'immutable-starting-tree', state: 'complete' }];
          status.directoryRevision ??= randomUUID(); revisions.set(lock, status.directoryRevision); status.state = 'ready';
        } catch (error) {
          status.state = status.entries.some(e => e.state === 'applied') ? 'partial' : 'failed';
          status.error = error instanceof TreeError ? error.code : error instanceof UploadError && [401,403,410].includes(error.status) ? 'unauthorized' : 'unsupported';
          status.failureCategory ??= ['wrong-length', 'wrong-hash', 'unstable-capture'].includes(status.error) ? 'integrity' : 'readiness';
          const next = failureIndex === undefined ? status.entries.find(e => e.state === 'pending') : status.entries[failureIndex];
          if (next?.state === 'pending') { next.state = 'failed'; next.error = status.error; }
          if (op.live) { try { await op.live.close(); status.cleanup = 'complete'; } catch { status.cleanup = 'failed'; } }
          if (op.physicalRoot) { try { await removeOwnedTree(op); status.cleanup = 'complete'; } catch { status.cleanup = 'failed'; } }
        } finally { op.busy = false; locks.delete(lock); }
        return json(status);
      }
      bounded(input, ['sessionId', 'epoch', 'buildId', 'sourceAuthorityId', 'bindingId', 'materializationId', 'manifestId', 'manifestRevision', 'directoryRevision', 'cwd', 'originalArgv']);
      const invocation = input as NativeInvocation;
      for (const field of ['sessionId', 'epoch', 'buildId', 'sourceAuthorityId', 'bindingId', 'materializationId', 'manifestId', 'manifestRevision', 'directoryRevision'] as const) id(invocation[field]);
      validateManifestInvocation({ manifestId: invocation.manifestId, manifestRevision: invocation.manifestRevision, directoryRevision: invocation.directoryRevision, cwd: invocation.cwd, originalArgv: invocation.originalArgv }, invocationLimits);
      assertLogicalCwd(invocation.cwd);
      const op = visible(operations.get(invocation.materializationId), p);
      if (op.status.state !== 'ready' || op.busy || invocation.directoryRevision !== op.status.directoryRevision || invocation.manifestId !== op.status.manifestId || invocation.manifestRevision !== op.status.manifestRevision) throw new UploadError(409, 'Materialization not ready or revision mismatch');
      const lock = JSON.stringify([scope(p), op.manifest.manifest.namespaceId]);
      if (revisions.get(lock) !== invocation.directoryRevision) throw new UploadError(409, 'Stale directory revision');
      if (locks.has(lock)) throw new UploadError(409, 'Namespace busy');
      if (invocation.sessionId !== p.sessionId || invocation.epoch !== p.epoch || invocation.sourceAuthorityId !== op.manifest.manifest.sourceAuthorityId || invocation.bindingId !== op.bindingId) throw new UploadError(403, 'Job authority mismatch');
      if (!namespace && !op.live) throw new UploadError(422, 'No qualified native namespace driver');
      if (invocation.buildId !== (op.live ? liveNamespace?.buildId : namespace?.buildId)) throw new UploadError(409, 'Build mismatch');
      if (!op.live) admitTree(op.manifest.manifest).resolveCwd(invocation.cwd);
      reserve(jobs.size);
      const job: NativeJob = { jobId: randomUUID(), materializationId: invocation.materializationId, directoryRevision: invocation.directoryRevision, invocation: structuredClone(invocation), state: 'accepted' };
      const record = { scope: scope(p), job, expiresAt: p.sessionExpiresAt, running: true };
      jobs.set(job.jobId, record); keys.set(keyScope, { body: text, id: job.jobId });
      op.activeJobs++;
      namespaceJobs.set(lock, (namespaceJobs.get(lock) ?? 0) + 1);
      // Immutable scratch trees retain their exclusive execution profile. Live
      // canonical namespaces must permit writers to unblock pending readers.
      if (!op.live) { op.busy = true; locks.add(lock); }
      try {
        try {
          if (!await authorize({ ...p }, structuredClone(op.manifest.manifest), op.bindingId)) throw new TreeError('unauthorized');
        } catch (error) { job.error = 'readiness'; throw error; }
        // A ready revision cannot authorize repair of a lost starting tree.
        // Validation checks live inputs; installation belongs to materialize.
        // Advisory failures remain outside this required-readiness barrier.
        try {
          if (op.live) {
            const readiness = snapshotReadiness(op.live.readiness);
            op.status.readiness = readiness;
            assertRequiredReadiness(readiness, op.requiredReadiness);
          }
          check(p, request.signal);
        } catch (error) { job.error = 'readiness'; throw error; }
        try { if (op.live) await op.live.validate({ invocation: structuredClone(invocation), signal: request.signal }); else await verifyTree(fs, op.physicalRoot!, op.manifest.manifest, op.physicalRootIdentity, request.signal); }
        catch (error) {
          const integrity = error instanceof TreeError && ['wrong-length', 'wrong-hash', 'unstable-capture', 'collision'].includes(error.code);
          if (op.live && !integrity || error instanceof TreeError && error.code === 'unsupported'
            || request.signal.aborted || error instanceof UploadError && [401, 403, 410].includes(error.status)) {
            job.error = 'readiness';
          } else {
            job.error = 'integrity'; op.status.state = 'failed';
            op.status.error = error instanceof TreeError ? error.code : 'unstable-capture';
            op.status.failureCategory = 'integrity';
          }
          throw error;
        }
        try {
          if (op.live) {
            const readiness = snapshotReadiness(op.live.readiness);
            op.status.readiness = readiness;
            // Validation can observe live drift and discover advisory work, but
            // cannot replace or demote the required tree admitted by materialize.
            assertRequiredReadiness(readiness, op.requiredReadiness);
          }
          check(p, request.signal);
        }
        catch (error) { job.error = 'readiness'; throw error; }
        job.state = 'running';
        const result = structuredClone(op.live ? await op.live.execute({ jobId: job.jobId, invocation: structuredClone(invocation), signal: request.signal }) : await namespace!.execute({ physicalRoot: op.physicalRoot!, logicalRoot: [...op.status.logicalRoot], invocation: structuredClone(invocation), signal: request.signal }));
        validateNativeResult(result);
        job.result = result;
        job.state = 'exited';
      } catch (error) {
        job.state = 'failed'; job.error ??= 'native';
        job.failure = { message: error instanceof Error ? error.message : String(error),
          ...(error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? { code: error.code } : {}) };
      }
      finally {
        op.activeJobs--; record.running = false;
        const remaining = namespaceJobs.get(lock)! - 1;
        if (remaining) namespaceJobs.set(lock, remaining); else namespaceJobs.delete(lock);
        if (!op.live) { op.busy = false; locks.delete(lock); }
      }
      return json(job);
    } catch (error) {
      if (request.body && !request.body.locked) await request.body.cancel().catch(() => {});
      const status = error instanceof UploadError ? error.status : error instanceof TypeError || error instanceof SyntaxError ? 400 : error instanceof TreeError ? 422 : 503;
      return Response.json({ category: 'readiness', code: error instanceof TreeError ? error.code : 'materialization-error', phase: 'notAccepted' }, { status, headers: { 'Execution-Epoch': epoch } });
    } finally { if (deadline !== undefined) clearTimeout(deadline); }
  }
  return { fetch, async sweep() {
    await uploads.sweep();
    for (const [id, op] of operations) if (op.expiresAt <= now() && !op.busy && !op.activeJobs) { if (op.live) await op.live.close(); await removeOwnedTree(op); operations.delete(id); }
    for (const [id, record] of manifests) if (record.expiresAt <= now()) manifests.delete(id);
    for (const [id, record] of jobs) if (record.expiresAt <= now() && !record.running) jobs.delete(id);
    for (const [key, value] of keys) if (!operations.has(value.id) && !manifests.has(value.id) && !jobs.has(value.id)) keys.delete(key);
  } };
}
