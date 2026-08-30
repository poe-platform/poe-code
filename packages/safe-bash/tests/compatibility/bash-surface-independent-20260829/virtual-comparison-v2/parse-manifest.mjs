import { createHash } from 'node:crypto';

export function validateTar(buffer, expected) {
  if (expected.length !== 954 || buffer.length % 512 !== 0) throw new Error('manifest cardinality or tar alignment');
  const inventory = new Map(expected.map(member => [member.path, member]));
  if (inventory.size !== expected.length) throw new Error('duplicate expected path');
  const seen = new Set();
  const field = (header, start, length) => {
    const bytes = header.subarray(start, start + length);
    const zero = bytes.indexOf(0);
    const textBytes = zero < 0 ? bytes : bytes.subarray(0, zero);
    return new TextDecoder('utf-8', { fatal: true }).decode(textBytes);
  };
  const octal = text => {
    const normalized = text.trim();
    if (!/^[0-7]+$/.test(normalized)) throw new Error('invalid octal');
    const result = Number.parseInt(normalized, 8);
    if (!Number.isSafeInteger(result)) throw new Error('unsafe octal');
    return result;
  };
  let offset = 0;
  let payloadBytes = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (buffer.length - offset < 1024 || !buffer.subarray(offset).every(byte => byte === 0)) throw new Error('invalid tar terminator');
      if (seen.size !== 954) throw new Error('missing members');
      return { members: seen.size, payloadBytes, decodedBytes: buffer.length, extractionCalls: 0 };
    }
    let checksum = 0;
    for (let index = 0; index < 512; index++) checksum += index >= 148 && index < 156 ? 32 : header[index];
    if (checksum !== octal(field(header, 148, 8))) throw new Error('tar checksum');
    const prefix = field(header, 345, 155);
    const path = `${prefix ? prefix + '/' : ''}${field(header, 0, 100)}`;
    if (!path.startsWith('package/') || path.includes('\\') || path.split('/').some(part => part === '..' || part === '.') || path.includes('\0')) throw new Error('path');
    if (header[156] !== 0 && header[156] !== 48) throw new Error('nonregular tar member');
    if (field(header, 157, 100)) throw new Error('link target');
    const bytes = octal(field(header, 124, 12));
    const mode = octal(field(header, 100, 8));
    const end = offset + 512 + bytes;
    if (!Number.isSafeInteger(end) || end > buffer.length) throw new Error('truncated member');
    const member = inventory.get(path.slice('package/'.length));
    if (!member || seen.has(path) || member.bytes !== bytes || member.mode !== mode) throw new Error(`member metadata: ${path}`);
    const digest = createHash('sha256').update(buffer.subarray(offset + 512, end)).digest('hex');
    if (digest !== member.sha256) throw new Error(`member hash: ${path}`);
    seen.add(path);
    payloadBytes += bytes;
    offset += 512 + Math.ceil(bytes / 512) * 512;
  }
  throw new Error('missing tar terminator');
}
