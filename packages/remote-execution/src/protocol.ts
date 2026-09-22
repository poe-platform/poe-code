import {validateWire} from './wire-validation.js';
export {validateWire};
export {validateCallbackResult} from './callback-result.js';

/** Wire octets, never display text. Paths use the safe-fs byte namespace. */
export type BytePath = number[];
export interface DependencySource {
  authorityId: string;
  path: BytePath;
  freshness: 'immutable' | 'revalidate-on-open' | 'live';
  observedVersion: string | null;
  retainedIdentity: string | null;
  snapshotId?: string;
  callbackGrantId?: string;
}
export interface ManifestMetadata { mode?: number; atimeNs?: string; mtimeNs?: string }
interface EntryBase { path: BytePath[]; source: DependencySource; metadata?: ManifestMetadata }
export type DependencyEntry = EntryBase & (
  | { kind: 'directory' }
  | { kind: 'file'; blob: { blobId: string; size: string; sha256: string }; identityRef?: string }
  | { kind: 'symlink'; target: BytePath }
  | { kind: 'hardlink'; identityRef: string }
  | { kind: 'output-intent'; operations: ('create' | 'truncate' | 'append' | 'replace')[] }
);
export interface DependencyManifest {
  version: 1;
  sessionId: string;
  epoch: string;
  namespaceId: string;
  /** Immutable manifest identity; distinct from backend and directory revisions. */
  revision: string;
  logicalRoot: BytePath;
  cwd: BytePath;
  sourceAuthorityId: string;
  entries: DependencyEntry[];
}
export interface DependencyMaterializeRequest {
  sessionId: string;
  epoch: string;
  manifestId: string;
  manifestRevision: string;
  /** Host-issued binding, never a physical destination pathname. */
  bindingId: string;
  expectedDirectoryRevision: string | null;
  operationKey: string;
}
export interface DependencyMaterialization {
  operationId: string;
  manifestId: string;
  manifestRevision: string;
  directoryRevision: string | null;
  state: 'accepted' | 'applying' | 'ready' | 'partial' | 'failed' | 'unknown';
  entries: { index: number; state: 'pending' | 'applied' | 'failed' | 'unknown'; revision: string | null; error?: string }[];
  /** Retained for native opens even after ready. */
  callbackGrantIds: string[];
  error?: 'missing-blob' | 'wrong-length' | 'wrong-hash' | 'stale-revision' | 'collision' | 'unauthorized' | 'unsupported' | 'unstable-capture';
}
export interface ManifestInvocation {
  manifestId: string;
  manifestRevision: string;
  directoryRevision: string;
  cwd: BytePath;
  /** Literal argument octets, including empty arguments. Never manifest paths. */
  originalArgv: BytePath[];
}

/** Readiness is more than a schema-shaped state label. Use the same progress
 * semantics on server results and recovered SDK observations. */
export function validateDependencyMaterialization(value:unknown):asserts value is DependencyMaterialization {
  validateWire('DependencyMaterialization',value);
  const status=value as DependencyMaterialization;
  if(new Set(status.callbackGrantIds).size!==status.callbackGrantIds.length
    || status.entries.some((entry,index)=>entry.index!==index||entry.state==='applied'&&entry.revision===null)
    || status.state==='ready'&&(status.directoryRevision===null||status.error!==undefined||status.entries.some(entry=>entry.state!=='applied')))
    throw new TypeError('Invalid dependency preparation progress or readiness');
}

function reject(): never { throw new TypeError('Invalid dependency manifest'); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) reject();
  return result;
}
function id(value: unknown): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) reject();
}
function bytes(value: unknown, limit: number): asserts value is number[] {
  if (!Array.isArray(value) || !value.length || value.length > limit) reject();
  // Iteration visits holes as undefined; Array#some skips them and would admit
  // SDK values whose JSON wire representation contains invalid null octets.
  for (const n of value) if (!Number.isInteger(n) || n < 1 || n > 255) reject();
}
function decimal(value: unknown, signed = false): void {
  if (typeof value !== 'string' || !value.length || value.length > 20) reject();
  const digits = signed && value.startsWith('-') ? value.slice(1) : value;
  if (!digits.length || (digits.length > 1 && digits[0] === '0') || value === '-0'
    || Array.from(digits).some(c => c < '0' || c > '9')) reject();
  const n = BigInt(value);
  if (n < (signed ? -9223372036854775808n : 0n) || n > 9223372036854775807n) reject();
}

