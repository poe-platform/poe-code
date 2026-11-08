import {parseWireJson} from './wire-json.js';
import { validateNativeResult } from './native-result.js';
import type { ReadinessWork } from './job-binding.js';
import { assertJobInvocation } from './job-binding.js';
import { validateDependencyManifest, validateDependencyMaterialization, validateDependencyMaterializeRequest, validateManifestInvocation, type DependencyManifest, type DependencyMaterialization, type DependencyMaterializeRequest, type ManifestInvocation } from './protocol.js';
import { UploadError } from './upload-protocol.js';
import type { UploadClientOptions } from './uploads.js';

export interface StoredManifest { manifestId: string; revision: string; sha256: string }
export interface MaterializationStatus extends DependencyMaterialization {
  logicalRoot: number[]; cwd: number[];
  failureCategory?: 'readiness' | 'integrity';
  cleanup?: 'complete' | 'failed'; readiness?: readonly ReadinessWork[];
}
export interface NativeInvocation extends ManifestInvocation {
  sessionId: string; epoch: string; buildId: string;
  sourceAuthorityId: string; bindingId: string; materializationId: string;
}
export interface NativeResult { exitCode: number; stdout: number[]; stderr: number[] }
export interface NativeJob { invocation: NativeInvocation; jobId: string; materializationId: string; directoryRevision: string; state: 'accepted' | 'running' | 'exited' | 'failed'; result?: NativeResult; error?: 'integrity' | 'readiness' | 'native'; failure?: { message: string; code?: string }; }

