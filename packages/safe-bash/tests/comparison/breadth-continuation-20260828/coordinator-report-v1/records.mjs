import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const limits = Object.freeze({ record: 262144, evidence: 268435456, document: 33554432, stream: 65536, depth: 64, nodes: 1000000 });
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = (condition, code) => { if (!condition) fail(code); };
const validName = name => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(name) && !name.toLowerCase().includes('agents.md');

export function encode(value, maximum = limits.document) {
  check(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= limits.document, 'DOCUMENT_LIMIT');
  const fragments = [];
  const active = new Set();
  let bytes = 0;
  let nodes = 0;
  const append = text => { bytes += Buffer.byteLength(text); check(bytes <= maximum, 'DOCUMENT_CAP'); fragments.push(text); };
  const string = text => {
    check(text.length <= maximum, 'DOCUMENT_CAP');
    let encoded = 2;
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) encoded += 2;
      else if (code < 32) encoded += 6;
      else if (code < 128) encoded++;
      else if (code < 2048) encoded += 2;
      else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) { encoded += 4; index++; }
      else if (code >= 0xd800 && code <= 0xdfff) encoded += 6;
      else encoded += 3;
      check(bytes + encoded <= maximum, 'DOCUMENT_CAP');
    }
    append(JSON.stringify(text));
  };
  const visit = (item, depth, arrayMember = false) => {
    check(++nodes <= limits.nodes && depth <= limits.depth, 'SERIALIZATION_BOUND');
    if (item === undefined) { check(arrayMember, 'SERIALIZATION_UNDEFINED_ROOT'); append('null'); return; }
    if (item === null) { append('null'); return; }
    if (typeof item === 'string') { string(item); return; }
    if (typeof item === 'number' || typeof item === 'boolean') { append(JSON.stringify(item)); return; }
    check(typeof item === 'object', 'SERIALIZATION_TYPE');
    check(!active.has(item), 'SERIALIZATION_CYCLE');
    check(Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null, 'SERIALIZATION_PROTOTYPE');
    active.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const descriptor of Object.values(descriptors)) check(!descriptor.get && !descriptor.set, 'SERIALIZATION_ACCESSOR');
    check(!Object.hasOwn(descriptors, 'toJSON'), 'SERIALIZATION_TOJSON');
    if (Array.isArray(item)) {
      append('[');
      for (let index = 0; index < item.length; index++) { if (index) append(','); visit(descriptors[index]?.value, depth + 1, true); }
      append(']');
    } else {
      append('{');
      let count = 0;
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!descriptor.enumerable || descriptor.value === undefined) continue;
        if (count++) append(',');
        string(key); append(':'); visit(descriptor.value, depth + 1);
      }
      append('}');
    }
    active.delete(item);
  };
  visit(value, 0);
  append('\n');
  return Buffer.from(fragments.join(''));
}

