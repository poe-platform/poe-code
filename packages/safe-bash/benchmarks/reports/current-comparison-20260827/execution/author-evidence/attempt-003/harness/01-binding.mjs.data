import assert from 'node:assert/strict';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contained, hash, jsonBytes, readBound } from './io.mjs';
import { preparationCommit, sealHashes } from './cohorts.mjs';

export const executionRoot = fileURLToPath(new URL('.', import.meta.url));
const digest = /^[a-f0-9]{64}$/u;
export function artifact(record, collect = true) {
  assert.ok(record && isAbsolute(record.root) && typeof record.path === 'string');
  assert.ok(digest.test(record.sha256) && Number.isSafeInteger(record.bytes) && record.bytes >= 0);
  return readBound(record.root, record.path, record, 256 * 1024 * 1024, collect);
}
export function verifyClosure(closure, exact = true) {
  assert.ok(closure && isAbsolute(closure.root) && Array.isArray(closure.files) && closure.files.length > 0 && closure.files.length <= 8192);
  const root = realpathSync(closure.root), known = new Map();
  let total = 0;
  for (const record of closure.files) {
    assert.ok(!isAbsolute(record.path) && digest.test(record.sha256) && Number.isSafeInteger(record.bytes));
    total += record.bytes;
    assert.ok(total <= 1024 * 1024 * 1024, 'closure aggregate cap');
    const actual = readBound(root, record.path, record, undefined, false);
    assert.ok(!known.has(actual.path), 'aliased closure member');
    known.set(actual.path, { bytes: actual.bytes, sha256: actual.sha256 });
  }
  if (exact) {
    let count = 0;
    function visit(directory, depth) {
      assert.ok(depth <= 32 && ++count <= 16384, 'closure membership cap');
      for (const name of readdirSync(directory).sort()) {
        const filename = join(directory, name), stat = lstatSync(filename);
        assert.ok(!stat.isSymbolicLink(), 'closure links forbidden');
        if (stat.isDirectory()) visit(filename, depth + 1);
        else assert.ok(stat.isFile() && known.has(filename), 'unlisted closure member');
      }
    }
    visit(root, 0);
  }
  return { root, files: Object.fromEntries(known), bytes: total };
}
export function loadBinding(bindingPath, receiptPath, receiptSha256) {
  if (!bindingPath || !receiptPath || !receiptSha256) return { status: 'WAITING_ROOT', reason: 'Exact candidate/package binding and ROOT execution receipt/hash not supplied', productImports: 0 };
  assert.ok(digest.test(receiptSha256));
  const bindingBytes = readBound(dirname(bindingPath), bindingPath, undefined, 4 * 1024 * 1024).data;
  const receiptBytes = readBound(dirname(receiptPath), receiptPath, { sha256: receiptSha256 }, 65536).data;
  const binding = jsonBytes(bindingBytes), receipt = jsonBytes(receiptBytes);
  assert.equal(binding.schema, 'safe-bash.execution-binding.v1');
  assert.equal(receipt.authority, 'ROOT');
  assert.equal(receipt.purpose, 'MEASURE_HISTORICAL');
  assert.equal(receipt.bindingSha256, hash(bindingBytes));
  assert.equal(receipt.executionAuthorized, true);
  assert.equal(receipt.timingAuthorized, false);
  assert.equal(binding.preparationCommit, preparationCommit);
  assert.deepEqual(binding.seals, sealHashes);
  assert.deepEqual(binding.profiles, ['original', 'aligned', 'breadth']);
  assert.ok(/^[a-f0-9]{40}$/u.test(binding.candidate?.commit));
  assert.ok(/^[a-f0-9]{40,64}$/u.test(binding.candidate.gitTree));
  for (const field of ['sourceSha256', 'packSha256']) assert.ok(digest.test(binding.candidate[field]));
  assert.equal(binding.candidate.source.sha256, binding.candidate.sourceSha256);
  assert.equal(binding.candidate.pack.sha256, binding.candidate.packSha256);
  artifact(binding.candidate.source, false); artifact(binding.candidate.pack, false);
  assert.equal(receipt.candidateCommit, binding.candidate.commit);
  assert.equal(receipt.qualificationAccepted, true);
  const node = artifact(binding.node, false);
  const runner = verifyClosure(binding.runner, false);
  assert.equal(runner.root, realpathSync(executionRoot));
  const requiredRunner = ['run.mjs', 'binding.mjs', 'cohorts.mjs', 'io.mjs', 'limits.mjs', 'supervise.mjs', 'session.mjs', 'engine-child.mjs', 'expanded.mjs', 'breadth.mjs', 'network.mjs', 'observe-load.mjs', 'assessment.mjs', 'reuse/expanded-common.mjs', 'reuse/breadth-assess.mjs'];
  for (const name of requiredRunner) assert.ok(runner.files[join(runner.root, name)], `runner member missing: ${name}`);
  const engines = {};
  assert.deepEqual(Object.keys(binding.engines).sort(), ['just-bash', 'virtual-bash']);
  for (const name of ['virtual-bash', 'just-bash']) {
    const selected = binding.engines[name], closure = verifyClosure(selected.closure);
    assert.ok(Number.isSafeInteger(selected.heapMiB) && selected.heapMiB > 0);
    const packagePath = contained(closure.root, selected.packageJson);
    assert.ok(closure.files[packagePath], 'unbound package metadata');
    const pkg = jsonBytes(readBound(closure.root, selected.packageJson, closure.files[packagePath]).data);
    assert.equal(pkg.name, name); assert.ok(pkg.exports, 'root public export required');
    const entry = contained(closure.root, selected.entry);
    assert.ok(closure.files[entry], 'unbound entry');
    assert.ok(Array.isArray(selected.assets) && Array.isArray(selected.locks) && selected.locks.length > 0);
    for (const asset of [...selected.assets, ...selected.locks]) assert.ok(closure.files[contained(closure.root, asset)], 'unbound asset/lock');
    if (name === 'just-bash') {
      assert.equal(pkg.version, '3.4.2');
      assert.equal(closure.files[entry].sha256, '70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c');
      assert.equal(binding.baselineTar.sha256, 'f3a90ecffb1150e786201d9bd408ae30bcc1f64f3b10b7de22353f7e1373841d');
      artifact(binding.baselineTar, false);
    }
    engines[name] = { ...selected, closure, packagePath, entry, packageName: pkg.name, version: pkg.version };
  }
  const host = binding.host;
  assert.ok(host && Object.keys(host.env).every(key => ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'USER'].includes(key)), 'host env allowlist');
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ']) assert.equal(typeof host.env[key], 'string');
  assert.equal(host.env.LANG, 'C'); assert.equal(host.env.LC_ALL, 'C'); assert.equal(host.env.TZ, 'UTC');
  for (const directory of [host.cwd, host.env.HOME, host.env.TMPDIR]) assert.ok(lstatSync(contained(host.root, directory)).isDirectory());
  return { status: 'BOUND_NOT_MEASURED', binding, receipt, bindingSha256: hash(bindingBytes), receiptSha256, node, runner, engines, host, productImports: 0 };
}