function validateJob(value: unknown, max: number): asserts value is NativeJob {
  const invalid = () => { throw new TypeError('Invalid native job status'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const job = value as NativeJob;
  const invocation = job.invocation;
  if (!invocation || typeof invocation !== 'object' || Array.isArray(invocation)) invalid();
  for (const id of [job.jobId, job.materializationId, job.directoryRevision, invocation.sessionId,
    invocation.epoch, invocation.buildId, invocation.sourceAuthorityId, invocation.bindingId, invocation.materializationId])
    if (typeof id !== 'string' || !id.length || id.length > 256) invalid();
  validateManifestInvocation({ manifestId: invocation.manifestId, manifestRevision: invocation.manifestRevision,
    directoryRevision: invocation.directoryRevision, cwd: invocation.cwd, originalArgv: invocation.originalArgv },
  { maxArguments: max, maxArgvBytes: max, maxPathBytes: max });
  if (job.materializationId !== invocation.materializationId || job.directoryRevision !== invocation.directoryRevision
    || !['accepted', 'running', 'exited', 'failed'].includes(job.state)) invalid();
  if (job.state === 'exited') {
    validateNativeResult(job.result);
    if (job.error !== undefined || job.failure !== undefined) invalid();
  } else if (job.result !== undefined) invalid();
  if (job.state === 'failed') {
    if (!['readiness', 'integrity', 'native'].includes(job.error!) || !job.failure
      || typeof job.failure.message !== 'string' || (job.failure.code !== undefined && typeof job.failure.code !== 'string')) invalid();
  } else if (job.error !== undefined || job.failure !== undefined) invalid();
}

function invocationIdentity(invocation: NativeInvocation): string {
  return JSON.stringify([invocation.sessionId, invocation.epoch, invocation.buildId, invocation.sourceAuthorityId,
    invocation.bindingId, invocation.materializationId, invocation.manifestId, invocation.manifestRevision,
    invocation.directoryRevision, invocation.cwd, invocation.originalArgv]);
}

function validateStatus(value: unknown): asserts value is MaterializationStatus {
  const invalid = () => { throw new TypeError('Invalid materialization status'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const s = value as MaterializationStatus;
  // The HTTP profile adds logical paths and failure/cleanup observations to the
  // shared progress record. Validate that record with the same contract used by
  // protocol consumers, including its preparation-only error vocabulary.
  const { logicalRoot, cwd, failureCategory, cleanup, readiness, ...progress } = s;
  try { validateDependencyMaterialization(progress); } catch { invalid(); }
  for (const path of [logicalRoot, cwd]) {
    if (!Array.isArray(path) || path[0] !== 47) invalid();
    for (const n of path) if (!Number.isInteger(n) || n < 1 || n > 255) invalid();
  }
  // Check the byte component boundary even on a first recovered observation,
  // before there is a stored manifest identity to compare. This is only the
  // logical binding check: leave symlink-sensitive dotdot resolution to the
  // server rather than normalizing or rewriting the reported cwd.
  if (!(logicalRoot.length === 1 && logicalRoot[0] === 47)
    && (cwd.length < logicalRoot.length
      || logicalRoot.some((octet, index) => cwd[index] !== octet)
      || cwd.length > logicalRoot.length && cwd[logicalRoot.length] !== 47)) invalid();
  if (s.state === 'ready' && failureCategory !== undefined) invalid();
  if (failureCategory !== undefined && !['readiness', 'integrity'].includes(failureCategory)) invalid();
  if (cleanup !== undefined && !['complete', 'failed'].includes(cleanup)) invalid();
  if (readiness !== undefined) {
    if (!Array.isArray(readiness)) invalid();
    const identities = new Set<string>();
    for (const work of readiness) {
      if (!work || typeof work.identity !== 'string' || !work.identity.length
        || identities.has(work.identity)
        || !['metadata-only', 'speculative', 'required'].includes(work.kind)
        || !['pending', 'complete', 'failed'].includes(work.state)) invalid();
      identities.add(work.identity);
    }
  }
}

/** Portable control client. Mutations are never automatically retried. An operation
 * key recovers materialization after a lost acknowledgement. */
export function createExecutionClient(options: Omit<UploadClientOptions, 'maxChunkBytes'> & { maxResponseBytes?: number }) {
  // Credentials may arrive asynchronously; the control authority cannot drift
  // away from the session used to construct its endpoints during that await.
  options = Object.freeze({ ...options });
  const base = new URL(options.baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new TypeError('An authenticated HTTPS origin is required');
  const root = new URL(`/v1/sessions/${encodeURIComponent(options.sessionId)}/`, base);
  const max = options.maxResponseBytes ?? 1048576;
  const manifestIdentities = new Map<string, { revision: string; logicalRoot: string; cwd: string; entryCount: number }>();
  const operationIdentities = new Map<string, { identity: string; readyRevision?: string }>();
  const jobIdentities = new Map<string, string>();
  const manifestDigests = new Map<string, string>();
  async function digest(bytes: Uint8Array): Promise<string> {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
    return Array.from(hash, n => n.toString(16).padStart(2, '0')).join('');
  }
  if (!Number.isSafeInteger(max) || max < 1) throw new TypeError('Invalid response limit');
  async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, key?: string): Promise<T> {
    signal?.throwIfAborted();
    // Admission and response checks must use the same caller-owned snapshot,
    // even when credentials or the operation acknowledgement arrive later.
    body = structuredClone(body);
    if (path === 'materializations' && method === 'POST') {
      validateDependencyMaterializeRequest(body);
      if (body.sessionId !== options.sessionId || body.epoch !== options.epoch)
        throw new TypeError('Materialization scope mismatch');
    }
    if (path === 'jobs' && method === 'POST') {
      const invocation = body as NativeInvocation;
      assertJobInvocation(invocation);
      if (invocation.sessionId !== options.sessionId || invocation.epoch !== options.epoch)
        throw new TypeError('Job scope mismatch');
      const operation = operationIdentities.get(invocation.materializationId);
      if (operation !== undefined) {
        const [manifestId, manifestRevision] = JSON.parse(operation.identity) as string[];
        if (invocation.manifestId !== manifestId || invocation.manifestRevision !== manifestRevision
          || operation.readyRevision !== undefined && invocation.directoryRevision !== operation.readyRevision)
          throw new UploadError(409, 'Native job identity mismatch');
      }
    }
    const headers = new Headers({ Authorization: `Bearer ${await options.token()}`, 'Execution-Epoch': options.epoch, 'Execution-Profile': 'dependency-manifest-v1' });
    if (method !== 'GET') { headers.set('Idempotency-Key', key ?? crypto.randomUUID()); headers.set('Content-Type', 'application/json'); }
    const response = await (options.fetch ?? globalThis.fetch)(new URL(path, root), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, redirect: 'error' });
    if (!response.ok || response.headers.get('Execution-Epoch') !== options.epoch) { await response.body?.cancel(); throw new UploadError(response.ok ? 410 : response.status, 'Execution control request failed; inspect before retrying'); }
    const reader = response.body?.getReader();
    const abort = () => { void reader?.cancel(signal?.reason).catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (!reader) throw new TypeError('Missing response');
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) { signal?.throwIfAborted(); const part = await reader.read(); signal?.throwIfAborted(); if (part.done) break; size += part.value.length; if (size > max) throw new TypeError('Response limit'); chunks.push(part.value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const value: unknown = parseWireJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!value || typeof value !== 'object') throw new TypeError('Invalid control response');
      if (path === 'manifests' && method === 'POST') {
        const receipt = value as StoredManifest;
        if (typeof receipt.manifestId !== 'string' || !receipt.manifestId.length || receipt.manifestId.length > 256
          || receipt.revision !== (body as DependencyManifest).revision
          || receipt.sha256 !== await digest(new TextEncoder().encode(JSON.stringify(body)))
          || manifestDigests.has(receipt.manifestId) && manifestDigests.get(receipt.manifestId) !== receipt.sha256)
          throw new TypeError('Manifest receipt identity mismatch');
        manifestDigests.set(receipt.manifestId, receipt.sha256);
      }
      if (path.startsWith('manifests/')) {
        validateDependencyManifest(value, { maxEntries: max, maxPathBytes: max });
        const id = decodeURIComponent(path.slice('manifests/'.length));
        const hash = await digest(bytes);
        if (value.sessionId !== options.sessionId || value.epoch !== options.epoch
          || manifestDigests.has(id) && manifestDigests.get(id) !== hash)
          throw new TypeError('Manifest inspection identity mismatch');
        manifestDigests.set(id, hash);
      }
      if (path === 'jobs' || path.startsWith('jobs/')) {
        validateJob(value, max);
        const identity = invocationIdentity(value.invocation);
        const previous = jobIdentities.get(value.jobId);
        if (value.invocation.sessionId !== options.sessionId || value.invocation.epoch !== options.epoch
          || previous !== undefined && previous !== identity
          || method === 'POST' && identity !== invocationIdentity(body as NativeInvocation)
          || path.startsWith('jobs/') && value.jobId !== decodeURIComponent(path.slice('jobs/'.length)))
          throw new TypeError('Native job identity mismatch');
        const operation = operationIdentities.get(value.materializationId);
        if (operation !== undefined) {
          const [manifestId, manifestRevision] = JSON.parse(operation.identity) as string[];
          if (manifestId !== value.invocation.manifestId || manifestRevision !== value.invocation.manifestRevision
            || operation.readyRevision !== undefined && operation.readyRevision !== value.directoryRevision)
            throw new TypeError('Native job identity mismatch');
        }
        jobIdentities.set(value.jobId, identity);
      }
      if (path === 'materializations' || path.startsWith('materializations/')) {
        const listing = path === 'materializations' && method === 'GET';
        if (listing && !Array.isArray(value)) throw new TypeError('Invalid materialization listing');
        const observed = new Map<string, { identity: string; readyRevision?: string }>();
        for (const status of listing ? value as unknown[] : [value]) {
          validateStatus(status);
          const identity = JSON.stringify([status.manifestId, status.manifestRevision, status.logicalRoot, status.cwd, status.entries.length]);
          const previous = operationIdentities.get(status.operationId);
          if ((previous !== undefined && (previous.identity !== identity
            || previous.readyRevision !== undefined && previous.readyRevision !== status.directoryRevision))
            || observed.has(status.operationId)) throw new TypeError('Materialization identity mismatch');
          observed.set(status.operationId, { identity, readyRevision: previous?.readyRevision ?? (status.state === 'ready' ? status.directoryRevision! : undefined) });
          const manifest = manifestIdentities.get(status.manifestId);
          if (manifest !== undefined) {
            if (status.entries.length !== manifest.entryCount) throw new TypeError('Incomplete materialization status');
            if (status.manifestRevision !== manifest.revision
              || JSON.stringify(status.logicalRoot) !== manifest.logicalRoot
              || JSON.stringify(status.cwd) !== manifest.cwd) throw new TypeError('Manifest identity mismatch');
          }
          if (path.startsWith('materializations/') && status.operationId !== decodeURIComponent(path.slice('materializations/'.length))) throw new TypeError('Materialization identity mismatch');
          if (method === 'POST') {
            const input = body as DependencyMaterializeRequest;
            if (status.manifestId !== input.manifestId || status.manifestRevision !== input.manifestRevision) throw new TypeError('Manifest identity mismatch');
            // Initial readiness requires a complete starting tree. Inspection
            // may later report live readiness loss without discarding the
            // admitted revision; execution revalidates that work independently.
            if (status.state === 'ready' && status.readiness !== undefined
              && (!status.readiness.some(work => work.kind === 'required')
                || status.readiness.some(work => work.kind === 'required' && work.state !== 'complete')))
              throw new TypeError('Incomplete required readiness');
          }
        }
        // Retain only fully validated observations; progress and readiness may
        // evolve, but an operation cannot acquire another admitted tree.
        for (const [id, identity] of observed) operationIdentities.set(id, identity);
      }
      return value as T;
    } finally { signal?.removeEventListener('abort', abort); await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
  }
  return {
    async putManifest(manifest: DependencyManifest, signal?: AbortSignal): Promise<StoredManifest> {
      const document = structuredClone(manifest);
      validateDependencyManifest(document, { maxEntries: max, maxPathBytes: max });
      if (document.sessionId !== options.sessionId || document.epoch !== options.epoch)
        throw new TypeError('Manifest scope mismatch');
      const receipt = await request<StoredManifest>('manifests', 'POST', document, signal);
      manifestIdentities.set(receipt.manifestId, { revision: document.revision, logicalRoot: JSON.stringify(document.logicalRoot), cwd: JSON.stringify(document.cwd), entryCount: document.entries.length });
      return receipt;
    },
    async inspectManifest(id: string, signal?: AbortSignal): Promise<DependencyManifest> {
      const manifest = await request<DependencyManifest>(`manifests/${encodeURIComponent(id)}`, 'GET', undefined, signal);
      manifestIdentities.set(id, { revision: manifest.revision, logicalRoot: JSON.stringify(manifest.logicalRoot), cwd: JSON.stringify(manifest.cwd), entryCount: manifest.entries.length });
      return manifest;
    },
    materialize(input: DependencyMaterializeRequest, signal?: AbortSignal): Promise<MaterializationStatus> { return request('materializations', 'POST', input, signal, input.operationKey); },
    inspectMaterialization(id: string, signal?: AbortSignal): Promise<MaterializationStatus> { return request(`materializations/${encodeURIComponent(id)}`, 'GET', undefined, signal); },
    listMaterializations(signal?: AbortSignal): Promise<MaterializationStatus[]> { return request('materializations', 'GET', undefined, signal); },
    execute(input: NativeInvocation, signal?: AbortSignal, key?: string): Promise<NativeJob> { return request('jobs', 'POST', input, signal, key); },
    inspectJob(id: string, signal?: AbortSignal): Promise<NativeJob> { return request(`jobs/${encodeURIComponent(id)}`, 'GET', undefined, signal); },
  };
}
