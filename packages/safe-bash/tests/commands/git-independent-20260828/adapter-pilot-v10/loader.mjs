import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync, lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let binding, members, traceBytes = 0;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const record = row => {
  const line = JSON.stringify(row) + '\n';
  traceBytes += Buffer.byteLength(line);
  assert.ok(traceBytes <= 2 * 1024 * 1024, 'loaded-module trace cap');
  appendFileSync(binding.trace, line);
};
export function initialize(data) {
  binding = data;
  members = new Map(data.files.map(row => [row.path, row]));
  assert.equal(members.size, data.files.length);
  assert.equal(hash(readFileSync(fileURLToPath(import.meta.url))), data.loaderSha256);
  record({ kind: 'loader-initialized', url: import.meta.url, sha256: data.loaderSha256, manifestSha256: data.manifestSha256 });
}
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('node:')) {
    assert.ok(binding.allowedBuiltins.includes(specifier), 'unsealed builtin: ' + specifier);
    return next(specifier, context);
  }
  assert.ok(specifier.startsWith('.') || specifier.startsWith('file:'), 'bare/network specifier refused');
  const target = new URL(specifier, context.parentURL);
  assert.equal(target.protocol, 'file:'); assert.equal(target.search, ''); assert.equal(target.hash, '');
  assert.ok(members.has(fileURLToPath(target)), 'unsealed import: ' + target.href);
  return { url: target.href, shortCircuit: true };
}
export async function load(url, context, next) {
  if (url.startsWith('node:')) {
    assert.ok(binding.allowedBuiltins.includes(url));
    record({ kind: 'builtin-load', url });
    return next(url, context);
  }
  assert.ok(url.startsWith('file:'));
  const file = fileURLToPath(url), row = members.get(file);
  assert.ok(row, 'unknown load');
  assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink());
  assert.equal(realpathSync(file), file);
  const bytes = readFileSync(file);
  assert.equal(hash(bytes), row.sha256, 'loaded-byte identity');
  record({ kind: 'module-load', url, sha256: hash(bytes), bytes: bytes.length, role: row.role });
  return { format: 'module', source: bytes, shortCircuit: true };
}
