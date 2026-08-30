import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const utf8 = new TextDecoder('utf-8', { fatal: true });
export const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);

export function safePath(path) {
  assert.ok(typeof path === 'string' && path.length > 0 && Buffer.byteLength(path) <= 4096);
  assert.ok(!path.startsWith('/') && !path.includes('\\') && !/[\x00-\x1f\x7f]/u.test(path), `unsafe package path: ${JSON.stringify(path)}`);
  assert.ok(path.split('/').every(part => part && part !== '.' && part !== '..'), `noncanonical package path: ${path}`);
  return path;
}

function paxRecords(payload) {
  const result = Object.create(null);
  let offset = 0;
  while (offset < payload.length) {
    const space = payload.indexOf(32, offset);
    assert.ok(space > offset);
    const digits = payload.subarray(offset, space).toString('ascii');
    assert.match(digits, /^[1-9][0-9]*$/u);
    const length = Number(digits);
    assert.ok(Number.isSafeInteger(length) && length > space - offset + 3 && offset + length <= payload.length);
    assert.equal(payload[offset + length - 1], 10);
    const record = utf8.decode(payload.subarray(space + 1, offset + length - 1));
    assert.ok(!record.includes('\0'));
    const separator = record.indexOf('=');
    assert.ok(separator > 0);
    const key = record.slice(0, separator);
    assert.ok(['path', 'mtime', 'atime', 'ctime', 'uid', 'gid', 'uname', 'gname'].includes(key), `unsupported authentication-archive extension: ${key}`);
    assert.ok(!Object.hasOwn(result, key), `duplicate authentication-archive extension: ${key}`);
    result[key] = record.slice(separator + 1);
    offset += length;
  }
  return result;
}

export function packageTarMap(compressed) {
  assert.ok(compressed.length <= 16 * 1024 * 1024, 'compressed archive verification budget');
  const archive = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
  assert.equal(archive.length % 512, 0);
  const paths = new Map();
  const caseFolded = new Set();
  const payloads = new Map();
  let pending = null;
  let offset = 0;
  let headers = 0;
  let paxHeaders = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) break;
    assert.ok(++headers <= 20000, 'archive header budget');
    const text = (start, end) => {
      const field = header.subarray(start, end);
      const zero = field.indexOf(0);
      return utf8.decode(zero < 0 ? field : field.subarray(0, zero));
    };
    const octal = (start, end) => {
      const value = text(start, end).trim();
      assert.match(value, /^[0-7]+$/u);
      const parsed = parseInt(value, 8);
      assert.ok(Number.isSafeInteger(parsed));
      return parsed;
    };
    let checksum = 0;
    for (const [index, byte] of header.entries()) checksum += index >= 148 && index < 156 ? 32 : byte;
    assert.equal(checksum, octal(148, 156), 'tar header checksum');
    const size = octal(124, 136);
    assert.ok(size <= 64 * 1024 * 1024, 'single-member verification budget');
    const next = offset + 512 + Math.ceil(size / 512) * 512;
    assert.ok(next <= archive.length, 'truncated archive');
    const content = archive.subarray(offset + 512, offset + 512 + size);
    const type = text(156, 157);
    offset = next;
    if (type === 'x') {
      assert.equal(pending, null, 'stacked local extensions outside this verifier profile');
      pending = paxRecords(content);
      paxHeaders++;
      continue;
    }
    assert.ok(['', '0', '5'].includes(type), `nonregular/link/special member rejected: ${type}`);
    assert.equal(text(157, 257), '', 'link target on regular member');
    const magic = text(257, 263);
    assert.ok(magic === '' || magic === 'ustar' || magic === 'ustar ');
    const prefix = magic ? text(345, 500) : '';
    const rawPath = pending?.path ?? [prefix, text(0, 100)].filter(Boolean).join('/');
    pending = null;
    const path = safePath(rawPath.replace(/\/$/u, ''));
    assert.ok(path === 'package' || path.startsWith('package/'), `outside package prefix: ${path}`);
    assert.ok(!paths.has(path), `duplicate archive path: ${path}`);
    const folded = path.normalize('NFC').toLowerCase();
    assert.ok(!caseFolded.has(folded), `case/unicode path collision: ${path}`);
    caseFolded.add(folded);
    const mode = octal(100, 108);
    assert.equal(mode & 0o7000, 0, 'special permission bits outside safe extraction profile');
    const entry = { type: type === '5' ? 'directory' : 'file', mode: mode & 0o777, bytes: size };
    if (entry.type === 'directory') assert.equal(size, 0);
    else {
      assert.notEqual(path, 'package');
      entry.sha256 = digest(content);
      payloads.set(path.slice('package/'.length), content);
    }
    paths.set(path, entry);
  }
  assert.equal(pending, null, 'dangling local metadata');
  assert.ok(archive.length - offset >= 1024 && archive.subarray(offset).every(value => value === 0), 'missing end marker or trailing archive data');
  for (const path of paths.keys()) {
    const components = path.split('/');
    for (let index = 1; index < components.length; index++) {
      const parent = paths.get(components.slice(0, index).join('/'));
      assert.ok(!parent || parent.type === 'directory', `file used as parent: ${path}`);
    }
  }
  const files = Object.fromEntries([...paths].filter(([, entry]) => entry.type === 'file').map(([path, entry]) => [path.slice('package/'.length), entry]).sort(([left], [right]) => left.localeCompare(right)));
  assert.ok(files['package.json'] && files['dist/bundle/index.js'], 'required published entries absent');
  return { files, payloads, headers, paxHeaders, expandedBytes: archive.length, extractionPerformed: false };
}