/** Pure wire/structural validation shared by REST and SDK. Does no IO and grants
 * no authority. Server admission must additionally verify bindings, collisions,
 * blobs, snapshot guarantees and callback rights using authenticated host state. */
/** Preparation accepts host-issued identities, never caller-selected physical
 * destinations. Scope and revision authority are separately checked by the host. */
export function validateDependencyMaterializeRequest(value: unknown): asserts value is DependencyMaterializeRequest {
  const request = record(value, ['sessionId', 'epoch', 'manifestId', 'manifestRevision', 'bindingId', 'expectedDirectoryRevision', 'operationKey']);
  for (const field of ['sessionId', 'epoch', 'manifestId', 'manifestRevision', 'bindingId', 'operationKey']) id(request[field]);
  if (request.expectedDirectoryRevision !== null) id(request.expectedDirectoryRevision);
}

export function validateDependencyManifest(value: unknown, limits: {
  maxEntries: number; maxPathBytes: number;
}): asserts value is DependencyManifest {
  if (!Number.isSafeInteger(limits.maxEntries) || limits.maxEntries < 0
    || !Number.isSafeInteger(limits.maxPathBytes) || limits.maxPathBytes < 1) reject();
  const m = record(value, ['version', 'sessionId', 'epoch', 'namespaceId', 'revision', 'logicalRoot', 'cwd', 'sourceAuthorityId', 'entries']);
  if (m.version !== 1) reject();
  for (const key of ['sessionId', 'epoch', 'namespaceId', 'revision', 'sourceAuthorityId']) id(m[key]);
  for (const key of ['logicalRoot', 'cwd']) {
    bytes(m[key], limits.maxPathBytes);
    if (m[key][0] !== 47) reject();
  }
  if (!Array.isArray(m.entries) || m.entries.length > limits.maxEntries) reject();
  const paths = new Map<string, string>();
  const identities = new Map<string, Record<string, unknown>>();
  let previous: number[] | undefined;
  for (const raw of m.entries) {
    const kind = record(raw, ['kind', 'path', 'source', 'metadata', 'blob', 'identityRef', 'target', 'operations']).kind;
    const fields: Record<string, string[]> = { directory: [], file: ['blob', 'identityRef'], symlink: ['target'], hardlink: ['identityRef'], 'output-intent': ['operations'] };
    if (typeof kind !== 'string' || !Object.hasOwn(fields, kind)) reject();
    const entry = record(raw, ['kind', 'path', 'source', 'metadata', ...fields[kind]]);
    if (!Array.isArray(entry.path) || !entry.path.length) reject();
    const components: number[][] = [];
    for (const component of entry.path) {
      bytes(component, limits.maxPathBytes);
      if (component.includes(47) || (component.every(n => n === 46) && component.length <= 2)) reject();
      components.push(component);
    }
    const flat = components.flatMap((c, i) => i === 0 ? c : [47, ...c]);
    if (flat.length > limits.maxPathBytes) reject();
    const key = JSON.stringify(components);
    if (paths.has(key)) reject();
    if (components.length > 1 && paths.get(JSON.stringify(components.slice(0, -1))) !== 'directory') reject();
    if (previous) {
      const different = flat.findIndex((n, i) => n !== previous?.[i]);
      if (different < 0 || flat[different] < (previous[different] ?? -1)) reject();
    }
    previous = flat;
    paths.set(key, kind);
    const source = record(entry.source, ['authorityId', 'path', 'freshness', 'observedVersion', 'retainedIdentity', 'snapshotId', 'callbackGrantId']);
    id(source.authorityId);
    if (source.authorityId !== m.sourceAuthorityId) reject();
    bytes(source.path, limits.maxPathBytes);
    if (source.path[0] !== 47) reject();
    for (const k of ['observedVersion', 'retainedIdentity']) if (source[k] !== null) id(source[k]);
    if (source.freshness === 'immutable') id(source.snapshotId);
    else if (source.freshness === 'live' || source.freshness === 'revalidate-on-open') id(source.callbackGrantId);
    else reject();
    if (source.snapshotId !== undefined) id(source.snapshotId);
    if (source.callbackGrantId !== undefined) id(source.callbackGrantId);
    if (entry.metadata !== undefined) {
      const meta = record(entry.metadata, ['mode', 'atimeNs', 'mtimeNs']);
      if (meta.mode !== undefined && (typeof meta.mode !== 'number' || !Number.isInteger(meta.mode) || meta.mode < 0 || meta.mode > 0o7777)) reject();
      for (const k of ['atimeNs', 'mtimeNs']) if (meta[k] !== undefined) decimal(meta[k], true);
    }
    if (kind === 'file') {
      const blob = record(entry.blob, ['blobId', 'size', 'sha256']);
      id(blob.blobId); decimal(blob.size);
      if (typeof blob.sha256 !== 'string' || blob.sha256.length !== 64
        || Array.from(blob.sha256).some(c => !'0123456789abcdef'.includes(c))) reject();
      if (entry.identityRef !== undefined) {
        id(entry.identityRef);
        if (identities.has(entry.identityRef as string)) reject();
        identities.set(entry.identityRef as string, {});
      }
    }
    if (kind === 'hardlink') { id(entry.identityRef); if (!identities.has(entry.identityRef as string)) reject(); }
    if ((kind === 'file' || kind === 'hardlink') && entry.identityRef !== undefined && entry.metadata !== undefined) {
      const metadata = entry.metadata as Record<string, unknown>;
      const requested = identities.get(entry.identityRef as string)!;
      for (const field of ['mode', 'atimeNs', 'mtimeNs']) {
        if (metadata[field] === undefined) continue;
        if (requested[field] !== undefined && requested[field] !== metadata[field]) reject();
        requested[field] = metadata[field];
      }
    }
    if (kind === 'symlink') bytes(entry.target, limits.maxPathBytes);
    if (kind === 'output-intent') {
      if (!Array.isArray(entry.operations) || !entry.operations.length
        || new Set(entry.operations).size !== entry.operations.length) reject();
      for (const op of entry.operations) if (!['create', 'truncate', 'append', 'replace'].includes(op)) reject();
      if (entry.metadata !== undefined || source.freshness === 'immutable') reject();
    }
  }
}

