import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';

export const COMPRESSED_MAX = 872281;
export const DECODED_MAX = 64 * 1024 * 1024;

function refuse(code) {
  throw Object.assign(new Error(code), { code });
}

function sameFile(first, second) {
  return first.dev === second.dev && first.ino === second.ino &&
    first.size === second.size && first.mtimeMs === second.mtimeMs &&
    first.ctimeMs === second.ctimeMs && second.isFile();
}

export async function admitPackage(filename, authority, ledger, operations) {
  if (!Number.isSafeInteger(authority.bytes) || authority.bytes < 1 ||
      authority.bytes > COMPRESSED_MAX || !/^[a-f0-9]{64}$/.test(authority.sha256)) refuse('AUTHORITY');
  const decodedLimit = authority.decodedLimit ?? DECODED_MAX;
  if (!Number.isSafeInteger(decodedLimit) || decodedLimit < 1 || decodedLimit > DECODED_MAX) refuse('AUTHORITY');
  const reserve = bytes => {
    if (ledger.current + bytes > ledger.maximum) refuse('AGGREGATE');
    ledger.current += bytes;
    ledger.peak = Math.max(ledger.peak, ledger.current);
  };
  const before = await fs.lstat(filename);
  if (!before.isFile()) refuse('TYPE');
  if (before.size !== authority.bytes) refuse('SIZE');
  operations.events.push('lstat-type-size');
  let descriptor;
  let compressed;
  let reserved = 0;
  let primaryPresent = false;
  let primary;
  let closePresent = false;
  let closeReason;
  try {
    descriptor = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await descriptor.stat();
    if (!sameFile(before, opened)) refuse('IDENTITY');
    reserve(authority.bytes + 1);
    reserved += authority.bytes + 1;
    compressed = Buffer.alloc(authority.bytes);
    const probe = Buffer.alloc(1);
    await operations.afterOpen?.();
    let offset = 0;
    while (offset < compressed.length) {
      const result = await descriptor.read(compressed, offset, Math.min(65536, compressed.length - offset), offset);
      if (result.bytesRead === 0) refuse('SHORT_READ');
      offset += result.bytesRead;
    }
    if ((await descriptor.read(probe, 0, 1, offset)).bytesRead !== 0) refuse('LONG_READ');
    operations.events.push('bounded-read');
    await operations.afterRead?.();
    if (!sameFile(opened, await descriptor.stat()) || !sameFile(opened, await fs.lstat(filename))) refuse('MUTATION');
    operations.events.push('postread-identity');
    const digest = createHash('sha256').update(compressed).digest('hex');
    if (digest !== authority.sha256) refuse('HASH');
    operations.events.push('exact-hash');
  } catch (reason) {
    primaryPresent = true;
    primary = reason;
  } finally {
    if (descriptor) {
      try { await descriptor.close(); operations.events.push('descriptor-closed'); }
      catch (reason) { closePresent = true; closeReason = reason; }
    }
  }
  try {
    if (primaryPresent && closePresent) throw new AggregateError([primary, closeReason], 'admission and close failed');
    if (primaryPresent) throw primary;
    if (closePresent) throw closeReason;
    const parseReserve = operations.parseReserve ?? 2 * 1024 * 1024;
    if (!Number.isSafeInteger(parseReserve) || parseReserve < 0) refuse('AUTHORITY');
    reserve(decodedLimit + parseReserve);
    reserved += decodedLimit + parseReserve;
    operations.events.push('concurrent-buffers-reserved');
    const decoded = operations.decode(compressed, { maxOutputLength: decodedLimit });
    if (!Buffer.isBuffer(decoded) || decoded.length > decodedLimit) refuse('DECODED_SIZE');
    operations.events.push('decoded');
    const result = operations.parse(decoded);
    operations.events.push('parsed');
    return { result, compressedBytes: compressed.length, decodedBytes: decoded.length, sha256: authority.sha256 };
  } finally {
    compressed = undefined;
    ledger.current -= reserved;
  }
}
