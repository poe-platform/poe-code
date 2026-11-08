import {createJobStateJournal, type JobStateEvent} from './job-state.js';
import {exactByteBody} from './http-byte-body.js';
import {parseWireJson} from './wire-json.js';
import {validateDependencyManifest, validateDependencyMaterialization, validateManifestInvocation, type DependencyManifest, type DependencyMaterializeRequest, type DependencyMaterialization} from './protocol.js';
import {validateCallbackResult} from './callback-result.js';
import type {AdmissionStore}from'./admissions.js';
import { createHash, randomUUID } from 'node:crypto';
import { createUploadServer, type UploadPrincipal, type UploadStorage } from './server.js';
import { admitFileListing, FileListingError, createFileServer,type FileServer,type FileScope,type RetainedReadFile } from './files.js';
import { UploadError } from './upload-protocol.js';
import { binaryContentType, decodeFrames,encodeFrame, type BinaryOptions } from './binary.js';
import { createFrameJournal, type FrameJournal } from './journal.js';
import { validateWire } from './wire-validation.js';
import type { NativeProcess, ProcessStreams } from './native-process.js';
import type { DependencyJobRequest, FileOpenRequest,FileListRequest,FileListing,Build, EffectReceipt, ChannelOpen, Callback, CallbackResult, Effect, FileOperation, Grant, Job, JobRequest, Lane, Limits, Manifest, Materialization, MaterializeRequest, Session, SessionRequest } from './wire.generated.js';
export interface MediaPrincipal { tenantId: string; principalId: string; expiresAt: number; sessionId?:string; epoch?:string; invocationId?:string }
export interface MediaTool {
  id: string; buildDigest: string; executable: string; requiredFeatures: readonly string[];
  /** Media definitions require the shipped frontend identity; generic tools need
   * no grammar knowledge. Any supplied identity must still match the build. */
  requiresFrontendContract?: boolean;
}
export interface InvocationHooks {
  /** Transfer an independently owned, canonical read retain for a job-produced object. */
  retainOutput(identityId: string, resource: RetainedReadFile): Promise<void>;
  openChannel(channel: ChannelOpen): Promise<{readable?:ReadableStream<Uint8Array>;writable?:WritableStream<Uint8Array>}>;
  /** Called at the native access stage, never for speculative prefetch validation.
   * Binary data uses negotiated frame channels, not callback result JSON. */
  request(grantId: string, operation: FileOperation): Promise<CallbackResult>;
  effect(effect: Omit<Effect, 'sequence'>): Promise<void>;
}
export interface PreparedInvocation {
  start(streams: ProcessStreams): NativeProcess;
  /** Drains bridge/effects, releases invocation-owned handles/scratch. */
  close(): Promise<void>;
}
export interface InvocationBlob {
  readonly size:bigint;readonly digest:string;
  read(position:bigint,maxBytes:number,signal:AbortSignal):Promise<Uint8Array>;
}
export type ExecutionRequest = JobRequest | DependencyJobRequest;
export interface SessionAuthority {
  dependencies?: {
    /** Authenticate host-issued binding/source/snapshot and callback grants. No
     * speculative path access or canonical mutation during this admission. */
    authorize(input: {manifest: DependencyManifest; bindingId: string; signal: AbortSignal}): Promise<boolean>;
    /** Install a private, mediated input tree. Never canonical copyback. The
     * returned lease remains owned by the session until jobs drain and close. */
    prepare(input: {operationId: string; request: DependencyMaterializeRequest; manifest: DependencyManifest; blobs: ReadonlyMap<string, InvocationBlob>; hooks: InvocationHooks; signal: AbortSignal}): Promise<{result: DependencyMaterialization; close(): Promise<void>}>;
  };
  files?: {
    open(input:{namespaceId:string;path:string;signal:AbortSignal}):Promise<RetainedReadFile>;
    list(input:{namespaceId:string;path:string;maxEntries:number;signal:AbortSignal}):Promise<FileListing>;
  };
  /** Trusted host-issued grants. Wire IDs cannot recreate these capabilities. */
  grants?: readonly Grant[];
  prepare(input: { stdinBlob?:InvocationBlob;jobId: string; request: ExecutionRequest; tool: MediaTool; build: Build; hooks: InvocationHooks; signal: AbortSignal }): Promise<PreparedInvocation>;
  materialize?(input: { operationId: string; request: MaterializeRequest; manifest: Uint8Array; hooks: InvocationHooks; signal: AbortSignal }): Promise<Materialization>;
  release?(input: { jobId: string; handleIds: readonly string[]; grantIds: readonly string[] }): Promise<void>;
  close(): Promise<void>;
}
export interface MediaIsolationDriver {
  /** Qualified deployment ceilings narrow operator configuration. They never
   * widen it, and are reflected in discovery before resource admission. */
  limits?:Partial<Limits>;
  /** Only capabilities qualified on this build/deployment. Empty evidence refuses
   * capability admission. A fixture receipt qualifies only its in-memory test. */
  features: readonly { name: string; evidence: readonly string[] }[];
  inspectBuild(digest: string): Promise<Build>;
  /** Authenticate canonical namespaces/rights, symlinks, mounts and grants here.
   * No copied workspace or userspace-only interposer may claim live-files. */
  admitSession(input: { principal: MediaPrincipal; request: SessionRequest; signal: AbortSignal }): Promise<SessionAuthority>;
}
export interface MediaServerOptions {
  /** Honor cancellation. Unfinished callbacks retain an admission slot and are
   * drained on shutdown even when their caller has already disconnected. */
  authenticate(request: Request, signal?: AbortSignal): Promise<MediaPrincipal | null>;
  builds: readonly Build[]; tools: readonly MediaTool[]; driver: MediaIsolationDriver;
  admissions:AdmissionStore;
  storage: UploadStorage; limits: Limits; leaseMs: number; retentionMs: number;
  maxDocumentBytes: number;
  /** Retained record ceiling and, independently, each authentication pool's
   * concurrency ceiling. Control capacity is reserved separately from data. */
  maxRecords: number; cleanupGraceMs?:number; now?: () => number;
}
interface NamespaceReservation { tail: Promise<void>; pending: number; operationId?: string; revision?: string }
interface SessionRecord { namespaces?: Map<string, NamespaceReservation>; principal: string; value: Session; deadline: number; retainedUntil: number; authority?: SessionAuthority;files?:FileServer;fileHandles?:Map<string,FileScope>; controller: AbortController; closing?: Promise<void> }
interface CallbackRecord { value: Callback; body?: string; result?: CallbackResult;effect?:Effect;settlement?:Promise<void>; resolve: (r: CallbackResult) => void; reject: (r: unknown) => void }
interface EventOperation {
  privatePreparation?: boolean;
  session: SessionRecord; controller: AbortController; journal: FrameJournal;
  limits: Limits; grants: readonly Grant[]; namespaceId: string; owner: {kind:'job'|'materialization';id:string};
  lanes: Map<string,Lane>;laneAcks:Map<string,bigint>; callbacks: Map<string,CallbackRecord>; callbackBytes: bigint; effectSequence: bigint; effectChain: Promise<void>;
  inputTargets:Map<number,{writer:WritableStreamDefaultWriter<Uint8Array>;correlationId:bigint}>; inputSequence:bigint;inputOffsets:Map<number,bigint>;inputEnded:Set<number>;inputBusy:boolean;
  openedChannels:Set<number>;inputReceipts:Map<bigint,{digest:string;offsets:Map<number,bigint>;size:number}>;inputReplayBytes:number;inputFloor:bigint;inputUncertain:boolean;
  outputHandles?: Map<string, string>;
  outputBindings?: Map<string, { identity: object | symbol; token: string }>;
  outputFailures?: Map<string, string>;
  outputRetainCount?: number;
  effects?: Effect[];
  effectStates?: Map<string,Effect>;
  effectsClosed?: boolean;
  effectRecorded?:(effect:Effect)=>void;
  effectObserved?: (sequence: bigint)=>void;
}
interface MaterializationRecord extends EventOperation { value: Materialization; done: Promise<void>; resolveDone:()=>void }
interface DependencyRecord extends EventOperation { value: DependencyMaterialization; manifest: DependencyManifest; request: DependencyMaterializeRequest; done: Promise<void>; close?:()=>Promise<void> }
interface JobRecord extends EventOperation {
  stateJournal: ReturnType<typeof createJobStateJournal>;
  cancelActed:boolean;
  cancelObservation?:Promise<void>;
  stdinBlob?:InvocationBlob;
  session: SessionRecord; value: Job; request: ExecutionRequest; controller: AbortController;
  journal: FrameJournal; process?: NativeProcess; prepared?: PreparedInvocation;
  done: Promise<void>; resolveDone: () => void; lanes: Map<string, Lane>;
  inputSequence: bigint; inputOffsets: Map<number, bigint>; inputEnded: Set<number>; inputBusy: boolean;
  callbacks: Map<string, CallbackRecord>; callbackBytes: bigint; effectSequence: bigint; effectChain: Promise<void>;
  installationRelease?:()=>void;acquisitionPending?:boolean;timer?: ReturnType<typeof setTimeout>;
}
interface Admission { body: string; resourceId: string; kind: string; session?: SessionRecord; invocationId?:string; state: 'accepted' | 'complete' | 'failed' | 'unknown';result?:unknown }
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+stable((value as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(value);
}
function principalKey(p: MediaPrincipal) { return stable([p.tenantId, p.principalId]); }
/** Generic /v1 service. Its admission/replay ledger is process-local and explicitly
 * advertised as such. Restarted epochs are unknown; never auto-resubmit a process.
 * Operator must call sweep on a lease timer and retain this instance across requests. */
export function createMediaServer(options: MediaServerOptions) {
  // Operator configuration is borrowed. Retain ceilings before asynchronous
  // authentication/admission so later mutation cannot widen session authority
  // or make advertised limits disagree with the upload server's retained budget.
  options = { ...options, limits: { ...options.limits } };
  // Attestation and namespace acquisition must keep the same deployment owner.
  // Replacing borrowed driver methods after discovery cannot change authority.
  const driver = options.driver;
  options.driver = {
    limits: { ...driver.limits }, features: structuredClone(driver.features),
    inspectBuild: driver.inspectBuild.bind(driver),
    admitSession: driver.admitSession.bind(driver),
  };
  validateWire('Limits', options.limits);
  const driverLimits={...options.driver.limits};
  validateWire('Limits',{...options.limits,...driverLimits});
  for(const key of Object.keys(driverLimits) as (keyof Limits)[])options.limits[key]=Math.min(options.limits[key],driverLimits[key]!);
  if(!options.admissions || typeof options.admissions.record!=='function')throw new TypeError('An explicit durable admission store is required');
  for (const n of [options.maxDocumentBytes, options.maxRecords, options.leaseMs, options.retentionMs]) if (!Number.isSafeInteger(n) || n < 1 || n > 2147483647) throw new TypeError('Invalid server bound');
  if (options.limits.maxReplayBytes < 2 * (options.limits.maxFrameBytes + 40) || options.limits.maxInflightBytes < options.limits.maxFrameBytes + 40) throw new TypeError('Frame/replay bounds conflict');
  const cleanupGraceMs=options.cleanupGraceMs??5000;if(!Number.isSafeInteger(cleanupGraceMs)||cleanupGraceMs<1||cleanupGraceMs>2147483647)throw new TypeError('Invalid cleanup grace');
  const now = options.now ?? Date.now; const epoch = randomUUID();
  const builds = new Map(options.builds.map(b => { validateWire('Build', b); if (!b.imageDigest.startsWith('sha256:') || b.imageDigest.length !== 71 || Array.from(b.imageDigest.slice(7)).some(c => !'0123456789abcdef'.includes(c))) throw new TypeError('Container digest must be pinned'); return [b.digest, structuredClone(b)] as const; }));
  const tools = new Map(options.tools.map(t => {
    if (typeof t.executable !== 'string' || !t.executable.startsWith('/') || t.executable.includes('\0') || new TextDecoder('utf-8', {ignoreBOM:true}).decode(new TextEncoder().encode(t.executable)) !== t.executable) throw new TypeError('Invalid pinned executable path');
    if (!builds.has(t.buildDigest) || !Object.hasOwn(builds.get(t.buildDigest)!.executables, t.id)) throw new TypeError('Tool build is not pinned'); return [t.id, structuredClone(t)] as const;
  }));
  if (builds.size !== options.builds.length || tools.size !== options.tools.length) throw new TypeError('Duplicate build/tool');
  const features = ['server-resource-admission-v2', ...options.driver.features.filter(f => f.evidence.some(e => e.length > 0)).map(f => f.name)];
  const admissionLocks = new Set<string>();
  const sessions = new Map<string, SessionRecord>(); const jobs = new Map<string, JobRecord>(); const keys = new Map<string, Admission>();
  const pendingJobs = new Map<SessionRecord, number>();
  const materializations = new Map<string,MaterializationRecord>();
  const dependencies = new Map<string,DependencyRecord>();
  const manifests = new Map<string, { session: SessionRecord; bytes: Uint8Array; digest: string; dependency?:DependencyManifest }>();
  const shutdown = new AbortController();
  const requests = new Set<Promise<void>>();
  const credentials = new Set<Promise<MediaPrincipal | null>>();
  const controlCredentials = new Set<Promise<MediaPrincipal | null>>();
  const authenticatePrincipal = options.authenticate.bind(options);
  let closing: Promise<void> | undefined;
  async function authenticate(request: Request, ownerSignal?: AbortSignal, control = false): Promise<MediaPrincipal | null> {
    const signal = AbortSignal.any([request.signal, shutdown.signal, ...(ownerSignal ? [ownerSignal] : [])]);
    signal.throwIfAborted();
    const admissions = control ? controlCredentials : credentials;
    if (admissions.size >= options.maxRecords) throw new UploadError(429, 'Authentication concurrency bound');
    let abort!: () => void;
    const canceled = new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, {once: true});
    });
    // Reserve before invoking host code, including synchronous throws and
    // reentrant requests. Cancellation never releases unfinished host work.
    const work = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return authenticatePrincipal(request, signal);
    });
    admissions.add(work);
    void work.then(() => admissions.delete(work), () => admissions.delete(work));
    try {
      const principal = await Promise.race([work, canceled]);
      signal.throwIfAborted();
      return principal;
    } finally { signal.removeEventListener('abort', abort); }
  }
  function reserve(size: number) { if (size >= options.maxRecords) throw new UploadError(429, 'Admission retention bound'); }
  function checkPrincipal(p: MediaPrincipal) {
    // Scope presence must never become a truthiness check: an empty or malformed
    // host credential would otherwise silently acquire unrestricted authority.
    for (const field of ['tenantId','principalId','sessionId','epoch','invocationId'] as const) {
      const value = p[field];
      if (value === undefined && field !== 'tenantId' && field !== 'principalId') continue;
      if (typeof value !== 'string' || !value || value.length > 256 || value.includes('\0')
        || new TextDecoder('utf-8', {ignoreBOM:true}).decode(new TextEncoder().encode(value)) !== value) throw new UploadError(401, 'Invalid credential identity or scope');
    }
    if (!Number.isFinite(p.expiresAt) || p.expiresAt <= now()) throw new UploadError(401, 'Authentication expired');
  }
  function getSession(id: string, p: MediaPrincipal, request: Request, allowClosing = false) {
    if(p.sessionId && p.sessionId!==id || p.epoch && p.epoch!==epoch)throw new UploadError(404,'Credential scope does not match session');
    if(request.headers.get('Execution-Epoch')!==epoch)throw new UploadError(410,'Sandbox epoch lost; outcome unknown');
    const s = sessions.get(id); if (!s || s.principal !== principalKey(p)) throw new UploadError(404, 'Unknown session');
    if (request.headers.get('Execution-Epoch') !== epoch || s.retainedUntil <= now()) throw new UploadError(410, 'Session epoch or retention expired');
    if (!allowClosing && (s.deadline <= now() || s.value.state !== 'open')) throw new UploadError(410, 'Session lease expired or closed'); return s;
  }
  function uploadPrincipal(p: MediaPrincipal, s: SessionRecord): UploadPrincipal { return { ...p, sessionId: s.value.sessionId, epoch, sessionExpiresAt: s.deadline, sessionSignal: s.controller.signal }; }
  const uploads = createUploadServer({ storage: options.storage, now, authenticate: async (request, signal) => {
    const authenticated = await authenticate(request, signal, request.method === 'DELETE'); if (!authenticated) return null;
    const p: MediaPrincipal = {
      tenantId: authenticated.tenantId, principalId: authenticated.principalId,
      expiresAt: authenticated.expiresAt, sessionId: authenticated.sessionId,
      epoch: authenticated.epoch, invocationId: authenticated.invocationId,
    };
    checkPrincipal(p);
    // Uploads and blobs are session resources. Reauthentication may narrow a
    // credential after the outer route admitted it; never drop that restriction
    // when converting it to the upload service's session-only authority.
    if (p.invocationId !== undefined) throw new UploadError(403, 'Invocation credential cannot access session uploads or blobs');
    const id = decodeURIComponent(new URL(request.url).pathname.split('/')[3] ?? ''); return uploadPrincipal(p, getSession(id, p, request));
  }, limits: { maxBlobBytes: BigInt(options.limits.maxBlobBytes), maxReservedBytes: BigInt(options.limits.maxBlobBytes), maxChunkBytes: options.limits.maxFrameBytes, maxConcurrent: options.limits.maxJobs, maxUploads: options.maxRecords, maxChunks: options.maxRecords } });
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Execution-Epoch': epoch, 'Execution-Protocol': '1', 'Execution-Recovery': 'process-local', 'Cache-Control': 'no-store' } });
  function dependencyJson(value:unknown){const response=json(value);response.headers.set('Execution-Profile','dependency-manifest-v1');return response;}
  async function readBody(request: Request, max = options.maxDocumentBytes): Promise<Uint8Array> {
    const claimed = request.headers.get('Content-Length'); if (claimed && (!Array.from(claimed).every(c => c >= '0' && c <= '9') || BigInt(claimed) > BigInt(max))) throw new UploadError(413, 'Document length bound');
    const reader = request.body?.getReader(); if (!reader) return new Uint8Array();
    const controller = new AbortController(); const signal = AbortSignal.any([request.signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(new UploadError(408, 'Document read deadline')), options.leaseMs);
    const abort = () => { void reader.cancel(signal.reason).catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) {
      signal.throwIfAborted(); const next = await reader.read(); signal.throwIfAborted(); if (next.done) break;
      if (!(next.value instanceof Uint8Array)) throw new UploadError(400, 'Document bytes required');
      const length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(next.value) as number;
      if (length > max - size) throw new UploadError(413, 'Document length bound');
      chunks.push(new Uint8Array(next.value)); size += length;
    }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  function limitsWithin(limits: Limits, ceiling: Limits) {
    for (const [key, value] of Object.entries(limits)) if (value > ceiling[key as keyof Limits]) throw new UploadError(413, 'Requested limits exceed capability');
    if (2 * (limits.maxFrameBytes + 40) > limits.maxReplayBytes || limits.maxFrameBytes + 40 > limits.maxInflightBytes) throw new UploadError(413, 'Frame bounds conflict');
  }
  async function verifyBuild(digest: string): Promise<Build> {
    const expected = builds.get(digest); if (!expected) throw new UploadError(409, 'Unknown native build');
    const observed = await options.driver.inspectBuild(digest); validateWire('Build', observed);
    if (stable(observed) !== stable(expected)) throw new UploadError(409, 'Frontend/native build identity differs'); return structuredClone(observed);
  }
  function keyFor(p: MediaPrincipal, request: Request, s?: SessionRecord): string {
    const key = request.headers.get('Idempotency-Key'); if (!key || key.length > 256) throw new UploadError(400, 'Idempotency-Key required');
    return stable([principalKey(p), s?.value.sessionId ?? null, epoch, key]);
  }
  function grantFor(s: SessionRecord, requested: Grant) {
    const host = s.authority?.grants?.find(g => g.grantId === requested.grantId);
    if (!host || requested.namespaceId !== host.namespaceId || requested.root !== host.root || requested.handleId !== host.handleId || requested.operations.some(op => !host.operations.includes(op)) || BigInt(requested.maxBytes) > BigInt(host.maxBytes) || requested.maxOperations > host.maxOperations || Date.parse(requested.expiresAt) > Date.parse(host.expiresAt) || Date.parse(requested.expiresAt) <= now()) throw new UploadError(403, 'Grant exceeds trusted host authority');
    if(requested.ranges?.some(range=>BigInt(range.start)>BigInt(range.endExclusive)) || host.ranges && (!requested.ranges || requested.ranges.some(range=>!host.ranges!.some(allowed=>BigInt(range.start)>=BigInt(allowed.start)&&BigInt(range.endExclusive)<=BigInt(allowed.endExclusive)))))throw new UploadError(403,'Range grant exceeds trusted host authority');
  }
  async function control(job: EventOperation, value: unknown, signal = job.controller.signal) {
    validateWire('Control', value); await job.journal.append('control', 0, new TextEncoder().encode(JSON.stringify(value)), 0n, signal);
  }
  async function receipt(job:EventOperation,effect:Effect) {
    const value:EffectReceipt={operationId:effect.operationId,sequence:effect.sequence,operation:effect.operation,state:effect.state,...(effect.acknowledgedBytes!==undefined?{acknowledgedBytes:effect.acknowledgedBytes}:{}),...(effect.revision!==undefined?{revision:effect.revision}:{})};
    const [tenantId,principalId]=JSON.parse(job.session.principal) as [string,string];
    try {
      // Storage owns its carrier, not the acknowledged native observation.
      // A retained or mutated carrier must not rewrite completed byte counts,
      // revisions or settlement state in subsequent inspection receipts.
      await options.admissions.record({operationId:createHash('sha256').update(stable([job.owner.id,effect.operationId,effect.state])).digest('hex'),epoch,tenantId,principalId,sessionId:job.session.value.sessionId,kind:'effect-receipt',retainedUntil:job.session.retainedUntil,requestDigest:createHash('sha256').update(stable(value)).digest('hex'),buildDigest:job.session.value.buildDigest,effectReceipt:structuredClone(value)});
    } catch (cause) {
      // The external effect or durable receipt may already exist. Close native
      // admission and wake callbacks without granting replay or rollback authority.
      const error=Object.assign(new UploadError(503,'Durable effect receipt unavailable; outcome unknown'),{cause});
      job.controller.abort(error);throw error;
    }
    if(job.owner.kind==='job'){
      const native=jobs.get(job.owner.id);if(native){native.value.effectReceipts??=[];const index=native.value.effectReceipts.findIndex(e=>e.operationId===value.operationId);if(index<0)native.value.effectReceipts.push(value);else native.value.effectReceipts[index]=value;}
    }
  }
  async function recordEffect(job:EventOperation,input:Omit<Effect,'sequence'>,signal=job.controller.signal):Promise<Effect> {
    if(job.effectsClosed)throw new UploadError(410,'Effect admission closed');
    validateWire('Effect',{...input,sequence:'1'});
    const states=job.effectStates??=new Map<string,Effect>();
    const previous=states.get(input.operationId);
    if(previous){
      for(const key of ['operation','namespaceId','path','destination','offset','length','handleId','identityId'] as const){
        if(previous[key]!==input[key] && (previous[key]!==undefined || key!=='handleId'&&key!=='identityId'))throw new UploadError(409,'Effect operation identity conflict');
      }
      const repeated={...input,sequence:previous.sequence};
      if(stable(previous)===stable(repeated))return previous;
      if(previous.state!=='requested'||input.state==='requested')throw new UploadError(409,'Effect settlement conflict');
    }else{
      if(job.effectSequence>=BigInt(job.limits.maxCallbacks))throw new UploadError(429,'Effect receipt retention bound');
      job.effectSequence++;job.effectObserved?.(job.effectSequence);
    }
    const effect:Effect={...input,sequence:previous?.sequence??String(job.effectSequence)};
    states.set(effect.operationId,structuredClone(effect));
    job.effects?.push(structuredClone(effect));
    await receipt(job,effect);job.effectRecorded?.(effect);
    await control(job,{type:'Effect',effect},signal);
    return effect;
  }
  async function settleEffects(job:EventOperation,signal:AbortSignal):Promise<void> {
    for(const effect of job.effectStates?.values()??[]){
      if(effect.state==='requested')await recordEffect(job,{...effect,state:'unknown'},signal);
    }
  }
  const outputServers = new Map<string, FileServer>();
  function outputScope(job: EventOperation): FileScope { return { tenantId: job.session.principal, sessionId: job.session.value.sessionId, epoch, invocationId: job.owner.id }; }
  async function closeOutputs(job: EventOperation) {
    const results = await Promise.allSettled([...(job.outputHandles?.values() ?? [])].map(async handle => { const server = outputServers.get(handle); try { await server?.disposeAll(); } finally { outputServers.delete(handle); } }));
    job.outputHandles?.clear();
    job.outputBindings?.clear();
    const failures = results.filter(result => result.status === 'rejected'); if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Output cleanup failed');
  }
  function hooksFor(job: EventOperation): InvocationHooks {
    const channelUsage = new Map<string, { bytes: bigint; operations: number }>();
    return {
      async retainOutput(identityId, resource) {
        try {
          if (typeof identityId !== 'string' || !identityId || identityId.length > 256) throw new TypeError('Invalid output identity');
          if (job.owner.kind !== 'job' || jobs.get(job.owner.id)?.value.state === 'terminal') throw new UploadError(410, 'Output admission closed');
          job.outputHandles ??= new Map();
          if (job.outputHandles.has(identityId)) throw new UploadError(409, 'Output identity already retained');
          if ((job.outputRetainCount ?? 0) >= job.limits.maxHandles + job.limits.maxCallbacks) throw new UploadError(429, 'Output retention metadata bound');
          job.outputRetainCount = (job.outputRetainCount ?? 0) + 1;

        } catch (error) { await resource.close(); throw error; }
        if (job.outputHandles!.size >= job.limits.maxHandles) {
          const cleanup = await Promise.allSettled([resource.close()]);
          (job.outputFailures ??= new Map()).set(identityId, cleanup[0].status === 'rejected' ? 'Output retention bound; retain cleanup failed' : 'Output retention bound'); return;
        }
        job.outputHandles!.set(identityId, '');
        // The server-local acquire closure carries the retain, never a pathname.
        // Each identity gets its own file server so unrelated identities cannot
        // select another acquisition capability.
        const output = createFileServer({ maxHandles: 1, maxFrameBytes: job.limits.maxFrameBytes, async open() { return resource; } });
        const scope = outputScope(job);
        let handle: string;
        try { handle = await output.open(scope, { namespaceId: job.namespaceId, path: identityId }, job.session.controller.signal); }
        catch (error) { job.outputHandles!.delete(identityId); (job.outputFailures ??= new Map()).set(identityId, error instanceof Error ? error.message : String(error)); return; }
        job.outputHandles!.set(identityId, handle);
        outputServers.set(handle, output);
      },
      async openChannel(channel) {
        validateWire('ChannelOpen',channel); job.controller.signal.throwIfAborted();
        if(job.openedChannels.size>=job.limits.maxHandles||job.openedChannels.has(channel.channelId))throw new UploadError(413,'Callback channel count/collision');
        const grant=job.grants.find(g=>(g.handleId===channel.resourceId || g.grantId===channel.resourceId) && g.operations.includes(channel.direction) && Date.parse(g.expiresAt)>now() && !g.ranges);
        if(!grant)throw new UploadError(403,'Channel resource, rights, expiry or range authority is not admitted');
        if(channel.seekable)throw new UploadError(422,'Seekable channel requires a qualified retained descriptor, not a streaming pipe');
        const usage=channelUsage.get(grant.grantId)??{bytes:0n,operations:0};
        channelUsage.set(grant.grantId,usage);
        function admitBytes(bytes:Uint8Array){
          job.controller.signal.throwIfAborted();
          if(Date.parse(grant!.expiresAt)<=now())throw new UploadError(403,'Channel grant expired');
          if(!(bytes instanceof Uint8Array))throw new UploadError(413,'Channel frame byte bound');
          const length=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength')!.get!.call(bytes) as number;
          if(length>job.limits.maxFrameBytes)throw new UploadError(413,'Channel frame byte bound');
          const callbacks=[...job.callbacks.values()].filter(c=>c.value.grantId===grant!.grantId);
          if(usage.operations+callbacks.length>=grant!.maxOperations)throw new UploadError(429,'Channel grant operation bound');
          const callbackBytes=callbacks.reduce((sum,c)=>sum+('length'in c.value.operation?BigInt(c.value.operation.length):0n),0n);
          if(usage.bytes+callbackBytes+BigInt(length)>BigInt(grant!.maxBytes))throw new UploadError(413,'Channel grant byte bound');
          // Reserve before any awaited copy/write; failures cannot replenish an
          // ambiguous transfer and sibling channels share the same authority.
          usage.bytes+=BigInt(length);usage.operations++;
        }
        job.openedChannels.add(channel.channelId);
        if(channel.direction==='write') {
          job.journal.openChannel(channel.channelId);await control(job,channel);
          return {writable:new WritableStream<Uint8Array>({async write(bytes){admitBytes(bytes);await job.journal.append('data',channel.channelId,bytes,BigInt(channel.correlationId),job.controller.signal);},async close(){await job.journal.append('end',channel.channelId,new Uint8Array(),BigInt(channel.correlationId),job.controller.signal);}})};
        }
        const handoff=new TransformStream<Uint8Array,Uint8Array>({transform(bytes,c){admitBytes(bytes);c.enqueue(bytes.slice());}},undefined,{highWaterMark:0});
        const writer=handoff.writable.getWriter();job.inputTargets.set(channel.channelId,{writer,correlationId:BigInt(channel.correlationId)});job.inputOffsets.set(channel.channelId,0n);
        const abort=()=>{void writer.abort(job.controller.signal.reason).catch(()=>{});};job.controller.signal.addEventListener('abort',abort,{once:true});
        await control(job,channel);return {readable:handoff.readable};
      },
      async effect(effect) {
        validateWire('Effect', { ...effect, sequence: '1' });
        const snapshot=structuredClone(effect);
        const work = job.effectChain.then(async () => { await recordEffect(job,snapshot); });
        job.effectChain = work; return work;
      },
      async request(grantId, operation) {
        validateWire('FileOperation', operation); job.controller.signal.throwIfAborted();
        if(job.privatePreparation && (!['open','read','seek','stat','lstat','readdir','readlink','close'].includes(operation.op) || operation.op==='open' && (operation.flag!=='r'||operation.rights.includes('write'))))throw new UploadError(403,'Private preparation cannot mutate canonical files');
        // Native hooks borrow caller data. Retain the admitted operation before
        // journaling yields, so later mutations cannot replace its authority.
        operation = structuredClone(operation);
        const grant = job.grants.find(g => g.grantId === grantId);
        if (!grant || !grant.operations.includes(operation.op) || Date.parse(grant.expiresAt) <= now()) throw new UploadError(403, 'Native callback grant refused');
        if (grant.handleId && (!('handleId' in operation) || operation.handleId !== grant.handleId)) throw new UploadError(403, 'Native callback handle authority refused');
        if(grant.ranges && operation.op!=='stat' && operation.op!=='close'){
          if((operation.op!=='read'&&operation.op!=='write') || operation.handleId!==grant.handleId || operation.position===undefined || !grant.ranges.some(range=>BigInt(operation.position!)>=BigInt(range.start) && BigInt(operation.position!)+BigInt(operation.length)<=BigInt(range.endExclusive)))throw new UploadError(403,'Native callback range authority refused');
        }
        if(grant.ranges && 'handleId' in operation && operation.handleId!==grant.handleId)throw new UploadError(403,'Native callback handle authority refused');
        const streamed=channelUsage.get(grantId);
        if (job.callbacks.size >= job.limits.maxCallbacks || (streamed?.operations??0)+[...job.callbacks.values()].filter(c=>c.value.grantId===grantId).length >= grant.maxOperations) throw new UploadError(429, 'Native callback count bound');
        const length = 'length' in operation ? BigInt(operation.length) : 0n;
        if (length > BigInt(job.limits.maxInflightBytes) || (streamed?.bytes??0n)+[...job.callbacks.values()].filter(c=>c.value.grantId===grantId).reduce((n,c)=>n+('length'in c.value.operation?BigInt(c.value.operation.length):0n),0n)+length > BigInt(grant.maxBytes)) throw new UploadError(413, 'Native callback byte bound');
        job.callbackBytes += length;
        const callbackId = randomUUID(); const operationId = randomUUID();
        const value: Callback = { type: 'Callback', callbackId, operationId, correlationId: String(job.callbacks.size + 1), epoch, grantId, namespaceId: grant.namespaceId ?? job.namespaceId,
          expiresAt: new Date(Math.min(job.session.deadline, Date.parse(grant.expiresAt))).toISOString(), operation, owner: { ...job.owner } };
        let resolve!: (r: CallbackResult) => void; let reject!: (r: unknown) => void; const result = new Promise<CallbackResult>((yes, no) => { resolve = yes; reject = no; });
        void result.catch(() => {}); const record: CallbackRecord = { value, resolve, reject }; job.callbacks.set(callbackId, record);
        const abort = () => reject(job.controller.signal.reason); job.controller.signal.addEventListener('abort', abort, { once: true });
        try {
          const admission=job.effectChain.then(async()=>{
            if(job.effectSequence>=BigInt(job.limits.maxCallbacks))throw new UploadError(429,'Effect receipt retention bound');
            const [tenantId,principalId]=JSON.parse(job.session.principal)as[string,string];
            try {
              await options.admissions.record({operationId,epoch,tenantId,principalId,sessionId:job.session.value.sessionId,kind:'callback',retainedUntil:job.session.retainedUntil,buildDigest:job.session.value.buildDigest,requestDigest:createHash('sha256').update(JSON.stringify(value)).digest('hex')});
            } catch (cause) {
              const error=Object.assign(new UploadError(503,'Durable callback admission unavailable; outcome unknown'),{cause});
              job.controller.abort(error);throw error;
            }
            job.controller.signal.throwIfAborted();
            record.effect=await recordEffect(job,{operationId,operation:operation.op,state:'requested',namespaceId:value.namespaceId,...('path'in operation?{path:operation.path}:{}),...('destination'in operation?{destination:operation.destination}:{}),...('handleId'in operation?{handleId:operation.handleId}:{}),...('position'in operation && operation.position!==undefined?{offset:operation.position}:{}),...('length'in operation?{length:operation.length}:{})});
            await control(job,value);
          });job.effectChain=admission;await admission;return await result;
        }
        finally { job.controller.signal.removeEventListener('abort', abort); }
      },
    };
  }
  async function observeWithin<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
    signal.throwIfAborted();let abort!:()=>void;
    const canceled=new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
    try{return await Promise.race([promise,canceled]);}finally{signal.removeEventListener('abort',abort);}
  }
  async function reserveNamespace(session:SessionRecord,namespaceId:string,signal:AbortSignal) {
    const namespaces=session.namespaces??=new Map<string,NamespaceReservation>();
    let namespace=namespaces.get(namespaceId);
    if(!namespace){namespace={tail:Promise.resolve(),pending:0};namespaces.set(namespaceId,namespace);}
    if(namespace.pending>=options.maxRecords)throw new UploadError(429,'Namespace reservation bound');
    namespace.pending++;
    const previous=namespace.tail;let finish!:()=>void;
    const held=new Promise<void>(resolve=>{finish=resolve;});
    namespace.tail=previous.then(()=>held);
    let released=false;
    const release=()=>{if(!released){released=true;namespace!.pending--;finish();}};
    try{await observeWithin(previous,signal);signal.throwIfAborted();return{namespace,release};}
    catch(error){release();throw error;}
  }
  async function withDeadline<T>(work:(signal:AbortSignal)=>Promise<T>,duration=cleanupGraceMs):Promise<T>{
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(new UploadError(503,'Settlement deadline; outcome unknown')),duration);timer.unref?.();
    try{return await observeWithin(Promise.resolve().then(()=>work(controller.signal)),controller.signal);}finally{clearTimeout(timer);}
  }
  async function transition(job:JobRecord,stage:JobStateEvent['stage'],outputComplete=job.value.outputComplete) {
    const event=await job.stateJournal.append({stage,retainedUntil:Date.parse(job.value.retainedUntil),effectBarrier:job.value.effectBarrier,cancelRequested:job.value.cancelRequested,cancelActed:job.cancelActed,outputComplete,cleanup:job.value.cleanup,...(job.value.processOutcome?{processOutcome:structuredClone(job.value.processOutcome)}:{})});
    if(job.value.state!=='terminal')job.value.jobState=event;
  }
  async function run(job: JobRecord, tool: MediaTool, build: Build) {
    let observationsClosed = false;
    try {
      // Durable admission may yield to a deployment change. Reattest before
      // namespace preparation can acquire handles or apply native effects.
      await observeWithin(verifyBuild(build.digest),job.controller.signal);
      job.controller.signal.throwIfAborted();
      job.acquisitionPending=true;const preparation = Promise.resolve().then(async()=>{
        job.controller.signal.throwIfAborted();
        const acquired = await job.session.authority!.prepare({ stdinBlob:job.stdinBlob,jobId: job.value.jobId, request: structuredClone(job.request), tool: structuredClone(tool), build, hooks: hooksFor(job), signal: job.controller.signal });
        const close = acquired.close.bind(acquired);
        try { return { start: acquired.start.bind(acquired), close }; }
        catch (failure) {
          try { await close(); }
          catch (retirement) { throw new AggregateError([failure, retirement], 'Invocation acquisition and retirement failed'); }
          throw failure;
        }
      });
      void preparation.then(()=>job.installationRelease?.(),()=>job.installationRelease?.());
      try{job.prepared=await observeWithin(preparation,job.controller.signal);job.acquisitionPending=false;}catch(error){void preparation.then(async late=>{await late.close();job.acquisitionPending=false;job.value.cleanup='complete';}).catch(()=>{job.value.cleanup='unknown';});throw error;}
      job.controller.signal.throwIfAborted();
      const signal = job.controller.signal;
      await observeWithin(transition(job,'running'),signal);
      // Installation and durable publication are asynchronous boundaries too.
      // The isolation driver must retain its pinned assets through actual exec.
      await observeWithin(verifyBuild(build.digest),signal);
      signal.throwIfAborted();
      job.process = job.prepared.start({ async output(channelId, bytes) { await job.journal.append('data', channelId, bytes, 0n, signal); }, async end(channelId) { await job.journal.append('end', channelId, new Uint8Array(), 0n, signal); } });
      job.value.state = 'running';
      const exitObservation=job.process.exit.then(async outcome=>{
        // Final publication closes native observation authority before its
        // durable write yields. A late provider reply cannot revise retained
        // loss evidence, even while that publication is still in flight.
        if(observationsClosed)throw new UploadError(503,'Native observation arrived after settlement authority closed');
        // Own the observation before durable publication yields. Driver result
        // carriers cannot revise a known exit or its later settlement receipts.
        outcome=structuredClone(outcome);
        // Resolving the observation promise is not proof of a native exit.
        // Provider/transport uncertainty must not acquire completion authority
        // merely because output producers have already sent their END frames.
        if (outcome.kind === 'spawnError' || outcome.kind === 'unknown' || outcome.kind === 'executionError' || outcome.kind === 'canceled' && !outcome.terminationConfirmed) {
          job.value.outcome = { kind: 'unknown', reason: 'Native exit observation unavailable' };
          throw new UploadError(503, 'Native exit observation unavailable; inspect retained invocation');
        }
        job.value.processOutcome=outcome;
        if(job.value.state!=='terminal'){job.value.outcome=outcome;job.value.state='draining';}
        // Durable observation must not wait for output credit: publication can
        // remain blocked across a disconnect after the native leader has exited.
        await transition(job,'process-exited');
        return outcome;
      });
      void exitObservation.catch(()=>{});
      const runningPublication=control(job, { type: 'JobState', job: structuredClone(job.value) });
      void runningPublication.catch(error=>{if(!signal.aborted)job.controller.abort(error);});
      await observeWithin(exitObservation,signal);
      // Preserve the observed leader exit independently of group death and I/O.
      // Retirement may stall or fail; recovery must still retain this outcome.
      // Inherited pipes may outlive the leader. Retire delegates without closing
      // output lanes, so buffered bytes and admitted canonical effects can drain.
      await observeWithin(Promise.resolve().then(()=>job.process!.terminateGroup?.()),signal);
      await observeWithin(runningPublication,signal);
      await control(job, { type: 'JobState', job: structuredClone(job.value) });
      await observeWithin(job.process.settled,signal);
    } catch (error) {
      if (!job.value.outcome) job.value.outcome = { kind: 'unknown', reason: job.controller.signal.aborted ? 'Cancellation termination has not been observed' : 'Native launch or execution observation unavailable' };
      if (!job.controller.signal.aborted) job.controller.abort(error);
    } finally {
      if(!job.acquisitionPending)job.installationRelease?.();
      clearTimeout(job.timer);
      // Drain effects before retiring native ownership, but a failed effect must
      // not skip retirement. Likewise every invocation handle gets a close attempt.
      const cleanup = await Promise.allSettled([withDeadline(()=>job.effectChain)]);
      cleanup.push(...await Promise.allSettled([withDeadline(()=>Promise.resolve(job.prepared?.close()))]));
      cleanup.push(...await Promise.allSettled([...(job.session.fileHandles??[])].filter(([,scope])=>scope.invocationId===job.value.jobId).map(([id,scope])=>withDeadline(async()=>{await job.session.files!.close(scope,id);job.session.fileHandles!.delete(id);}))));
      cleanup.push(...await Promise.allSettled([withDeadline(signal=>settleEffects(job,signal))]));
      job.effectsClosed=true;
      job.value.cleanup=job.acquisitionPending || cleanup.some(result=>result.status==='rejected')?'unknown':'complete';
      if(job.value.cleanup==='unknown')job.value.outcome = { kind: 'unknown', reason: 'Native I/O or owned cleanup settlement unavailable' };
      let outputComplete = !job.controller.signal.aborted && job.journal.channelsEnded && job.value.cleanup==='complete' && ![...(job.effectStates?.values()??[])].some(effect=>effect.state==='requested'||effect.state==='unknown');
      observationsClosed=true;
      try{await withDeadline(()=>transition(job,outputComplete?'io-settled':'unknown-outcome',outputComplete));}
      catch{outputComplete=false;job.value.outcome={kind:'unknown',reason:'Durable I/O settlement unavailable'};}
      job.value.state='terminal';job.value.outputComplete=outputComplete;
      if(!job.value.outputComplete){job.value.outcome={kind:'unknown',reason:'Output channel END or I/O settlement unavailable'};job.journal.fail(new UploadError(503,'Output settlement unknown'));}else{
      try { await withDeadline(signal=>control(job, { type: 'JobState', job: structuredClone(job.value) },signal),Math.min(options.leaseMs,5000)); job.journal.seal(); }
      catch (error) { job.journal.fail(error); }}
      job.resolveDone();
    }
  }
  function cancel(job: JobRecord) {
    const alreadyRequested = job.value.cancelRequested;
    job.value.cancelRequested = true;
    if(alreadyRequested || job.cancelActed || job.value.processOutcome || job.value.state==='terminal')return;
    if (!job.process) {
      job.cancelActed=true;
      job.controller.abort(new UploadError(410, 'Job canceled before process acquisition'));
      return;
    }
    try {
      job.process.signal('SIGTERM');
      job.cancelActed=true;
    } catch (cause) {
      // A failed provider receipt may hide delivered termination. Retire owned
      // work without asserting an action, native exit or safe signal replay.
      job.controller.abort(Object.assign(new UploadError(503, 'Cancellation delivery unavailable; outcome unknown'), { cause }));
    }
  }
  async function closeSession(s: SessionRecord) {
    if (s.closing) return s.closing;
    s.value.state = 'closing'; s.controller.abort(new UploadError(410, 'Session closed'));
    s.closing = (async () => { const owned = [...jobs.values()].filter(j => j.session === s); for (const j of owned){cancel(j);j.controller.abort(new UploadError(410,'Session lease closed'));} const applying=[...materializations.values(),...dependencies.values()].filter(op=>op.session===s);for(const op of applying)op.controller.abort(new UploadError(410,'Materialization authority expired'));await Promise.all([...owned.map(j=>j.done),...applying.map(op=>op.done)]);
      const cleanup=await Promise.allSettled([
        ...owned.map(closeOutputs),...([...dependencies.values()].filter(op=>op.session===s).map(async op=>op.close?.())),
        Promise.resolve().then(()=>s.files?.disposeAll()),
        Promise.resolve().then(()=>{
          const [tenantId,principalId]=JSON.parse(s.principal) as [string,string];
          return uploads.retireSession({tenantId,principalId,sessionId:s.value.sessionId,epoch});
        }),
      ]);cleanup.push(...await Promise.allSettled([Promise.resolve().then(()=>s.authority?.close())]));
      // A terminal job may retain an unknown invocation retirement. Draining
      // its done promise cannot certify that those native resources retired.
      for(const job of owned)if(job.value.cleanup!=='complete')cleanup.push({status:'rejected',reason:Object.assign(new UploadError(503,'Invocation cleanup remains unknown'),{code:'cleanup-unsettled',recovery:{sessionId:s.value.sessionId,epoch,jobId:job.value.jobId}})});
      s.fileHandles?.clear();const failures=cleanup.filter((r):r is PromiseRejectedResult=>r.status==='rejected');if(failures.length)throw new AggregateError(failures.map(r=>r.reason),'Session cleanup failed');s.value.state = 'closed'; })();
    return s.closing;
  }
  function jobFor(s: SessionRecord, id: string): JobRecord {
    const job = jobs.get(id);
    if (!job) {
      // Admission keys outlive stream resources in a renewed session. They are
      // bounded by maxRecords and retired with that session, and serve as the
      // tombstone distinguishing expired acceptance from an unknown job.
      if ([...keys.values()].some(a => a.kind === 'job' && a.session === s && a.resourceId === id)) throw new UploadError(410, 'Accepted job journal expired; explicit recovery required');
      throw new UploadError(404, 'Unknown job');
    }
    if (job.session !== s) throw new UploadError(404, 'Unknown job'); if (Date.parse(job.value.retainedUntil) <= now()) throw new UploadError(410, 'Job journal expired'); return job;
  }
  function operationFor(s:SessionRecord,kind:string,id:string):EventOperation {
    if(kind==='jobs')return jobFor(s,id);const op=materializations.get(id)??dependencies.get(id);if(!op||op.session!==s)throw new UploadError(404,'Unknown materialization');return op;
  }
  function binaryOptions(job: EventOperation): BinaryOptions { return { maxFrameBytes: job.limits.maxFrameBytes, maxControlBytes: job.limits.maxFrameBytes, channels: [...job.inputOffsets.keys()], validateControl: v => validateWire('Control', v) }; }
  async function fetch(request: Request): Promise<Response> {
    let releaseRequest!:()=>void;
    const drained=new Promise<void>(resolve=>{releaseRequest=resolve;});requests.add(drained);
    let s: SessionRecord | undefined; let admissionLock: string | undefined;let authorityTimer:ReturnType<typeof setTimeout>|undefined;let ownsStream=false;
    let jobReservation: SessionRecord | undefined;let installationRelease:(()=>void)|undefined;
    try {
      if(shutdown.signal.aborted)throw new UploadError(503,'Media server is retiring');
      const url = new URL(request.url); const path = url.pathname.split('/').slice(1).map(decodeURIComponent);
      if (url.protocol !== 'https:' || url.search || path[0] !== 'v1') throw new UploadError(404, 'Unknown endpoint');
      // Control authentication has its own bounded capacity: stalled DATA or
      // submission credentials cannot prevent cancellation or callback receipts.
      // This routing classification grants no authority; normal checks follow.
      const control = request.method === 'DELETE' || request.method === 'POST' && path[1] === 'sessions' && (
        path.length === 4 && path[3] === 'lease' ||
        path.length === 6 && path[3] === 'jobs' && ['cancel', 'signal'].includes(path[5]) ||
        path.length === 8 && ['jobs', 'materializations'].includes(path[3]) && (path[5] === 'callbacks' && path[7] === 'result' || path[5] === 'lanes' && path[7] === 'ack') ||
        path.length === 7 && path[3] === 'jobs' && path[5] === 'resources' && path[6] === 'release');
      const authenticated = await authenticate(request, undefined, control); if (!authenticated) throw new UploadError(401, 'Authentication required');
      shutdown.signal.throwIfAborted();request.signal.throwIfAborted();
      // Authentication returns borrowed host state. Snapshot authority before
      // any body read, build inspection or native resource acquisition yields.
      const p: MediaPrincipal = {
        tenantId: authenticated.tenantId, principalId: authenticated.principalId,
        expiresAt: authenticated.expiresAt, sessionId: authenticated.sessionId,
        epoch: authenticated.epoch, invocationId: authenticated.invocationId,
      };
      checkPrincipal(p);
      const authorityController=new AbortController();request=new Request(request,{signal:AbortSignal.any([request.signal,authorityController.signal,shutdown.signal])});
      authorityTimer=setTimeout(()=>authorityController.abort(new UploadError(401,'Authentication expired')),Math.min(2147483647,p.expiresAt-now()));authorityTimer.unref?.();
      function authenticatedStream(response:Response,retainedUntil?:number,retirementSignal?:AbortSignal):Response{
        if(!response.body)return response;ownsStream=true;const reader=response.body.getReader();
        const streamSignal=retirementSignal?AbortSignal.any([request.signal,retirementSignal]):request.signal;
        let retentionTimer:ReturnType<typeof setTimeout>|undefined;
        let abort:()=>void;
        const release=()=>{clearTimeout(authorityTimer);clearTimeout(retentionTimer);streamSignal.removeEventListener('abort',abort);};
        function checkRetention(){if(retainedUntil!==undefined&&retainedUntil<=now())throw new UploadError(410,'Operation stream retention expired; explicit recovery required');}
        function expire(){
          if(retainedUntil===undefined)return;
          if(retainedUntil<=now()){authorityController.abort(new UploadError(410,'Operation stream retention expired; explicit recovery required'));return;}
          retentionTimer=setTimeout(expire,Math.min(2147483647,retainedUntil-now()));retentionTimer.unref?.();
        }
        const body=new ReadableStream<Uint8Array>({start(c){
          // Retire even an unread response. Neither polling nor a cleanup sweep
          // extends the retained invocation's authority through session renewal.
          abort=()=>{c.error(streamSignal.reason);void reader.cancel(streamSignal.reason).catch(()=>{});release();};
          streamSignal.addEventListener('abort',abort,{once:true});
          if(streamSignal.aborted)abort();else expire();
        },async pull(c){try{streamSignal.throwIfAborted();checkPrincipal(p!);checkRetention();if(s && s.retainedUntil<=now())throw new UploadError(410,'Session retention expired');const chunk=await reader.read();streamSignal.throwIfAborted();checkPrincipal(p!);checkRetention();if(s&&s.retainedUntil<=now())throw new UploadError(410,'Session retention expired');if(chunk.done){c.close();release();reader.releaseLock();}else c.enqueue(chunk.value);}
          catch(error){c.error(error);await reader.cancel(error).catch(()=>{});release();}},async cancel(reason){await reader.cancel(reason).catch(()=>{});release();}},{highWaterMark:0});
        return new Response(body,{status:response.status,headers:response.headers});
      }
      if (request.headers.get('Execution-Protocol') !== '1') throw new UploadError(400, 'HTTP/binary major 1 required');
      const dependencyProfile=request.headers.get('Execution-Profile')==='dependency-manifest-v1';
      if(request.headers.has('Execution-Profile') && (!dependencyProfile || !features.includes('dependency-manifest-v1') || path[1]!=='sessions' || !['manifests','materializations','jobs'].includes(path[3]))) return json({category:'protocol',code:'unsupported-profile',message:'This service does not implement the selected HTTP profile for this operation',phase:'notAccepted'},422);
      const required = request.headers.get('Execution-Required-Features')?.split(',').filter(Boolean) ?? [];
      if (required.some(f => !features.includes(f))) throw new UploadError(422, 'Required capability is unavailable');
      if (path[1] === 'capabilities' && path.length === 2 && request.method === 'GET') return json({ protocolMajor: 1, builds: [...builds.values()], features, limits: options.limits, requestStreaming: false,cleanupGraceMs, leaseMs: options.leaseMs, retentionMs: options.retentionMs });
      if(p.epoch && p.epoch!==epoch)throw new UploadError(410,'Credential epoch retired; outcome unknown');
      if(p.sessionId && path[1]!=='sessions')throw new UploadError(403,'Session credential scope refused');
      if(p.invocationId && !(path[1]==='sessions' && (path[3]==='jobs' && path[4]===p.invocationId || path[3]==='file-handles' && path[4] && (request.method==='GET' && (path.length===5 || path.length===6 && path[5]==='bytes') || request.method==='DELETE' && path.length===5))))throw new UploadError(403,'Invocation credential scope refused');
      if(p.sessionId && path[1]==='sessions' && !path[2])throw new UploadError(403,'Session credential cannot create sessions');
      if (path[1] === 'sessions' && path[2]) s = getSession(path[2], p, request, request.method === 'GET' || request.method === 'DELETE');
      if(s && p.invocationId && path[3]==='file-handles' && request.method==='GET' && s.fileHandles?.get(path[4])?.invocationId!==p.invocationId)throw new UploadError(404,'Unknown invocation file handle');
      if (s && (path[3] === 'uploads' || path[3] === 'blobs')) return authenticatedStream(await uploads.fetch(request),undefined,s.controller.signal);
      if (path[1] === 'operations' && path.length === 3 && request.method === 'GET' || s && path[3] === 'operations' && path.length === 5 && request.method === 'GET') {
        const key = stable([principalKey(p), s?.value.sessionId ?? null, epoch, path.at(-1)]); const admission = keys.get(key);
        if (!admission) throw new UploadError(410, 'Operation not retained in this epoch'); return json({ operationId: admission.resourceId, resourceId: admission.resourceId, kind: admission.kind, state: admission.state });
      }
      if (s && path.length === 3 && request.method === 'GET') return json(s.value);
      if(s && ['jobs','materializations'].includes(path[3]) && path[5]==='lanes' && path[7]==='frames' && path.length===8 && request.method==='GET'){
        const op=operationFor(s,path[3],path[4]);const lane=op.lanes.get(path[6]);if(!lane||lane.direction!=='output')throw new UploadError(404,'Unknown output lane');
        const cursor=request.headers.get('Execution-Cursor')??lane.floorSequence;validateWire('Uint64',cursor);
        return authenticatedStream(new Response(op.journal.stream(BigInt(cursor),request.signal),{headers:{'Content-Type':binaryContentType,'Execution-Epoch':epoch,'Cache-Control':'no-store','X-Accel-Buffering':'no'}}),path[3]==='jobs'?Date.parse(jobFor(s,path[4]).value.retainedUntil):s.retainedUntil);
      }
      if (s && path[3] === 'jobs' && request.method === 'GET') {
        if (path.length === 4) return json([...jobs.values()].filter(j => j.session === s && Date.parse(j.value.retainedUntil) > now()).map(j => j.value));
        const job = jobFor(s, path[4]);
        if (path.length === 5) return json(job.value);
        if (path[5] === 'effects' && path.length === 6) return json({ jobId: job.value.jobId, effects: job.effects ?? [], outputs: [...new Set([...(job.outputHandles?.keys() ?? []), ...(job.outputFailures?.keys() ?? [])])], ...(job.outputFailures?.size ? { retrievalFailures: [...job.outputFailures].map(([identityId, error]) => ({ identityId, error })) } : {}), effectBarrier: job.value.effectBarrier, outputComplete: job.value.outputComplete, ...(job.value.processOutcome ? { processOutcome: job.value.processOutcome } : {}), ...(job.value.outcome ? { outcome: job.value.outcome } : {}) });
        if (path[5] === 'outputs' && path[6]) {
          const handle = job.outputHandles?.get(path[6]); const files = handle ? outputServers.get(handle) : undefined;
          if (!handle || !files) throw new UploadError(job.outputFailures?.has(path[6]) ? 503 : 404, 'Retained output unavailable');
          const scope = outputScope(job); const guard = await files.freshness(scope, handle, request.signal);
          let binding = job.outputBindings?.get(handle);
          if (guard && binding?.identity !== guard.identity) {
            binding = { identity: guard.identity, token: randomUUID() };
            (job.outputBindings ??= new Map()).set(handle, binding);
          }
          // The validator derives from a qualified backend content version, never
          // from pathname, stat tuples or a hash of live file bytes.
          const etag = guard ? '"' + createHash('sha256').update(stable([job.value.jobId, path[6], binding!.token, guard.version])).digest('hex') + '"' : undefined;
          const expected = request.headers.get('If-Match');
          if (expected && expected !== etag) throw new UploadError(412, 'Output source identity or version changed');
          const metadata = await files.stat(scope, handle, request.signal, guard);
          if (path.length === 7) { const result = json(metadata); if (etag) result.headers.set('ETag', etag); return result; }
          if (path.length === 8 && path[7] === 'bytes') {
            const size = BigInt(metadata.size); let start = 0n, end = size; const range = request.headers.get('Range');
            if (range) { const parts = range.startsWith('bytes=') ? range.slice(6).split('-') : []; if (parts.length !== 2) throw new UploadError(416, 'Unsupported range'); validateWire('Uint64', parts[0]); start = BigInt(parts[0]); if (parts[1]) { validateWire('Uint64', parts[1]); end = BigInt(parts[1]) + 1n; } if (start >= size || end <= start) throw new UploadError(416, 'Unsatisfiable range'); if (end > size) end = size; }
            const headers = new Headers({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(end - start), 'Execution-Epoch': epoch, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }); if (range) headers.set('Content-Range', `bytes ${start}-${end - 1n}/${size}`);
            if (etag) headers.set('ETag', etag);
            return authenticatedStream(new Response(exactByteBody(files.stream(scope, handle, start, end, request.signal, guard),end-start), { status: range ? 206 : 200, headers }),Date.parse(job.value.retainedUntil));
          }
        }
        if (path[5] === 'wait' && path.length === 6) { await observeWithin(job.done,request.signal); request.signal.throwIfAborted(); return json(job.value); }

      }
      if (s && path[3] === 'materializations' && path[4] && path.length===5 && request.method==='GET') {
        if(dependencyProfile){const op=dependencies.get(path[4]);if(!op||op.session!==s)throw new UploadError(404,'Unknown dependency preparation');return dependencyJson(op.value);}
        const op=materializations.get(path[4]);if(!op || op.session!==s)throw new UploadError(404,'Unknown materialization');return json(op.value);
      }
      if (s && path[3] === 'manifests' && path[4] && path.length === 5 && request.method === 'GET') {
        const manifest = manifests.get(path[4]); if (!manifest || manifest.session !== s) throw new UploadError(404, 'Unknown manifest');
        if(Boolean(manifest.dependency)!==dependencyProfile)throw new UploadError(409,'Manifest profile mismatch');
        return new Response(manifest.bytes.slice(), { headers: { 'Content-Type': 'application/json', 'Execution-Epoch': epoch, 'Manifest-Digest': manifest.digest, 'Cache-Control': 'no-store',...(dependencyProfile?{'Execution-Profile':'dependency-manifest-v1'}:{}) } });
      }
      if(s && path[3]==='file-handles' && path[4] && request.method==='GET'){
        const scope=s.fileHandles?.get(path[4]);if(!scope || !s.files || p.invocationId && scope.invocationId!==p.invocationId)throw new UploadError(404,'Unknown file handle');
        const metadata=await s.files.stat(scope,path[4],request.signal);
        if(path.length===5)return json(metadata);
        if(path.length===6 && path[5]==='bytes'){
          const size=BigInt(metadata.size);let start=0n,end=size;const range=request.headers.get('Range');
          if(range){const parts=range.startsWith('bytes=')?range.slice(6).split('-'):[];if(parts.length!==2)throw new UploadError(416,'Unsupported range');validateWire('Uint64',parts[0]);start=BigInt(parts[0]);if(parts[1]){validateWire('Uint64',parts[1]);end=BigInt(parts[1])+1n;}if(start>=size||end<=start)throw new UploadError(416,'Unsatisfiable range');if(end>size)end=size;}
          const headers=new Headers({'Content-Type':'application/octet-stream','Content-Length':String(end-start),'Execution-Epoch':epoch,'Accept-Ranges':'bytes','Cache-Control':'no-store'});if(range)headers.set('Content-Range',`bytes ${start}-${end-1n}/${size}`);
          return authenticatedStream(new Response(exactByteBody(s.files.stream(scope,path[4],start,end,request.signal),end-start),{status:range?206:200,headers}));
        }
      }
      if (!['POST','DELETE'].includes(request.method)) throw new UploadError(404, 'Unknown endpoint');
      if(request.method==='DELETE' && !(s && (path.length===3 || path[3]==='file-handles' && path.length===5)))throw new UploadError(404,'DELETE is not admitted for this operation');
      if (s && ['jobs','materializations'].includes(path[3]) && path[5] === 'lanes' && path[7] === 'frames' && path.length === 8 && request.method === 'POST') {
        const job = operationFor(s,path[3],path[4]); const native=path[3]==='jobs'?jobFor(s,path[4]):undefined; const lane = job.lanes.get(path[6]); if (!lane || lane.direction !== 'input') throw new UploadError(404, 'Unknown input lane');
        if (request.headers.get('Content-Type') !== binaryContentType || !request.body) throw new UploadError(400, 'Binary frames required');
        if (job.inputBusy) throw new UploadError(409, 'Input lane busy'); job.inputBusy = true;
        try {
          const cursor=request.headers.get('Execution-Cursor')??String(job.inputSequence);validateWire('Uint64',cursor);const firstSequence=BigInt(cursor);
          if(firstSequence<job.inputFloor || job.inputUncertain)throw new UploadError(410,'Input replay gap or uncertain delivery');
          if(firstSequence>job.inputSequence || firstSequence===0n)throw new UploadError(400,'Input cursor exceeds acknowledgement');
          const opts = { ...binaryOptions(job), firstSequence, offsets: job.inputReceipts.get(firstSequence)?.offsets??job.inputOffsets,maxTotalBytes:job.limits.maxInflightBytes };
          let total = 0;
          for await (const frame of decodeFrames(request.body, opts)) {
            request.signal.throwIfAborted(); checkPrincipal(p);
            if(s.deadline<=now() || s.value.state!=='open')throw new UploadError(410,'Input authority expired during delivery');
            total += frame.payload.length + 40; if (total > job.limits.maxInflightBytes) throw new UploadError(413, 'Input batch bound');
            const digest=createHash('sha256').update(encodeFrame(frame,opts)).digest('hex');
            if(frame.sequence<job.inputSequence){if(job.inputReceipts.get(frame.sequence)?.digest!==digest)throw new UploadError(409,'Conflicting input frame replay');continue;}
            const before=new Map(job.inputOffsets);
            const target=job.inputTargets.get(frame.channelId);
            if ((!target && !native?.process) || job.inputEnded.has(frame.channelId) || frame.kind === 'control' || frame.correlationId!==(target?.correlationId??0n)) throw new UploadError(409, 'Native input not ready or ended');
            try{if(frame.kind==='data'){if(target)await target.writer.write(frame.payload);else await native!.process!.write(frame.channelId,frame.payload);}else{if(target)await target.writer.close();else await native!.process!.end(frame.channelId);job.inputEnded.add(frame.channelId);}}catch{job.inputUncertain=true;throw new UploadError(503,'Native input delivery outcome unknown');}
            const size=40+frame.payload.length;job.inputReceipts.set(frame.sequence,{digest,offsets:before,size});job.inputReplayBytes+=size;
            while(job.inputReplayBytes>job.limits.maxReplayBytes){const oldest=job.inputReceipts.get(job.inputFloor);if(oldest)job.inputReplayBytes-=oldest.size;job.inputReceipts.delete(job.inputFloor++);}
            job.inputSequence = frame.sequence + 1n; job.inputOffsets.set(frame.channelId, frame.offset + BigInt(frame.payload.length));
          }
          request.signal.throwIfAborted(); checkPrincipal(p);
          return json({ type: 'Ack', laneId: lane.laneId, sequence: String(job.inputSequence - 1n), offsets: [...job.inputOffsets].map(([channelId, offset]) => ({channelId,offset:String(offset)})) });
        } finally { job.inputBusy = false; }
      }
      const bodyBytes = await readBody(request); request.signal.throwIfAborted(); checkPrincipal(p);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes); const input = text ? parseWireJson(text) : {};
      const bodyIdentity = stable([request.method, url.pathname, request.headers.get('Execution-Profile'), createHash('sha256').update(bodyBytes).digest('hex')]); const key = keyFor(p, request, s); const prior = keys.get(key);
      if(s && p.invocationId && path[3]==='file-handles' && s.fileHandles?.get(path[4])?.invocationId!==p.invocationId && !(prior?.kind==='file-close' && prior.resourceId===path[4] && prior.invocationId===p.invocationId))throw new UploadError(404,'Unknown invocation file handle');
      if (prior) {
        if (prior.body !== bodyIdentity) throw new UploadError(409, 'Idempotency key conflict');
        if(prior.result!==undefined)return json(prior.result);
        if (prior.kind === 'session' && prior.state !== 'complete') throw new UploadError(409, 'Session admission unresolved; inspect operation');
        if (prior.kind === 'session' || prior.kind === 'close' || prior.kind === 'lease') return json(sessions.get(prior.resourceId)!.value);
        if (prior.kind === 'job' || prior.kind === 'cancel' || prior.kind === 'signal' || prior.kind === 'release') return dependencyProfile?dependencyJson(jobFor(s!, prior.resourceId).value):json(jobFor(s!, prior.resourceId).value);
        if(prior.kind==='file-open')return json({handleId:prior.resourceId,invocationId:s!.fileHandles!.get(prior.resourceId)!.invocationId});
        if(prior.kind==='file-close'){if(prior.state!=='complete')throw new UploadError(503,'Retained close settlement unavailable');return json({released:true});}
        if (prior.kind === 'materialization') return dependencyProfile?dependencyJson(dependencies.get(prior.resourceId)!.value):json(materializations.get(prior.resourceId)!.value);
        if (prior.kind === 'manifest') {const manifest=manifests.get(prior.resourceId)!;return dependencyProfile?dependencyJson({manifestId:prior.resourceId,revision:manifest.dependency!.revision,sha256:manifest.digest}):json({ manifestId: prior.resourceId, digest: manifest.digest });}
        throw new UploadError(409, 'Operation already admitted; inspect resource');
      }
      if (admissionLocks.has(key)) throw new UploadError(409, 'Admission pending; inspect before retrying');
      reserve(keys.size+admissionLocks.size); admissionLocks.add(key); admissionLock = key;
      reserve(keys.size);
      async function persist(kind:string,id:string,buildDigest?:string){
        checkPrincipal(p); request.signal.throwIfAborted();
        try{await options.admissions.record({operationId:id,epoch,tenantId:p!.tenantId,principalId:p!.principalId,...(s?{sessionId:s.value.sessionId}:{}),kind,retainedUntil:s?.retainedUntil??now()+options.leaseMs+options.retentionMs,requestDigest:createHash('sha256').update(bodyBytes).digest('hex'),...(buildDigest?{buildDigest}:{})});}
        catch(cause){
          // Typed ledger refusals retain their contract. Provider exceptions do
          // not prove rejection: publication may precede a lost receipt.
          if(cause instanceof UploadError)throw cause;
          throw Object.assign(new UploadError(503,'Durable admission unavailable; outcome unknown'),{cause});
        }
        // Durable publication does not extend credentials. Recheck before the
        // caller acquires native resources or publishes an authorized result.
        // Job admission transfers execution ownership to the session. Once its
        // receipt succeeds, a transport abort cannot discard that live binding.
        checkPrincipal(p); if(kind!=='job')request.signal.throwIfAborted();
      }
      function record(kind: string, id: string, state: Admission['state'] = 'accepted',result?:unknown) { keys.set(key, { kind, resourceId: id, state, body: bodyIdentity, session: s,...(result===undefined?{}:{result:structuredClone(result)}) }); }
      if (!s && path[1] === 'sessions' && path.length === 2 && request.method === 'POST') {
        validateWire('SessionRequest', input); const data = input as SessionRequest; limitsWithin(data.limits, options.limits); reserve(sessions.size);
        if(data.requiredFeatures?.some(feature=>!features.includes(feature)))throw new UploadError(422,'Required session capability unavailable');
        if (data.bindings.length > data.limits.maxHandles || new Set(data.bindings.map(b => b.namespaceId)).size !== data.bindings.length) throw new UploadError(413, 'Namespace count/collision');
        if (data.bindings.some(b => b.profile === 'live') && !features.includes('live-files')) throw new UploadError(422, 'Qualified live filesystem driver unavailable');
        await verifyBuild(data.buildDigest); checkPrincipal(p); request.signal.throwIfAborted(); reserve(sessions.size); reserve(keys.size);
        const value: Session = { buildDigest:data.buildDigest,bindings:structuredClone(data.bindings),limits:structuredClone(data.limits), sessionId: randomUUID(), epoch, state: 'lost', leaseExpiresAt: new Date(now() + options.leaseMs).toISOString() };
        const session: SessionRecord = { principal: principalKey(p), value, deadline: now() + options.leaseMs, retainedUntil: now()+options.leaseMs+options.retentionMs, controller: new AbortController() };
        sessions.set(value.sessionId, session); record('session', value.sessionId);
        let closeAcquired: (() => Promise<void>) | undefined;
        try {
          await persist('session',value.sessionId,data.buildDigest);
          const acquired = await options.driver.admitSession({ principal: { ...p }, request: structuredClone(data), signal: request.signal });
          // Acquisition owns cleanup before inspecting optional capabilities.
          // Retain methods with their original receivers, not mutable backend
          // containers. This pins authority, never the contents of live files.
          closeAcquired = acquired.close.bind(acquired);
          const files = acquired.files;
          const dependencies = acquired.dependencies;
          const grants = acquired.grants;
          if (grants !== undefined && (!Array.isArray(grants) || grants.length > options.maxRecords)) throw new UploadError(413, 'Session grant retention bound');
          const retainedGrants = grants === undefined ? undefined : Array.from({ length: grants.length }, (_, index) => {
            if (!Object.hasOwn(grants, index)) throw new TypeError('Invalid session grant');
            const grant = grants[index]; validateWire('Grant', grant); return structuredClone(grant);
          });
          session.authority = {
            close: closeAcquired, prepare: acquired.prepare.bind(acquired), grants: retainedGrants,
            files: files ? { open: files.open.bind(files), list: files.list.bind(files) } : undefined,
            dependencies: dependencies ? { authorize: dependencies.authorize.bind(dependencies), prepare: dependencies.prepare.bind(dependencies) } : undefined,
            materialize: acquired.materialize?.bind(acquired), release: acquired.release?.bind(acquired),
          };
          checkPrincipal(p); request.signal.throwIfAborted(); if(session.authority.files){session.fileHandles=new Map();session.files=createFileServer({maxHandles:data.limits.maxHandles,maxFrameBytes:data.limits.maxFrameBytes,open:async(_scope,entry,signal)=>session.authority!.files!.open({...entry,signal})});}
          session.value.state = 'open'; keys.get(key)!.state = 'complete'; return json(value);
        } catch (error) {
          keys.get(key)!.state = 'unknown';session.value.state='closing';
          session.closing=Promise.resolve().then(async()=>{await closeAcquired?.();session.value.state='closed';});
          try{await session.closing;}catch(retirement){throw new AggregateError([error,retirement],'Session acquisition and retirement failed');}
          throw error;
        }
      }
      if (!s) throw new UploadError(404, 'Unknown endpoint');
      if (path.length === 3 && request.method === 'DELETE') { await persist('close',randomUUID());record('close', s.value.sessionId); await closeSession(s); keys.get(key)!.state = 'complete'; return json(s.value); }
      if (path[3] === 'lease' && path.length === 4) {
        validateWire('LeaseRequest', input); const duration = (input as {leaseMs:number}).leaseMs; if (duration > options.leaseMs) throw new UploadError(413, 'Lease bound');
        s.deadline = now()+duration; s.retainedUntil = s.deadline+options.retentionMs; s.value.leaseExpiresAt = new Date(s.deadline).toISOString(); uploads.renewSession(uploadPrincipal(p,s)); record('lease', s.value.sessionId, 'complete'); return json(s.value);
      }
      if(path[3]==='file-handles' && path.length===4 && request.method==='POST'){
        validateWire('FileOpenRequest',input);const data=input as FileOpenRequest;
        const binding=s.value.bindings.find(b=>b.namespaceId===data.namespaceId && b.grantId===data.grantId);if(!binding||!binding.rights.includes('read'))throw new UploadError(403,'File read authority refused');
        if(!s.files)throw new UploadError(422,'Retained canonical files unavailable');if(data.jobId && jobFor(s,data.jobId).value.state==='terminal')throw new UploadError(410,'Invocation file authority expired');
        const scope:FileScope={tenantId:p.tenantId,sessionId:s.value.sessionId,epoch,invocationId:data.jobId??'session'};
        await persist('file-open',randomUUID());const handleId=await s.files.open(scope,{namespaceId:data.namespaceId,path:data.path},request.signal);if(data.jobId && jobFor(s,data.jobId).value.state==='terminal'){await s.files.close(scope,handleId);throw new UploadError(410,'Invocation ended during file acquisition');}s.fileHandles!.set(handleId,scope);record('file-open',handleId,'complete');return json({handleId,invocationId:scope.invocationId});
      }
      if(path[3]==='file-handles' && path.length===5 && request.method==='DELETE'){
        const scope=s.fileHandles?.get(path[4]);if(!scope||!s.files)throw new UploadError(404,'Unknown file handle');await persist('file-close',randomUUID());record('file-close',path[4]);keys.get(key)!.invocationId=scope.invocationId;
        try{await s.files.close(scope,path[4]);keys.get(key)!.state='complete';}catch(error){keys.get(key)!.state='unknown';throw error;}finally{s.fileHandles!.delete(path[4]);}return json({released:true});
      }
      if(path[3]==='file-listings' && path.length===4 && request.method==='POST'){
        validateWire('FileListRequest',input);const data=input as FileListRequest;const binding=s.value.bindings.find(b=>b.namespaceId===data.namespaceId && b.grantId===data.grantId);if(!binding||!binding.rights.includes('metadata'))throw new UploadError(403,'File listing authority refused');
        if(data.maxEntries>s.value.limits.maxManifestEntries)throw new UploadError(413,'Listing count bound');if(!s.authority!.files)throw new UploadError(422,'Canonical listing unavailable');const entries=admitFileListing(await s.authority!.files.list({...data,signal:request.signal}),data.maxEntries,options.maxDocumentBytes);record('file-listing',randomUUID(),'complete',entries);return json(entries);
      }
      if (path[3] === 'manifests' && path.length === 4) {
        if(dependencyProfile){
          validateDependencyManifest(input,{maxEntries:s.value.limits.maxManifestEntries,maxPathBytes:options.maxDocumentBytes});
          if(input.sessionId!==s.value.sessionId||input.epoch!==epoch)throw new UploadError(403,'Dependency manifest authority mismatch');
          if(!s.value.bindings.some(b=>b.namespaceId===input.namespaceId))throw new UploadError(403,'Dependency namespace refused');
          const digest=createHash('sha256').update(bodyBytes).digest('hex');
          for(const [id,manifest] of manifests)if(manifest.session===s&&manifest.dependency?.namespaceId===input.namespaceId&&manifest.dependency.revision===input.revision){
            if(manifest.digest!==digest)throw new UploadError(409,'Dependency manifest revision conflict');record('manifest',id,'complete');return dependencyJson({manifestId:id,revision:input.revision,sha256:digest});
          }
          reserve(manifests.size);const id=randomUUID();await persist('manifest',id);manifests.set(id,{session:s,bytes:bodyBytes,digest,dependency:structuredClone(input)});record('manifest',id,'complete');return dependencyJson({manifestId:id,revision:input.revision,sha256:digest});
        }
        validateWire('Manifest', input); reserve(manifests.size); validateManifest(input as Manifest, s);
        const id = randomUUID(); const digest = createHash('sha256').update(bodyBytes).digest('hex'); manifests.set(id, { session: s, bytes: bodyBytes, digest }); record('manifest',id,'complete'); return json({manifestId:id,digest});
      }
      if (path[3] === 'materializations' && path.length === 4) {
        if(dependencyProfile){
          validateWire('DependencyMaterializeRequest',input);const data=input as DependencyMaterializeRequest;
          if(data.sessionId!==s.value.sessionId||data.epoch!==epoch||data.operationKey!==request.headers.get('Idempotency-Key'))throw new UploadError(403,'Dependency preparation authority mismatch');
          const manifest=manifests.get(data.manifestId);if(!manifest||manifest.session!==s||!manifest.dependency)throw new UploadError(404,'Unknown dependency manifest');
          if(manifest.dependency.revision!==data.manifestRevision)throw new UploadError(409,'Dependency manifest revision mismatch');
          const host=s.authority!.dependencies;if(!host)throw new UploadError(422,'Qualified dependency preparation unavailable');
          if(!await host.authorize({manifest:structuredClone(manifest.dependency),bindingId:data.bindingId,signal:request.signal}))throw new UploadError(403,'Dependency source/binding authority refused');
          request.signal.throwIfAborted();checkPrincipal(p);if(s.value.state!=='open'||s.deadline<=now())throw new UploadError(410,'Dependency session expired');
          const blobs=new Map<string,InvocationBlob>();let total=0n;
          for(const entry of manifest.dependency.entries)if(entry.kind==='file'){
            total+=BigInt(entry.blob.size);if(total>BigInt(s.value.limits.maxBlobBytes))throw new UploadError(413,'Dependency tree byte bound');
            const blob=uploads.borrowBlob(uploadPrincipal(p,s),entry.blob.blobId);
            if(blob.size!==BigInt(entry.blob.size)||blob.digest!==entry.blob.sha256)throw new UploadError(409,'Dependency blob identity mismatch');
            blobs.set(entry.blob.blobId,{size:blob.size,digest:blob.digest,async read(position,count,signal){
              if(s!.value.state!=='open'||s!.deadline<=now())throw new UploadError(410,'Dependency blob session authority expired');
              if(typeof position!=='bigint'||position<0n||position>blob.size||!Number.isSafeInteger(count)||count<1||count>s!.value.limits.maxFrameBytes)throw new UploadError(413,'Dependency blob read bound');
              const combined=AbortSignal.any([signal,s!.controller.signal]);combined.throwIfAborted();const length=Number(blob.size-position<BigInt(count)?blob.size-position:BigInt(count));if(!length)return new Uint8Array();
              const bytes=await options.storage.read(blob.storageId,position,length,combined);combined.throwIfAborted();if(s!.value.state!=='open'||s!.deadline<=now())throw new UploadError(410,'Dependency blob session authority expired');if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>length)throw new UploadError(503,'Dependency blob unavailable');return new Uint8Array(bytes);
            }});
          }
          reserve(dependencies.size);const value:DependencyMaterialization={operationId:randomUUID(),manifestId:data.manifestId,manifestRevision:data.manifestRevision,directoryRevision:null,state:'accepted',entries:manifest.dependency.entries.map((_,index)=>({index,state:'pending',revision:null})),callbackGrantIds:[]};
          let resolveDone!:()=>void;const done=new Promise<void>(r=>{resolveDone=r;});
          const op:DependencyRecord={privatePreparation:true,session:s,value,manifest:structuredClone(manifest.dependency),request:structuredClone(data),done,limits:s.value.limits,grants:s.authority!.grants??[],namespaceId:manifest.dependency.namespaceId,owner:{kind:'materialization',id:value.operationId},controller:new AbortController(),
            journal:createFrameJournal({maxFrameBytes:s.value.limits.maxFrameBytes,maxControlBytes:s.value.limits.maxFrameBytes,channels:[],maxReplayBytes:s.value.limits.maxReplayBytes,validateControl:v=>validateWire('Control',v)}),lanes:new Map(),laneAcks:new Map(),inputTargets:new Map(),inputReceipts:new Map(),inputReplayBytes:0,inputFloor:1n,inputUncertain:false,openedChannels:new Set(),inputSequence:1n,inputOffsets:new Map(),inputEnded:new Set(),inputBusy:false,callbacks:new Map(),callbackBytes:0n,effectSequence:0n,effectChain:Promise.resolve()};
          await persist('materialization',value.operationId);dependencies.set(value.operationId,op);record('materialization',value.operationId);
          void (async()=>{
            let reservation:Awaited<ReturnType<typeof reserveNamespace>>|undefined;
            try{
              reservation=await reserveNamespace(s!,stable(['dependency',data.bindingId]),AbortSignal.any([op.controller.signal,s!.controller.signal]));
              if(data.expectedDirectoryRevision!==(reservation.namespace.revision??null))throw new UploadError(409,'Stale private directory revision');
              reservation.namespace.revision=undefined;reservation.namespace.operationId=undefined;value.state='applying';
              const installed=await host.prepare({operationId:value.operationId,request:structuredClone(data),manifest:structuredClone(op.manifest),blobs,hooks:hooksFor(op),signal:AbortSignal.any([op.controller.signal,s!.controller.signal])});
              const closeInstalled=installed.close.bind(installed);
              let closing:Promise<void>|undefined;op.close=()=>closing??=Promise.resolve().then(closeInstalled);
              validateDependencyMaterialization(installed.result);const result=installed.result;
              if(result.operationId!==value.operationId||result.manifestId!==data.manifestId||result.manifestRevision!==data.manifestRevision||['accepted','applying'].includes(result.state)||result.entries.length!==op.manifest.entries.length||result.callbackGrantIds.some(id=>!op.grants.some(g=>g.grantId===id)))throw new TypeError('Dependency preparation result mismatch');
              if(result.state==='ready'&&op.manifest.entries.some(entry=>entry.source.freshness!=='immutable'&&(!entry.source.callbackGrantId||!result.callbackGrantIds.includes(entry.source.callbackGrantId))))throw new TypeError('Live dependency callbacks are not retained for native access');
              Object.assign(value,{...structuredClone(result),state:'applying'});
              op.controller.signal.throwIfAborted();s!.controller.signal.throwIfAborted();await op.effectChain;await withDeadline(signal=>settleEffects(op,signal));
              if(!op.journal.channelsEnded||[...(op.effectStates?.values()??[])].some(e=>e.state==='requested'||e.state==='unknown'))throw new TypeError('Dependency preparation settlement unknown');
              Object.assign(value,structuredClone(result));if(result.state==='ready'){reservation.namespace.revision=result.directoryRevision!;reservation.namespace.operationId=value.operationId;}
              op.journal.seal();keys.get(key)!.state='complete';
            }catch(error){
              if(value.state==='accepted'&&error instanceof UploadError&&error.status===409){value.state='failed';value.error='stale-revision';keys.get(key)!.state='failed';op.journal.seal();}
              else {value.state=value.entries.some(e=>e.state==='applied')?'partial':'unknown';keys.get(key)!.state='unknown';op.journal.fail(new UploadError(503,'Dependency preparation outcome unknown'));}
            }finally{reservation?.release();op.effectsClosed=true;resolveDone();}
          })();return dependencyJson(structuredClone(value));
        }
        validateWire('MaterializeRequest',input); const data=input as MaterializeRequest;
        if (!s.authority!.materialize || !features.includes('materialization')) throw new UploadError(422,'Qualified canonical materialization unavailable');
        const manifest=manifests.get(data.manifestId); if(!manifest || manifest.session!==s || manifest.dependency) throw new UploadError(404,'Unknown canonical manifest');
        const binding=s.value.bindings.find(b=>b.namespaceId===data.namespaceId && b.grantId===data.grantId);
        if(!binding || !binding.rights.includes('write')) throw new UploadError(403,'Materialization authority refused');
        reserve(materializations.size);
        const value:Materialization={operationId:randomUUID(),namespaceId:data.namespaceId,root:data.root,state:'accepted',revision:null,effects:[]};
        let resolveDone!:()=>void;const done=new Promise<void>(r=>{resolveDone=r;});
        const op:MaterializationRecord={session:s,value,done,resolveDone,limits:s.value.limits,grants:s.authority!.grants??[],namespaceId:data.namespaceId,owner:{kind:'materialization',id:value.operationId},effectRecorded:effect=>{value.effects.push(structuredClone(effect));},controller:new AbortController(),
          journal:createFrameJournal({maxFrameBytes:s.value.limits.maxFrameBytes,maxControlBytes:s.value.limits.maxFrameBytes,channels:[],maxReplayBytes:s.value.limits.maxReplayBytes,validateControl:v=>validateWire('Control',v)}),lanes:new Map(),laneAcks:new Map(),inputTargets:new Map(),inputReceipts:new Map(),inputReplayBytes:0,inputFloor:1n,inputUncertain:false,openedChannels:new Set(),inputSequence:1n,inputOffsets:new Map(),inputEnded:new Set(),inputBusy:false,callbacks:new Map(),callbackBytes:0n,effectSequence:0n,effectChain:Promise.resolve()};
        await persist('materialization',value.operationId);materializations.set(value.operationId,op);record('materialization',value.operationId);
        void (async()=>{
          let reservation:Awaited<ReturnType<typeof reserveNamespace>>|undefined;
          try{
            reservation=await reserveNamespace(s!,data.namespaceId,AbortSignal.any([op.controller.signal,s!.controller.signal]));
            if(s!.deadline<=now()||s!.value.state!=='open')throw new UploadError(410,'Session expired during materialization reservation');
            if(data.expectedRevision!==(reservation.namespace.revision??null))throw new UploadError(409,'Stale materialization revision');
            // Any admitted mutation invalidates earlier readiness, including a
            // partial/unknown operation. Only its completed barrier restores it.
            reservation.namespace.revision=undefined;reservation.namespace.operationId=undefined;
            value.state='applying';
            const result=await s!.authority!.materialize!({operationId:value.operationId,request:structuredClone(data),manifest:manifest.bytes.slice(),hooks:hooksFor(op),signal:op.controller.signal});
            validateWire('Materialization',result);
            if(result.operationId!==value.operationId||result.namespaceId!==data.namespaceId||result.root!==data.root)throw new TypeError('Materialization identity mismatch');
            const effects=value.effects;Object.assign(value,{...result,state:'applying',effects});await op.effectChain;
            await withDeadline(signal=>settleEffects(op,signal));
            if(!op.journal.channelsEnded||[...(op.effectStates?.values()??[])].some(effect=>effect.state==='requested'||effect.state==='unknown'))throw new TypeError('Materialization channel or effect settlement unknown');
            value.state=result.state;
            if(result.state==='complete'&&result.revision!==null){reservation.namespace.operationId=value.operationId;reservation.namespace.revision=result.revision;}
            op.journal.seal();keys.get(key)!.state='complete';
          }catch{
            await Promise.allSettled([withDeadline(signal=>settleEffects(op,signal))]);
            value.state=value.effects.length?'partial':'unknown';op.journal.fail(new UploadError(503,'Materialization outcome unknown'));keys.get(key)!.state='unknown';
          }finally{reservation?.release();op.effectsClosed=true;resolveDone();}
        })();return json(structuredClone(value));
      }
      if (path[3] === 'jobs' && path.length === 4) {
        validateWire(dependencyProfile?'DependencyJobRequest':'JobRequest', input); const data = input as ExecutionRequest; limitsWithin(data.limits,s.value.limits); reserve(jobs.size);
        if(data.requiredFeatures?.some(feature=>!features.includes(feature)))throw new UploadError(422,'Required invocation capability unavailable');
        // Reject rather than queue: a running pipeline stage must not hold a slot
        // while waiting indefinitely for another stage's admission.
        const active = [...jobs.values()].filter(j => j.value.state !== 'terminal' || j.value.cleanup !== 'complete');
        const pending = [...pendingJobs.values()].reduce((sum, count) => sum + count, 0);
        if (active.length + pending >= options.limits.maxJobs || active.filter(j => j.session === s).length + (pendingJobs.get(s) ?? 0) >= s.value.limits.maxJobs) throw new UploadError(429, 'Concurrent job bound');
        pendingJobs.set(s, (pendingJobs.get(s) ?? 0) + 1); jobReservation = s;
        if ([...jobs.values()].filter(j => j.session === s && j.value.state !== 'terminal').length >= s.value.limits.maxJobs) throw new UploadError(429, 'Concurrent job bound');
        const tool = tools.get(data.toolId); if (!tool || tool.buildDigest !== data.buildDigest || data.buildDigest !== s.value.buildDigest) throw new UploadError(409, 'Tool/native build mismatch');
        const build = builds.get(data.buildDigest)!;
        if (tool.requiresFrontendContract && !data.frontendContract || data.frontendContract && (data.frontendContract.grammarRevision !== build.grammarRevision || data.frontendContract.sourceRevision !== build.sourceRevision)) throw new UploadError(409, 'JS frontend/native contract mismatch');
        const validText = (text:string) => !text.includes('\0') && new TextDecoder('utf-8',{ignoreBOM:true}).decode(new TextEncoder().encode(text)) === text;
        if (!data.cwd.startsWith('/') || !validText(data.cwd) || Object.entries(data.env).some(([key,value]) => !key || key.includes('=') || !validText(key) || !validText(value))) throw new UploadError(400,'Invalid cwd/environment');
        if (Object.entries(build.runtimeEnvironment).some(([key,value]) => !Object.hasOwn(data.env,key) || data.env[key] !== value)) throw new UploadError(409,'Native runtime environment conflict');
        if (tool.requiredFeatures.some(f => !features.includes(f)) || data.freshness === 'live' && !features.includes('live-files') || data.descriptors.length && !features.includes('descriptors') || data.stdin.kind !== 'stream' && !features.includes('seekable-stdin')) throw new UploadError(422, 'Required native capability unavailable');
        // Admit the aggregate before allocating or decoding any token. An early
        // representable token cannot consume memory before a later size refusal.
        let argvBytes = 0; for (const arg of data.args) { argvBytes += arg.length + 1; if (argvBytes > data.limits.maxArgvBytes) throw new UploadError(413, 'Argv byte bound'); }
        for (const arg of data.args) { if (arg.includes(0)) throw new UploadError(400, 'NUL in argv'); if(!features.includes('byte-argv')) {try{new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(new Uint8Array(arg));}catch{throw new UploadError(422,'Native launcher cannot preserve these argv bytes');}} }
        if (data.descriptors.length > data.limits.maxHandles || new Set(data.descriptors.map(d => d.fd)).size !== data.descriptors.length || data.descriptors.some(d => d.fd > data.limits.maxHandles + 2)) throw new UploadError(413, 'Descriptor count/mapping bound');
        const binding = s.value.bindings.find(b => b.namespaceId === data.namespaceId); if (!binding || binding.profile !== data.freshness) throw new UploadError(403, 'Namespace/freshness not admitted');
        if (data.grants.length > data.limits.maxHandles || new Set(data.grants.map(g => g.grantId)).size !== data.grants.length) throw new UploadError(413, 'Grant count bound'); for (const g of data.grants) grantFor(s,g);
        const requireHandle = (handleId:string,grantId:string,rights:readonly string[]) => {
          const grant=data.grants.find(g=>g.grantId===grantId);
          if (!grant || grant.handleId!==handleId || grant.namespaceId!==data.namespaceId || rights.some(right=>!grant.operations.includes(right as Grant['operations'][number]))) throw new UploadError(403,'Handle authority is not admitted');
          if(grant.ranges)throw new UploadError(422,'Range-limited native descriptor mapping is not qualified');
        };
        for(const descriptor of data.descriptors) requireHandle(descriptor.handleId,descriptor.grantId,[...descriptor.rights,...(descriptor.seekable?['seek']:[])]);
        if(data.stdin.kind==='handle') requireHandle(data.stdin.handleId,data.stdin.grantId,['read',...(data.stdin.seekable?['seek']:[])]);
        const inputBlob=data.stdin.kind==='blob'?uploads.borrowBlob(uploadPrincipal(p,s),data.stdin.blobId):undefined;
        if(dependencyProfile){
          const dependency=(input as DependencyJobRequest).dependencyBinding;validateManifestInvocation(dependency.invocation,{maxArguments:data.limits.maxArgvBytes,maxArgvBytes:data.limits.maxArgvBytes,maxPathBytes:options.maxDocumentBytes});
          const op=dependencies.get(dependency.materializationId);const invocation=dependency.invocation;
          if(!op||op.session!==s||op.manifest.namespaceId!==data.namespaceId||op.request.bindingId!==dependency.bindingId||op.manifest.sourceAuthorityId!==dependency.sourceAuthorityId||op.value.state!=='ready'||op.value.directoryRevision!==data.materializationRevision||invocation.directoryRevision!==data.materializationRevision||invocation.manifestId!==op.value.manifestId||invocation.manifestRevision!==op.value.manifestRevision||stable(invocation.originalArgv)!==stable(data.args)||stable(invocation.cwd)!==stable(Array.from(new TextEncoder().encode(data.cwd)))||stable(op.manifest.cwd)!==stable(invocation.cwd)||data.materializationBinding?.operationId!==op.value.operationId||stable(Array.from(new TextEncoder().encode(data.materializationBinding.root)))!==stable(op.manifest.logicalRoot))throw new UploadError(409,'Dependency invocation binding mismatch');
          if(op.value.callbackGrantIds.some(id=>!data.grants.some(grant=>grant.grantId===id)))throw new UploadError(403,'Dependency callback authority is not bound to the invocation');
          const reservation=await reserveNamespace(s,stable(['dependency',dependency.bindingId]),AbortSignal.any([request.signal,s.controller.signal]));installationRelease=reservation.release;
          if(reservation.namespace.operationId!==op.value.operationId||reservation.namespace.revision!==data.materializationRevision)throw new UploadError(409,'Private dependency directory is no longer ready');
        }else if(data.materializationRevision!==null){
          const reservation=await reserveNamespace(s,data.namespaceId,AbortSignal.any([request.signal,s.controller.signal]));
          installationRelease=reservation.release;
          const admitted=data.materializationBinding!;
          const materialization=materializations.get(admitted.operationId);
          if(!materialization||materialization.session!==s||materialization.value.namespaceId!==data.namespaceId||materialization.value.root!==admitted.root||materialization.value.state!=='complete'||materialization.value.revision!==data.materializationRevision||reservation.namespace.operationId!==admitted.operationId||reservation.namespace.revision!==data.materializationRevision)throw new UploadError(409,'Materialization binding is not ready at the requested revision');
        }
        await verifyBuild(data.buildDigest); request.signal.throwIfAborted(); checkPrincipal(p);
        if(s.deadline<=now() || s.value.state!=='open') throw new UploadError(410,'Session authority expired during admission');
        reserve(jobs.size); reserve(keys.size);
        if ([...jobs.values()].filter(j=>j.session===s && j.value.state!=='terminal').length>=s.value.limits.maxJobs) throw new UploadError(429,'Concurrent job bound');
        const invocationId=request.headers.get('Idempotency-Key')!;
        const jobId=createHash('sha256').update(key).digest('hex');
        const identity={operationId:jobId,epoch,tenantId:p.tenantId,principalId:p.principalId,sessionId:s.value.sessionId,kind:'job',requestDigest:createHash('sha256').update(bodyBytes).digest('hex'),buildDigest:data.buildDigest};
        const stateJournal=createJobStateJournal(options.admissions,identity);
        const retained=await stateJournal.inspect(now());
        let durable:import('./admissions.js').AdmissionRecord|null;
        try{durable=await options.admissions.inspect(jobId);}
        catch(cause){throw Object.assign(new UploadError(503,'Durable invocation admission unavailable; outcome unknown'),{cause});}
        if(durable && (durable.requestDigest!==identity.requestDigest || durable.buildDigest!==identity.buildDigest || durable.epoch!==epoch || durable.sessionId!==s.value.sessionId || durable.tenantId!==p.tenantId || durable.principalId!==p.principalId))throw new UploadError(409,'Invocation payload or build conflict');
        if(retained || durable)throw new UploadError(410,'Accepted invocation has lost its sandbox binding; inspect recovery identity, never relaunch');
        const value: Job = { jobId,invocationId,recoveryActions:['inspect','attach','renew-credentials','recover-partial-outputs'], sessionId: s.value.sessionId, epoch, buildDigest: data.buildDigest, state: 'accepted', cancelRequested: false,cleanup:'pending', effectBarrier:'0', outputComplete:false, retainedUntil:new Date(s.retainedUntil).toISOString() };
        let resolveDone!: () => void; const done = new Promise<void>(r => { resolveDone = r; });
        const job: JobRecord = { effects: [], stateJournal,cancelActed:false,session:s, value, request:structuredClone(data), limits:structuredClone(data.limits), grants:structuredClone(data.grants),namespaceId:data.namespaceId,owner:{kind:'job',id:value.jobId},effectObserved:seq=>{value.effectBarrier=String(seq);}, controller:new AbortController(), done, resolveDone,
          journal:createFrameJournal({maxFrameBytes:data.limits.maxFrameBytes,maxControlBytes:data.limits.maxFrameBytes,channels:[2,3,...data.descriptors.filter(d => d.rights.includes('write')&&!d.seekable).map(d => d.fd+1)],maxReplayBytes:data.limits.maxReplayBytes,validateControl:v => validateWire('Control',v)}),
          lanes:new Map(),laneAcks:new Map(), inputTargets:new Map(),inputReceipts:new Map(),inputReplayBytes:0,inputFloor:1n,inputUncertain:false,openedChannels:new Set(data.descriptors.map(d=>d.fd+1)), inputSequence:1n,inputOffsets:new Map([...(data.stdin.kind==='stream'?[[1,0n]as[number,bigint]]:[]),...data.descriptors.filter(d => d.rights.includes('read')&&!d.seekable).map(d => [d.fd+1,0n] as [number,bigint])]),inputEnded:new Set(),inputBusy:false,callbacks:new Map(),callbackBytes:0n,effectSequence:0n,effectChain:Promise.resolve() };
        if(inputBlob){
          const checkInput=()=>{checkPrincipal(p!);if(job.value.state==='terminal'||s!.value.state!=='open'||s!.deadline<=now())throw new UploadError(410,'Invocation blob authority expired');};
          job.stdinBlob={size:inputBlob.size,digest:inputBlob.digest,async read(position,maxBytes,signal){
            checkInput();const combined=AbortSignal.any([signal,job.controller.signal,s!.controller.signal]);combined.throwIfAborted();
            if(typeof position!=='bigint'||position<0n||position>inputBlob.size||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>data.limits.maxFrameBytes)throw new UploadError(413,'Invocation blob read bound');
            const count=Number(inputBlob.size-position<BigInt(maxBytes)?inputBlob.size-position:BigInt(maxBytes));if(!count)return new Uint8Array();
            const bytes=await options.storage.read(inputBlob.storageId,position,count,combined);checkInput();combined.throwIfAborted();
            if(!(bytes instanceof Uint8Array)||bytes.length>count||!bytes.length)throw new UploadError(503,'Invocation blob read unavailable');return new Uint8Array(bytes);
          }};
        }
        await persist('job',value.jobId,data.buildDigest);
        await transition(job,'accepted');
        // Accepted execution belongs to the session, not its create transport.
        // A lost reply must leave the binding available for the same identity
        // to attach. Credential and session authority remain separate gates.
        checkPrincipal(p);
        if(s.deadline<=now() || s.value.state!=='open'){throw new UploadError(410,'Session expired during durable job admission');}
        jobs.set(value.jobId,job); record('job',value.jobId);
        job.timer = setTimeout(() => { cancel(job); job.controller.abort(new UploadError(410,'Job duration expired')); }, data.limits.maxJobDurationMs); job.timer.unref?.();
        job.installationRelease=installationRelease;installationRelease=undefined;
        void run(job,tool,structuredClone(build)).then(() => { keys.get(key)!.state = 'complete'; }); return dependencyProfile?dependencyJson(structuredClone(value)):json(structuredClone(value));
      }
      if (['jobs','materializations'].includes(path[3]) && path[4]) {
        const native=path[3]==='jobs'?jobFor(s,path[4]):undefined; const job=operationFor(s,path[3],path[4]);
        if (native && path[5] === 'cancel' && path.length === 6) {
          validateWire('CancelRequest',input); await persist('cancel',randomUUID());
          cancel(native);
          // Distinct retry keys share the durable observation, including its
          // failure. The in-memory action flag cannot authorize an early reply.
          native.cancelObservation??=native.stateJournal.append({cancelRequested:true,cancelActed:native.cancelActed}).then(event=>{
            if(BigInt(event.sequence)>BigInt(native.value.jobState!.sequence))native.value.jobState=event;
          });
          await native.cancelObservation;
          record('cancel',native.value.jobId,'complete');return json(native.value);
        }
        if (native && path[5] === 'signal' && path.length === 6) { validateWire('SignalRequest',input); if(!native.process || native.value.state==='terminal')throw new UploadError(409,'Native signal target unavailable');await persist('signal',randomUUID());native.process.signal((input as {signal:string}).signal); record('signal',native.value.jobId,'complete'); return json(native.value); }
        if (path[5] === 'lanes' && path.length === 6) {
          validateWire('LaneRequest',input); const data = input as {direction:'input'|'output';consumerId:string};
          const existing = [...job.lanes.values()].find(l => l.direction === data.direction && l.consumerId === data.consumerId); if (existing){record('lane',existing.laneId,'complete',existing);return json(existing);}
          if (data.direction==='input' && [...job.lanes.values()].some(l => l.direction === data.direction)) throw new UploadError(409,'Lane owner already bound');
          if(job.lanes.size>=job.limits.maxHandles)throw new UploadError(429,'Lane owner count bound');
          const lane: Lane = { ...data,laneId:randomUUID(),floorSequence:String(job.journal.floor),nextSequence:String(data.direction==='output'?job.journal.next:job.inputSequence),maxFrameBytes:job.limits.maxFrameBytes,maxInflightBytes:job.limits.maxInflightBytes }; job.lanes.set(lane.laneId,lane);job.laneAcks.set(lane.laneId,job.journal.floor-1n);record('lane',lane.laneId,'complete',lane); return json(lane);
        }
        if (path[5] === 'lanes' && path[7] === 'ack' && path.length === 8) {
          validateWire('Ack',input); const ack = input as {laneId:string;sequence:string;offsets:{channelId:number;offset:string}[]}; const lane = job.lanes.get(path[6]);
          if (!lane || lane.laneId !== ack.laneId || lane.direction !== 'output') throw new UploadError(404,'Unknown output lane'); job.journal.validateAck(BigInt(ack.sequence),ack.offsets);
          job.laneAcks.set(lane.laneId,BigInt(ack.sequence)>job.laneAcks.get(lane.laneId)!?BigInt(ack.sequence):job.laneAcks.get(lane.laneId)!);
          const floor=[...job.lanes.values()].filter(l=>l.direction==='output').map(l=>job.laneAcks.get(l.laneId)!).reduce((a,b)=>a<b?a:b);job.journal.ack(floor);record('ack',lane.laneId,'complete',ack); return json(ack);
        }
        if (path[5] === 'callbacks' && path[7] === 'result' && path.length === 8) {
          validateWire('CallbackResult',input); const data = input as CallbackResult; const callback = job.callbacks.get(path[6]);
          if (!callback || data.callbackId !== path[6] || data.operationId !== callback.value.operationId) throw new UploadError(404,'Unknown callback');
          validateCallbackResult(callback.value.operation,data);
          if (callback.body && callback.body !== text) throw new UploadError(409,'Conflicting callback response');
          if (!callback.body && (Date.parse(callback.value.expiresAt)<=now() || job.controller.signal.aborted)) throw new UploadError(410,'Callback authority expired');
          callback.body=text; callback.result=data;
          callback.settlement??=(async()=>{const work=job.effectChain.then(async()=>{if(callback.effect){await recordEffect(job,{...callback.effect,state:data.state,...(data.handleId!==undefined?{handleId:data.handleId}:{}),...(data.identityId!==undefined?{identityId:data.identityId}:{}),...(data.acknowledgedBytes!==undefined?{acknowledgedBytes:data.acknowledgedBytes}:{}),...(data.error!==undefined?{error:data.error}:{})});}callback.resolve(data);});job.effectChain=work;await work;})();await callback.settlement;record('callback',callback.value.operationId,'complete',data); return json(data);
        }
        if (native && path[5] === 'resources' && path[6] === 'release' && path.length === 7) {
          validateWire('ReleaseRequest',input); const data = input as {handleIds:string[];grantIds:string[]};
          if (data.handleIds.some(id => !native.request.descriptors.some(d => d.handleId===id)) || data.grantIds.some(id => !job.grants.some(g => g.grantId===id))) throw new UploadError(403,'Resource not owned by invocation');
          if (!s.authority!.release) throw new UploadError(422,'Resource release is unsupported'); await persist('release',randomUUID());record('release',native.value.jobId); await s.authority!.release({jobId:native.value.jobId,...data}); keys.get(key)!.state='complete'; return json(native.value);
        }
      }
      throw new UploadError(404,'Unknown endpoint');
    } catch (error) {
      if(error instanceof FileListingError)return json({category:'filesystem',code:error.code,message:'Canonical directory listing admission failed',phase:'notAccepted'},error.code==='EFBIG'?413:503);
      if (request.body && !request.body.locked) await request.body.cancel(error).catch(() => {});
      const status = error instanceof UploadError ? error.status : error instanceof TypeError || error instanceof SyntaxError ? 400 : 503;
      return json({category:status===401||status===403?'authorization':status===503?'unknown':'protocol',code:status===410?'expired':status===422?'capabilityGap':'requestFailed',message:'Media request failed',phase:status===503?'unknown':'notAccepted',...(s?{recovery:{sessionId:s.value.sessionId,epoch}}:{})},status);
    } finally {
      requests.delete(drained);releaseRequest();
      installationRelease?.();
      if (jobReservation) { const remaining = pendingJobs.get(jobReservation)! - 1; if (remaining) pendingJobs.set(jobReservation, remaining); else pendingJobs.delete(jobReservation); }
      if (admissionLock) admissionLocks.delete(admissionLock);if(!ownsStream)clearTimeout(authorityTimer);
    }
  }
  function validateManifest(manifest: Manifest, s: SessionRecord) {
    if (manifest.entries.length>s.value.limits.maxManifestEntries) throw new UploadError(413,'Manifest entry bound');
    let previous: Uint8Array|undefined; const encoder=new TextEncoder();
    for (const entry of manifest.entries) {
      const bytes=entry.pathBytes!==undefined?new Uint8Array(entry.pathBytes):encoder.encode(entry.path!);
      if(entry.path!==undefined&&new TextDecoder('utf-8',{ignoreBOM:true}).decode(bytes)!==entry.path)throw new UploadError(400,'Unrepresentable manifest text path');
      // Compare the original namespace bytes, never replacement-decoded text.
      // Both encodings must name a relative path with ordinary components.
      let component=0;
      for(let i=0;i<=bytes.length;i++){
        if(bytes[i]===0)throw new UploadError(400,'NUL in manifest path');
        if(i===bytes.length||bytes[i]===47){
          const length=i-component;
          if(!length||length===1&&bytes[component]===46||length===2&&bytes[component]===46&&bytes[component+1]===46)throw new UploadError(400,'Invalid relative manifest path');
          component=i+1;
        }
      }
      if (previous) {
        let i=0; while(i<Math.min(bytes.length,previous.length)&&bytes[i]===previous[i]) i++;
        if(i===bytes.length&&i===previous.length)throw new UploadError(409,'Duplicate manifest alias');
        if(i===bytes.length||i<previous.length&&bytes[i]<previous[i])throw new UploadError(400,'Manifest is not in byte order');
      }
      previous=bytes;
    }
  }
  async function sweep() {
    for (const s of sessions.values()) if (s.deadline<=now() && s.value.state!=='closed') await closeSession(s);
    await uploads.sweep();
    await options.admissions.sweep?.(now());
    for (const [id,job] of jobs) if(Date.parse(job.value.retainedUntil)<=now() && job.value.state==='terminal' && job.value.cleanup==='complete') {await closeOutputs(job);job.journal.fail(new UploadError(410,'Journal expired'));jobs.delete(id);}
    for (const [id,s] of sessions) if(s.retainedUntil<=now() && s.value.state==='closed') {sessions.delete(id);for(const [oid,op] of materializations)if(op.session===s){op.journal.fail(new UploadError(410,'Materialization journal expired'));materializations.delete(oid);}for(const [oid,op] of dependencies)if(op.session===s){op.journal.fail(new UploadError(410,'Dependency journal expired'));dependencies.delete(oid);}for(const [key,a] of keys) if(a.session===s || a.resourceId===id) keys.delete(key);for(const [mid,m] of manifests) if(m.session===s) manifests.delete(mid);}
  }
  return {fetch,sweep,
    /** Operator-owned retirement, distinct from an authenticated session close.
     * Stop admission, drain late acquisitions, then retire jobs and storage.
     * Cooperative host work must settle; shutdown cannot forcibly retire it. */
    close():Promise<void>{
      if(closing)return closing;
      shutdown.abort(new UploadError(503,'Media server is retiring'));
      closing=(async()=>{
        await Promise.all([...requests]);
        await Promise.allSettled([...credentials, ...controlCredentials]);
        const results=await Promise.allSettled([...sessions.values()].filter(session=>session.value.state!=='closed').map(closeSession));
        results.push(...await Promise.allSettled([uploads.close()]));
        const failures=results.filter((result):result is PromiseRejectedResult=>result.status==='rejected');
        if(failures.length)throw new AggregateError(failures.map(result=>result.reason),'Media server retirement failed');
      })();void closing.catch(()=>{});return closing;
    },
  };
}