export function createStore(root, { totalLimit = limits.evidence, io = fs } = {}) {
  check(Number.isSafeInteger(totalLimit) && totalLimit > 0 && totalLimit <= limits.evidence, 'EVIDENCE_LIMIT');
  const info = fs.lstatSync(root);
  check(info.isDirectory() && !info.isSymbolicLink(), 'STORE_ROOT');
  let accounted = 0;
  const writes = [];
  function writeRecord(name, bytes) {
    check(validName(name), 'RECORD_NAME');
    check(Buffer.isBuffer(bytes) && bytes.length <= limits.record, 'RECORD_CAP');
    check(accounted + bytes.length <= totalLimit, 'EVIDENCE_CAP');
    accounted += bytes.length;
    const entry = { path: name, bytes: bytes.length, sha256: digest(bytes), mode: 0o644, complete: false };
    writes.push(entry);
    const descriptor = io.openSync(path.join(root, name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o644);
    let primary;
    let primaryPresent = false;
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const count = io.writeSync(descriptor, bytes, offset, bytes.length - offset);
        check(Number.isInteger(count) && count > 0 && count <= bytes.length - offset, 'RECORD_WRITE');
        offset += count;
      }
    } catch (error) { primary = error; primaryPresent = true; }
    try { io.closeSync(descriptor); }
    catch (error) {
      entry.closeFailure = true;
      if (primaryPresent) throw Object.assign(new Error('RECORD_WRITE_AND_CLOSE'), { code: 'RECORD_WRITE_AND_CLOSE', primaryPresent: true, primary, cleanup: error });
      throw error;
    }
    if (primaryPresent) throw primary;
    entry.complete = true;
    return { path: name, bytes: bytes.length, sha256: entry.sha256, mode: entry.mode };
  }
  function save(name, value, maximum = limits.document) {
    check(validName(name), 'RECORD_NAME');
    const bytes = encode(value, maximum);
    if (bytes.length <= limits.record) return writeRecord(name, bytes);
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += limits.record) {
      chunks.push(writeRecord(`${name}.part-${String(chunks.length).padStart(4, '0')}.data`, bytes.subarray(offset, offset + limits.record)));
    }
    return writeRecord(name, encode({ schema: 'BOUND_JSON_PARTS_V1', bytes: bytes.length, sha256: digest(bytes), parts: chunks }, limits.record));
  }
  return { save, writeRecord, state: () => ({ accounted, totalLimit, writes: writes.map(entry => ({ ...entry })) }) };
}

export function readDocument(root, name, expectedSha256, maximum = limits.document) {
  check(validName(name) && /^[a-f0-9]{64}$/.test(expectedSha256), 'REFERENCE_BINDING');
  check(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= limits.document, 'DOCUMENT_LIMIT');
  const rootInfo = fs.lstatSync(root);
  check(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), 'STORE_ROOT');
  const readRecord = (member, expected) => {
    check(validName(member), 'REFERENCE_NAME');
    const filename = path.join(root, member);
    const info = fs.lstatSync(filename);
    check(info.isFile() && !info.isSymbolicLink() && (info.mode & 0o7777) === 0o644 && info.size <= limits.record, 'REFERENCE_METADATA');
    const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let bytes;
    try {
      const opened = fs.fstatSync(descriptor);
      check(opened.dev === info.dev && opened.ino === info.ino && opened.size === info.size && (opened.mode & 0o7777) === 0o644, 'REFERENCE_CHANGED');
      bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) { const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset); check(count > 0, 'REFERENCE_SHORT'); offset += count; }
      check(fs.readSync(descriptor, Buffer.alloc(1), 0, 1, offset) === 0, 'REFERENCE_GREW');
    }
    finally { fs.closeSync(descriptor); }
    check(bytes.length === info.size && digest(bytes) === expected, 'REFERENCE_HASH');
    return bytes;
  };
  const bytes = readRecord(name, expectedSha256);
  const envelope = JSON.parse(bytes);
  if (envelope?.schema !== 'BOUND_JSON_PARTS_V1') { check(bytes.length <= maximum, 'DOCUMENT_CAP'); return envelope; }
  check(Number.isSafeInteger(envelope.bytes) && envelope.bytes > limits.record && envelope.bytes <= maximum && /^[a-f0-9]{64}$/.test(envelope.sha256), 'REFERENCE_DOCUMENT');
  check(Array.isArray(envelope.parts) && envelope.parts.length === Math.ceil(envelope.bytes / limits.record), 'REFERENCE_PARTS');
  const chunks = envelope.parts.map((entry, index) => {
    check(entry.path === `${name}.part-${String(index).padStart(4, '0')}.data` && entry.mode === 0o644 && entry.bytes === Math.min(limits.record, envelope.bytes - index * limits.record), 'REFERENCE_PART_BINDING');
    const chunk = readRecord(entry.path, entry.sha256);
    check(chunk.length === entry.bytes, 'REFERENCE_PART_SIZE');
    return chunk;
  });
  const restored = Buffer.concat(chunks);
  check(restored.length === envelope.bytes && digest(restored) === envelope.sha256, 'REFERENCE_DOCUMENT_HASH');
  return JSON.parse(restored);
}