/** Pure invocation admission. Host admission must separately match the manifest,
 * ready revision and canonical cwd, and qualify the native launcher's byte support.
 * maxArgvBytes includes one native NUL terminator per argument, never pointer bytes. */
export function validateManifestInvocation(value: unknown, limits: {
  maxArguments: number; maxArgvBytes: number; maxPathBytes: number;
}): asserts value is ManifestInvocation {
  for (const limit of [limits.maxArguments, limits.maxArgvBytes]) {
    if (!Number.isSafeInteger(limit) || limit < 0) reject();
  }
  if (!Number.isSafeInteger(limits.maxPathBytes) || limits.maxPathBytes < 1) reject();
  const invocation = record(value, ['manifestId', 'manifestRevision', 'directoryRevision', 'cwd', 'originalArgv']);
  for (const field of ['manifestId', 'manifestRevision', 'directoryRevision']) id(invocation[field]);
  bytes(invocation.cwd, limits.maxPathBytes);
  if (invocation.cwd[0] !== 47) reject();
  if (!Array.isArray(invocation.originalArgv) || invocation.originalArgv.length > limits.maxArguments) reject();
  let remaining = limits.maxArgvBytes;
  for (const argument of invocation.originalArgv) {
    if (!Array.isArray(argument) || argument.length >= remaining) reject();
    // Empty arguments are valid; holes and NUL octets are never empty arguments.
    if (argument.length > 0) bytes(argument, remaining - 1);
    remaining -= argument.length + 1;
  }
}

export { uploadInteger, validateUploadRequest } from './upload-protocol.js';
export type { UploadRequest, Upload, BlobHandle } from './upload-protocol.js';
