import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { bindings } from './manifest-bindings.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const reject = message => { throw Object.assign(new Error(message), { code: 'CAPTURE_ADMISSION' }); };
const requireValue = (condition, message) => { if (!condition) reject(message); };
const integer = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);
const filename = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*\.json$/.test(value);

function record(value, keys) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'record type');
  const actual = Reflect.ownKeys(value);
  requireValue(actual.length === keys.length && actual.every(key => typeof key === 'string' && keys.includes(key)), 'record keys');
  for (const key of keys) requireValue(Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'), 'record accessor');
}
function array(value, maximum) {
  requireValue(Array.isArray(value), 'array type');
  const length = Object.getOwnPropertyDescriptor(value, 'length').value;
  requireValue(integer(length) && length <= maximum, 'array length');
  recordArray(value, length);
  return value;
}
function recordArray(value, length) {
  const keys = Reflect.ownKeys(value);
  requireValue(keys.length === length + 1 && keys.includes('length'), 'array holes/extras');
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    requireValue(descriptor !== undefined && Object.hasOwn(descriptor, 'value'), 'array accessor/hole');
  }
}
export function ownEqual(value, expected) {
  if (expected === null || typeof expected !== 'object') return typeof value === typeof expected && Object.is(value, expected) && (typeof value !== 'number' || Number.isFinite(value));
  if (!value || typeof value !== 'object' || Array.isArray(value) !== Array.isArray(expected)) return false;
  const keys = Reflect.ownKeys(value), expectedKeys = Reflect.ownKeys(expected);
  if (keys.length !== expectedKeys.length || keys.some(key => typeof key !== 'string' || !expectedKeys.includes(key))) return false;
  return expectedKeys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value') && ownEqual(descriptor.value, expected[key]);
  });
}
function validateManifest(manifest, profile) {
  record(manifest, ['version', 'files', 'captures']);
  requireValue(manifest.version === 3, 'manifest version');
  array(manifest.files, 512); array(manifest.captures, 16);
  const names = new Set(); let previous = '', total = 0;
  for (const entry of manifest.files) {
    record(entry, ['name', 'kind', 'mode', 'bytes', 'sha256']);
    requireValue(filename(entry.name) && entry.name > previous, 'canonical ordered file names');
    requireValue(['receipt', 'fragment', 'auxiliary'].includes(entry.kind), 'file kind');
    requireValue(entry.kind !== 'auxiliary' || (profile === 'future-inventory' && ['ACTUAL98.json', 'FINAL.json', 'TOOLS.json'].includes(entry.name)), 'finite non-capture metadata');
    requireValue(integer(entry.mode) && entry.mode <= 0o777 && integer(entry.bytes) && digest(entry.sha256), 'file binding types');
    total += entry.bytes; requireValue(total <= 64 * 1024 * 1024, 'manifest byte ceiling');
    names.add(entry.name); previous = entry.name;
  }
  const references = new Set(); previous = '';
  for (const capture of manifest.captures) {
    record(capture, ['id', 'receipt', 'fragments']);
    requireValue(identifier(capture.id) && capture.id > previous, 'capture id/order'); previous = capture.id;
    requireValue(capture.receipt === `${capture.id}.json`, 'receipt path');
    array(capture.fragments, 512);
    for (const name of [capture.receipt, ...capture.fragments]) {
      requireValue(filename(name) && names.has(name) && !references.has(name), 'manifest reference membership/duplicate');
      references.add(name);
      requireValue(manifest.files.find(entry => entry.name === name).kind === (name === capture.receipt ? 'receipt' : 'fragment'), 'reference kind');
    }
  }
  for (const entry of manifest.files) requireValue(entry.kind === 'auxiliary' ? !references.has(entry.name) : references.has(entry.name), 'unreferenced manifest record');
}
function regular(filenameValue, expected) {
  const stat = fs.lstatSync(filenameValue);
  requireValue(stat.isFile() && !stat.isSymbolicLink(), 'regular file required');
  requireValue(stat.size === expected.bytes && (stat.mode & 0o777) === expected.mode, 'file size/mode');
  const bytes = fs.readFileSync(filenameValue);
  requireValue(bytes.length === expected.bytes && sha256(bytes) === expected.sha256, 'file hash/length');
  return bytes;
}
export function boundManifest(profile) {
  requireValue(typeof profile === 'string' && Object.hasOwn(bindings, profile), 'finite profile');
  const binding = bindings[profile];
  const bytes = regular(path.join(own, binding.manifest), binding);
  const manifest = JSON.parse(bytes);
  return { binding, manifest };
}
function validateReceipt(receipt, capture) {
  requireValue(receipt !== null && typeof receipt === 'object' && !Array.isArray(receipt), 'receipt type');
  const basic = ['id', 'code', 'signal', 'fault', 'closeObserved', 'groupAbsent', 'knownChildCleanup', 'bytes', 'stdoutSha256', 'stderrSha256', 'fragments'];
  const extended = ['executable', 'args', 'started', 'finished', 'startedElapsedMs', 'finishedElapsedMs', 'pid', 'spawnAttempted', 'spawnReturned', 'spawnEvent', 'spawnThrew', 'spawnError'];
  record(receipt, Object.hasOwn(receipt, 'executable') ? [...basic, ...extended] : basic);
  requireValue(receipt.id === capture.id && receipt.code === 0 && receipt.signal === null && receipt.fault === null, 'receipt outcome');
  requireValue(receipt.closeObserved === true && receipt.groupAbsent === true && receipt.knownChildCleanup === true, 'receipt cleanup');
  requireValue(integer(receipt.bytes) && receipt.bytes <= 16 * 1024 * 1024 && digest(receipt.stdoutSha256) && digest(receipt.stderrSha256), 'receipt bytes/hash types');
  if (Object.hasOwn(receipt, 'executable')) {
    for (const key of ['executable', 'started', 'finished']) requireValue(typeof receipt[key] === 'string', 'supervisor string');
    array(receipt.args, 32); for (const value of receipt.args) requireValue(typeof value === 'string', 'argv string');
    for (const key of ['startedElapsedMs', 'finishedElapsedMs']) requireValue(typeof receipt[key] === 'number' && Number.isFinite(receipt[key]) && receipt[key] >= 0, 'supervisor time');
    requireValue(integer(receipt.pid) && receipt.pid > 0 && receipt.spawnAttempted === true && receipt.spawnReturned === true && receipt.spawnEvent === true && receipt.spawnThrew === false && receipt.spawnError === null, 'supervisor state');
  }
  array(receipt.fragments, 512);
  requireValue(receipt.fragments.length === capture.fragments.length, 'record count');
  receipt.fragments.forEach((descriptor, index) => {
    record(descriptor, ['name', 'bytes', 'sha256']);
    requireValue(descriptor.name === capture.fragments[index] && integer(descriptor.bytes) && descriptor.bytes > 0 && descriptor.bytes <= 65536 && digest(descriptor.sha256), 'ordered descriptor binding');
  });
}
function parseRecord(bytes) {
  const value = JSON.parse(bytes);
  requireValue(bytes.equals(Buffer.from(JSON.stringify(value))) || bytes.equals(Buffer.from(JSON.stringify(value, null, 2) + '\n')), 'declared capture JSON encoding');
  return value;
}
export function readCapture(directory, id, profile, suppliedManifest) {
  const { binding, manifest: authenticated } = boundManifest(profile);
  const manifest = suppliedManifest === undefined ? authenticated : suppliedManifest;
  requireValue(ownEqual(manifest, authenticated), 'manifest differs from source-authenticated bytes');
  validateManifest(manifest, profile);
  requireValue(typeof directory === 'string' && directory === path.resolve(own, binding.directory), 'bound namespace path');
  requireValue(typeof id === 'string' && manifest.captures.some(capture => capture.id === id), 'admitted capture id');
  let ancestor = directory;
  while (ancestor !== path.dirname(own)) {
    const stat = fs.lstatSync(ancestor); requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'namespace directory');
    const parent = path.dirname(ancestor); requireValue(parent !== ancestor, 'namespace scope'); ancestor = parent;
  }
  const names = fs.readdirSync(directory, { encoding: 'buffer' }).sort(Buffer.compare);
  requireValue(names.length === manifest.files.length && names.every((name, index) => name.equals(Buffer.from(manifest.files[index].name))), 'exact capture namespace');
  const bodies = new Map();
  for (const entry of manifest.files) bodies.set(entry.name, regular(path.join(directory, entry.name), entry));
  const outputs = new Map();
  for (const capture of manifest.captures) {
    const receipt = parseRecord(bodies.get(capture.receipt)); validateReceipt(receipt, capture);
    const chunks = { stdout: [], stderr: [] }, offsets = { stdout: 0, stderr: 0 }, totals = {};
    let stderrStarted = false;
    for (const descriptor of receipt.fragments) {
      const fragment = parseRecord(bodies.get(descriptor.name));
      record(fragment, ['channel', 'offset', 'totalBytes', 'base64', 'sha256']);
      requireValue(fragment.channel === 'stdout' || fragment.channel === 'stderr', 'channel type');
      const channel = fragment.channel;
      requireValue(!stderrStarted || channel === 'stderr', 'channel order'); stderrStarted ||= channel === 'stderr';
      requireValue(integer(fragment.offset) && integer(fragment.totalBytes) && fragment.totalBytes <= 16 * 1024 * 1024 && typeof fragment.base64 === 'string' && digest(fragment.sha256), 'fragment types');
      requireValue(fragment.base64.length <= 87384, 'base64 ceiling');
      const bytes = Buffer.from(fragment.base64, 'base64');
      requireValue(bytes.toString('base64') === fragment.base64, 'canonical base64');
      requireValue(fragment.offset === offsets[channel] && descriptor.name === `${capture.id}-${channel}-${offsets[channel]}.json`, 'fragment offset/path');
      requireValue(bytes.length === descriptor.bytes && sha256(bytes) === descriptor.sha256 && fragment.sha256 === descriptor.sha256, 'fragment length/hash');
      totals[channel] ??= fragment.totalBytes;
      requireValue(totals[channel] === fragment.totalBytes, 'fragment total');
      chunks[channel].push(bytes); offsets[channel] += bytes.length;
      requireValue(offsets[channel] <= receipt.bytes, 'decoded byte ceiling');
    }
    for (const channel of ['stdout', 'stderr']) {
      requireValue(offsets[channel] === (totals[channel] ?? 0), 'truncated channel');
      requireValue(sha256(Buffer.concat(chunks[channel])) === receipt[channel + 'Sha256'], 'aggregate hash');
    }
    requireValue(offsets.stdout + offsets.stderr === receipt.bytes, 'aggregate bytes');
    outputs.set(capture.id, Buffer.concat(chunks.stdout));
  }
  assert.ok(outputs.has(id));
  return outputs.get(id);
}
