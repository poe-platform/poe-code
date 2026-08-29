import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { types } from 'node:util';

const native = Object.fromEntries(['lstatSync','realpathSync','openSync','closeSync','readSync','writeSync','fstatSync','fsyncSync','writeFileSync','readFileSync'].map(name => [name, fs[name].bind(fs)]));
const hrefGetter = Object.getOwnPropertyDescriptor(URL.prototype, 'href').get;
export const stickyKey = 'safe-bash-breadth-regex-sticky-v1';
export const requested = Object.freeze({ execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function requireValue(ok, code) { if (!ok) throw Object.assign(new Error(code), { code }); }
export function own(value, keys) {
  requireValue(value !== null && typeof value === 'object' && !types.isProxy(value), 'OWN_DATA');
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  requireValue(names.length === keys.length && names.every(name => typeof name === 'string' && keys.includes(name)), 'OWN_KEYS');
  const result = {};
  for (const name of keys) { requireValue(Object.hasOwn(descriptors[name], 'value'), 'ACCESSOR'); result[name] = descriptors[name].value; }
  return result;
}
export function canonicalURL(value, expected) {
  requireValue(typeof value === 'object' && value !== null && !types.isProxy(value), 'URL_BRAND');
  let href;
  try { href = hrefGetter.call(value); } catch { throw Object.assign(new Error('URL_BRAND'), { code: 'URL_BRAND' }); }
  requireValue(href === expected && pathToFileURL(fileURLToPath(href)).href === href, 'URL_EXACT');
  return href;
}
export function options(value) {
  const fields = own(value, ['execArgv','resourceLimits']);
  requireValue(Array.isArray(fields.execArgv), 'ARGV_ARRAY');
  requireValue(own(fields.execArgv, ['length']).length === 0, 'ARGV_EMPTY');
  const limits = own(fields.resourceLimits, ['maxOldGenerationSizeMb','stackSizeMb']);
  requireValue(limits.maxOldGenerationSizeMb === 128 && limits.stackSizeMb === 4, 'RESOURCE_LIMITS');
}
export function bytes(filename, maximum, binding) {
  requireValue(typeof filename === 'string' && path.isAbsolute(filename) && !filename.split(path.sep).some(name => name.toUpperCase() === 'AGENTS.MD'), 'FILE_PATH');
  const info = native.lstatSync(filename);
  requireValue(info.isFile() && !info.isSymbolicLink() && info.size <= maximum && native.realpathSync(filename) === filename, 'FILE_METADATA');
  if (binding) requireValue(info.size === binding.bytes && (info.mode & 4095) === binding.mode, 'FILE_BOUND_METADATA');
  const descriptor = native.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW), chunks = [];
  try {
    const opened = native.fstatSync(descriptor);
    requireValue(opened.ino === info.ino && opened.dev === info.dev && opened.size === info.size, 'FILE_OPEN_IDENTITY');
    for (let offset = 0; offset < info.size;) {
      const chunk = Buffer.alloc(Math.min(65536, info.size - offset));
      requireValue(native.readSync(descriptor, chunk, 0, chunk.length, offset) === chunk.length, 'FILE_SHORT_READ');
      chunks.push(chunk); offset += chunk.length;
    }
  } finally { native.closeSync(descriptor); }
  const result = Buffer.concat(chunks);
  if (binding) requireValue(hash(result) === binding.sha256, 'FILE_HASH');
  return result;
}
export function admit(binding, source) {
  const fields = own(binding, ['url','bytes','mode','sha256','imports','role']);
  requireValue(typeof fields.url === 'string' && /^file:/.test(fields.url) && Number.isSafeInteger(fields.bytes) && fields.bytes >= 0 && fields.bytes <= 2093056 && fields.mode === 0o644 && /^[a-f0-9]{64}$/.test(fields.sha256), 'BINDING_SCHEMA');
  const value = bytes(fileURLToPath(fields.url), 2093056, fields);
  if (source !== undefined && source !== null) {
    requireValue(typeof source === 'string' || source instanceof Uint8Array, 'LOAD_SOURCE_TYPE');
    const loaded = typeof source === 'string' ? Buffer.from(source) : source;
    requireValue(loaded.length === fields.bytes && hash(loaded) === fields.sha256, 'LOADED_SOURCE_HASH');
  }
  return { url: fields.url, bytes: value.length, sha256: fields.sha256 };
}
export function createPrivate(filename, value) {
  const data = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value) + '\n');
  requireValue(data.length <= 32768, 'PRIVATE_CONFIG_BOUND');
  native.writeFileSync(filename, data, { flag: 'wx', mode: 0o600 });
  return { bytes: data.length, mode: 0o600, sha256: hash(data) };
}
export function journal(filename, maximum = 65536) {
  const descriptor = native.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW);
  let count = 0, closed = false;
  return {
    emit(value) {
      requireValue(!closed, 'JOURNAL_CLOSED');
      const data = Buffer.from(JSON.stringify(value) + '\n');
      requireValue(data.length <= 16384 && count + data.length <= maximum, 'JOURNAL_BOUND');
      let offset = 0;
      while (offset < data.length) { const amount = native.writeSync(descriptor, data, offset, data.length - offset); requireValue(amount > 0, 'JOURNAL_SHORT_WRITE'); offset += amount; }
      count += data.length; native.fsyncSync(descriptor);
    },
    close() { if (!closed) { closed = true; try { native.fsyncSync(descriptor); } finally { native.closeSync(descriptor); } } },
    get bytes() { return count; },
  };
}
export function reason(value) {
  if (value === undefined) return { type: 'undefined' };
  if (value === null) return { type: 'null' };
  if (['boolean','number','string'].includes(typeof value)) return { type: typeof value, value };
  return { type: 'object', name: String(value?.name ?? 'object').slice(0,128), code: typeof value?.code === 'string' ? value.code.slice(0,128) : null, message: String(value?.message ?? value).slice(0,1024) };
}
export function assess(receipt, context) {
  const binding = own(context, ['entry','members','maximumStarts','operation']);
  requireValue(typeof binding.entry === 'string' && Array.isArray(binding.members) && binding.members.length === 4 && Number.isSafeInteger(binding.maximumStarts) && binding.maximumStarts >= 0 && binding.maximumStarts <= 8 && typeof binding.operation === 'string', 'ASSESSOR_BINDING');
  const value = own(receipt, ['schema','attempts','created','rows','violations','primaryPresent','primary','cleanup','closed']);
  requireValue(value.schema === 'BREADTH_REGEX_RECEIPT_V1' && Number.isSafeInteger(value.attempts) && Number.isSafeInteger(value.created) && value.created >= 0 && value.attempts >= value.created && value.attempts <= 8, 'RECEIPT_COUNTS');
  requireValue(Array.isArray(value.rows) && value.rows.length === value.created && value.rows.length <= 8 && Array.isArray(value.violations) && value.violations.length <= 64 && Array.isArray(value.cleanup) && value.cleanup.length <= 128 && typeof value.primaryPresent === 'boolean' && value.closed === true, 'RECEIPT_SCHEMA');
  let qualified = value.attempts === value.created && value.attempts <= binding.maximumStarts && !value.primaryPresent && value.violations.length === 0 && value.cleanup.length === 0;
  const tokens = new Set();
  for (const row of value.rows) {
    const item = own(row, ['token','entry','requested','effective','exited','exitCode','terminateCalls','terminatePending','terminateErrors','terminateResults','emergency','sticky','witnesses','expected','errors']);
    options(item.requested);
    const effective = own(item.effective, ['execArgv','resourceLimits']);
    requireValue(typeof item.token === 'string' && typeof item.entry === 'string' && Array.isArray(effective.execArgv) && effective.execArgv.length === 2 && effective.execArgv[0] === '--import' && typeof effective.execArgv[1] === 'string', 'ROW_IDENTITY');
    requireValue(Array.isArray(item.terminateResults) && item.terminateResults.length <= item.terminateCalls, 'TERMINATE_RESULTS');
    own(effective.execArgv, ['0','1','length']);
    options({ execArgv: [], resourceLimits: effective.resourceLimits });
    requireValue(item.entry === binding.entry && item.token.startsWith(binding.operation + ':') && !tokens.has(item.token), 'ROW_AUTHORITY');
    tokens.add(item.token);
    requireValue(typeof item.exited === 'boolean' && (item.exitCode === null || Number.isInteger(item.exitCode)) && Number.isSafeInteger(item.terminateCalls) && item.terminateCalls >= 0 && Number.isSafeInteger(item.terminatePending) && item.terminatePending >= 0 && Array.isArray(item.terminateErrors) && typeof item.emergency === 'boolean' && Number.isInteger(item.sticky) && Array.isArray(item.witnesses) && Array.isArray(item.expected) && Array.isArray(item.errors), 'ROW_DISPOSITION');
    const loads = item.witnesses.filter(event => event.event === 'load' && event.role === 'product');
    requireValue(item.witnesses.length <= 128 && item.expected.length === 4 && JSON.stringify(item.expected) === JSON.stringify(binding.members), 'WITNESS_BINDING');
    const expected = item.expected.map(member => member.url).sort(), actual = loads.map(event => event.url).sort();
    const matching = JSON.stringify(expected) === JSON.stringify(actual) && item.expected.every(member => loads.some(event => event.token === item.token && event.url === member.url && event.sha256 === member.sha256 && event.bytes === member.bytes));
    qualified &&= item.exited && item.exitCode !== null && item.terminateCalls > 0 && item.terminatePending === 0 && item.terminateErrors.length === 0 && item.terminateResults.length === item.terminateCalls && item.terminateResults.some(result => result.type === 'number' && result.value === item.exitCode) && !item.emergency && item.sticky === 0 && item.errors.length === 0 && matching;
  }
  return { qualified, created: value.created, primaryPresent: value.primaryPresent, primary: value.primary };
}

const sharedLength = Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength').get;
export function witness(value, token) {
  const fields = own(value, ['token','flag']);
  requireValue(Object.getPrototypeOf(value) === Object.prototype && typeof fields.token === 'string' && fields.token === token, 'WITNESS_TOKEN');
  requireValue(types.isSharedArrayBuffer(fields.flag) && sharedLength.call(fields.flag) === 4, 'WITNESS_FLAG');
  const cell = new Int32Array(fields.flag);
  requireValue(Atomics.load(cell, 0) === 0, 'WITNESS_ALREADY_REFUSED');
  return cell;
}
