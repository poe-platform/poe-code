import fs from 'node:fs';
import {createHash} from 'node:crypto';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function readPinned(filename, pin, maximum = 16777216) {
  const before = fs.lstatSync(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.size !== pin.bytes || before.size > maximum) throw Error('AUTH_TYPE_SIZE');
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw Error('AUTH_CHANGED');
    const bytes = Buffer.alloc(pin.bytes);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (!count) throw Error('AUTH_SHORT');
      offset += count;
    }
    if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, offset) || hash(bytes) !== pin.sha256) throw Error('AUTH_HASH');
    return bytes;
  } finally { fs.closeSync(descriptor); }
}
export function pinExecutable(pin) {
  const before = fs.lstatSync(pin.path);
  if (!before.isFile() || before.isSymbolicLink() || before.size !== pin.bytes || (before.mode & 4095) !== pin.mode) throw Error('TOOL_TYPE_SIZE_MODE');
  const descriptor = fs.openSync(pin.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const digest = createHash('sha256'), buffer = Buffer.alloc(65536);
  let size = 0;
  try {
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw Error('TOOL_CHANGED');
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      size += count;
      if (size > pin.bytes) throw Error('TOOL_LONG');
      digest.update(buffer.subarray(0, count));
    }
  } finally { fs.closeSync(descriptor); }
  if (size !== pin.bytes || digest.digest('hex') !== pin.sha256) throw Error('TOOL_HASH');
}
export function errorRecord(reason) {
  if (reason === undefined) return {kind:'undefined'};
  if (reason === null) return {kind:'null'};
  if (typeof reason !== 'object') return {kind:typeof reason, value:reason};
  const row = {kind:'object'};
  for (const key of ['name','message','code','errno','syscall','permission']) if (typeof reason[key] === 'string' || typeof reason[key] === 'number') row[key] = typeof reason[key] === 'string' ? reason[key].slice(0,1024) : reason[key];
  return row;
}
export class Primary {
  present = false;
  reason;
  secondary = [];
  fail(reason) { if (!this.present) {this.present = true; this.reason = reason;} else this.secondary.push(errorRecord(reason)); }
}
export function publish(filename, bytes, finalDeadline, operations = fs) {
  if (Date.now() >= finalDeadline) throw Error('FINAL_DEADLINE');
  let descriptor, primary = new Primary();
  try {
    descriptor = operations.openSync(filename, 'wx+', 384);
    if (Date.now() >= finalDeadline) throw Error('FINAL_DEADLINE');
    operations.writeFileSync(descriptor, bytes);
    operations.fsyncSync(descriptor);
    if (operations.fstatSync(descriptor).size !== bytes.length) throw Error('PUBLICATION_SIZE');
    const observed = Buffer.alloc(bytes.length);
    let offset = 0;
    while (offset < observed.length) { const count = operations.readSync(descriptor, observed, offset, observed.length-offset, offset); if (!count) throw Error('PUBLICATION_SHORT'); offset += count; }
    if (hash(observed) !== hash(bytes)) throw Error('PUBLICATION_HASH');
  } catch (reason) { primary.fail(reason); }
  finally { if (descriptor !== undefined) try { operations.closeSync(descriptor); } catch(reason) { primary.fail(reason); } }
  if (primary.present) throw primary.reason;
  if (Date.now() >= finalDeadline) throw Error('FINAL_DEADLINE');
  return {bytes:bytes.length,sha256:hash(bytes),qualified:true};
}
