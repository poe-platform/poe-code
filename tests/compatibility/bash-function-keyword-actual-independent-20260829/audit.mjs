import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import readline from 'node:readline';

const owned = process.argv[2];
assert.equal(owned, 'tests/compatibility/bash-function-keyword-actual-independent-20260829');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const bounded = (filename, maximum = 16 * 1048576) => {
  const before = fs.lstatSync(filename);
  assert(before.isFile() && before.size <= maximum, filename);
  const bytes = fs.readFileSync(filename);
  const after = fs.lstatSync(filename);
  assert.equal(bytes.length, before.size);
  assert.equal(after.ino, before.ino);
  assert.equal(after.dev, before.dev);
  assert.equal(after.mtimeMs, before.mtimeMs);
  return bytes;
};
const inputs = JSON.parse(bounded(owned + '/AUTHOR-INPUTS.json'));
const manifest = inputs.inputs.find(row => row.name === 'CAPTURE-MANIFEST.json').content;
const stop = inputs.inputs.find(row => row.name === 'STOP.json').content;
const matrix = inputs.inputs.find(row => row.name === 'MATRIX.json').content;
const rows = new Map();
let total = 0, outputBytes = 0;
const log = value => {
  const text = JSON.stringify(value) + '\n';
  const bytes = Buffer.from(text);
  assert(outputBytes + bytes.length < 64 * 1048576);
  outputBytes += bytes.length;
  let offset = 0;
  while (offset < bytes.length) {
    const written = fs.writeSync(3, bytes, offset, bytes.length - offset);
    assert(Number.isSafeInteger(written) && written > 0 && written <= bytes.length - offset);
    offset += written;
  }
  console.log(text.trimEnd());
};
for (const row of manifest.rows) {
  assert(typeof row.path === 'string' && !path.isAbsolute(row.path) && path.normalize(row.path) === row.path && !row.path.split('/').includes('..'));
  assert(!rows.has(row.path));
  assert(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= 16 * 1048576);
  assert(/^[a-f0-9]{64}$/.test(row.sha256));
  const filename = path.join(manifest.root, row.path);
  let directory = path.dirname(filename);
  while (directory.startsWith(manifest.root)) {
    assert(fs.lstatSync(directory).isDirectory(), directory);
    if (directory === manifest.root) break;
    directory = path.dirname(directory);
  }
  const bytes = bounded(filename);
  assert.equal(bytes.length, row.bytes, row.path);
  assert.equal(fs.lstatSync(filename).mode & 511, row.mode, row.path);
  assert.equal(hash(bytes), row.sha256, row.path);
  rows.set(row.path, row);
  total += row.bytes;
}
assert.equal(rows.size, 375);
assert.equal(total, 24291650);
assert.equal(total, manifest.bytes);
const read = name => {
  const relative = path.isAbsolute(name) ? path.relative(manifest.root, name) : name;
  const row = rows.get(relative);
  assert(row, 'not in authenticated capture manifest: ' + name);
  const bytes = bounded(path.join(manifest.root, relative));
  assert.equal(bytes.length, row.bytes);
  assert.equal(hash(bytes), row.sha256);
  return bytes;
};
const json = name => JSON.parse(read(name));
const summary = (value, depth = 0) => {
  if (Array.isArray(value)) return { array: value.length, first: depth < 2 ? value.slice(0, 2).map(entry => summary(entry, depth + 1)) : undefined };
  if (value && typeof value === 'object') return depth < 2 ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, summary(entry, depth + 1)])) : { keys: Object.keys(value) };
  return typeof value === 'string' && value.length > 500 ? value.slice(0, 500) + '…' : value;
};
const resultPath = stop.rawReceipts.find(row => path.basename(row.path) === 'RESULT.json').path;
const result = json(resultPath);
const authenticated = Object.freeze({ at: new Date().toISOString(), files: rows.size, bytes: total, root: manifest.root, inputHashes: inputs.inputs.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })), manifestRows: manifest.rows });
fs.writeFileSync(owned + '/AUTHENTICATED.json', JSON.stringify(authenticated, null, 2) + '\n', { flag: 'wx' });
log({ phase: 'authenticated', files: rows.size, bytes: total, result: summary(result), nonCasePaths: [...rows.keys()].filter(name => !name.startsWith('case-')) });
const commands = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const command of commands) {
  try {
    const [action, name, selector = '', mode = 'summary'] = command.trim().split(' ');
    if (action === 'inspect') {
      if (mode === 'text') log({ name, text: read(name).toString().slice(0, 16000) });
      else {
        let value = json(name);
        if (selector !== '-') for (const key of selector.split('.').filter(Boolean)) value = value[key];
        log({ name, selector, value: mode === 'full' ? value : summary(value) });
      }
    } else if (action === 'verify') {
      const { verify } = await import('./verify.mjs');
      await verify({ owned, inputs, manifest, stop, matrix, rows, read, json, bounded, hash, result, authenticated, log });
      commands.close();
      break;
    } else throw new Error('Only inspect or verify is supported');
  } catch (reason) { log({ phase: 'audit-command-failure', command, reason: String(reason), stack: reason?.stack }); }
}
