/** v1 control integers are canonical decimal uint64 strings, never JSON numbers. */
export interface UploadRequest { size: string; digest: string }
export interface Upload extends UploadRequest {
  uploadId: string;
  committedOffset: string;
  state: 'open' | 'committed' | 'aborted' | 'expired';
  blobId?: string;
}
export interface BlobHandle extends UploadRequest { blobId: string }
/** Opaque IDs occupy one URL segment. URL dot-segment normalization must never
 * redirect an authenticated transfer to another resource or lifecycle route. */
export function uploadRouteId(value: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 256 || value === '.' || value === '..') {
    throw new UploadError(400, 'Invalid upload resource ID');
  }
  return encodeURIComponent(value);
}
export class UploadError extends Error {
  constructor(readonly status: number, message: string, readonly code?: 'wrong-length' | 'wrong-hash') { super(message); this.name = 'UploadError'; }
}
export function uploadInteger(value: unknown): bigint {
  if (typeof value !== 'string' || !value.length || value.length > 20
    || (value.length > 1 && value[0] === '0') || [...value].some(c => c < '0' || c > '9')) {
    throw new UploadError(400, 'Invalid v1 uint64');
  }
  const n = BigInt(value);
  if (n > 18446744073709551615n) throw new UploadError(400, 'Invalid v1 uint64');
  return n;
}
export function validateUploadRequest(value: unknown): asserts value is UploadRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(k => k !== 'size' && k !== 'digest')) throw new UploadError(400, 'Invalid upload request');
  const v = value as UploadRequest;
  uploadInteger(v.size);
  if (typeof v.digest !== 'string' || v.digest.length !== 64 || [...v.digest].some(c => !'0123456789abcdef'.includes(c))) {
    throw new UploadError(400, 'Invalid SHA-256');
  }
}
/** Semantic checks after the v1 control record's shape has been validated. */
export function validateUploadState(upload: Upload, creationReplayed?: boolean): void {
  try {
    uploadRouteId(upload.uploadId);
    if (upload.blobId !== undefined) uploadRouteId(upload.blobId);
  } catch {
    throw new UploadError(502, 'Unroutable upload acknowledgement');
  }
  if (uploadInteger(upload.committedOffset) > uploadInteger(upload.size)
    || (creationReplayed === false && (upload.state !== 'open' || upload.committedOffset !== '0'))
    || (upload.state !== 'committed' && upload.blobId !== undefined)
    || (upload.state === 'committed' && (!upload.blobId || upload.committedOffset !== upload.size))) {
    throw new UploadError(502, 'Incomplete or inconsistent upload acknowledgement');
  }
}
export function digestHeader(digest: Uint8Array): string {
  return `sha-256=:${btoa(String.fromCharCode(...digest))}:`;
}

/** Read actual typed-array storage without producer-owned length properties. */
export function uploadByteLength(bytes: Uint8Array): number {
  return Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(bytes) as number;
}
