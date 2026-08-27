import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const owned = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(owned, '../../../..');
export const historical = resolve(owned, '../cleanup-boundary-review');
export const packageRoot = resolve(historical, '.temporary/runtime-r1-verified-packed-old-five/production-continuation-review/node_modules/virtual-bash');
export const snapshotRoot = resolve(historical, '.temporary/runtime-r1-verified');
export const sourceCommit = '1b133a8662a32ee84524794842074c9c98d5f6c3';
export const jobs = ['grep-default', 'rg-default', 'grep-abort', 'rg-abort', 'grep-queued-abort', 'rg-queued-abort'];
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
export const json = async path => JSON.parse(await readFile(path));
export const identity = async path => ({ path, sha256: hash(await readFile(path)) });
export async function verifyPackage() {
  const freezePath = resolve(historical, 'evidence/runtime-r1-verified-freeze.json');
  const buildPath = resolve(historical, 'evidence/runtime-r1-verified-build.json');
  const freeze = await json(freezePath);
  const build = await json(buildPath);
  assert.equal(freeze.commit, sourceCommit);
  assert.equal(build.status, 0);
  assert.equal(freeze.identities.length, 216);
  assert.equal(build.emitted.length, 704);
  assert.equal(await realpath(packageRoot), packageRoot);
  for (const record of freeze.identities) {
    assert.equal(hash(git('show', `${record.commit}:${record.path}`)), record.sha256, record.path);
    assert.equal(hash(await readFile(resolve(snapshotRoot, record.path))), record.sha256, record.path);
  }
  for (const record of build.emitted) {
    assert.equal(hash(await readFile(resolve(snapshotRoot, record.path))), record.sha256, record.path);
    assert.equal(hash(await readFile(resolve(packageRoot, record.path))), record.sha256, record.path);
  }
  assert.equal(hash(await readFile(resolve(packageRoot, 'package.json'))), freeze.identities.find(record => record.path === 'package.json').sha256);
  const archivePath = resolve(packageRoot, '../../virtual-bash-0.0.0.tgz');
  const archive = await identity(archivePath);
  assert.equal(archive.sha256, '86c34e382c85563afbd9c760aa2e0f161308e8f43e14fe99dfec9ed96d77539b');
  return { sourceCommit, sourceCount: 216, emittedCount: 704, packageRoot, snapshotRoot, archive, freeze: await identity(freezePath), build: await identity(buildPath), assets: await Promise.all(['dist/index.js', 'dist/commands/regex-execution/worker.js', 'dist/commands/regex-execution/protocol.js', 'dist/commands/regex-execution/client.js'].map(path => identity(resolve(packageRoot, path)))) };
}
export async function verifyPrepared() {
  const prepared = await json(resolve(owned, 'evidence/prepared.json'));
  for (const record of prepared.files) assert.equal(hash(await readFile(resolve(owned, record.path))), record.sha256, record.path);
  assert.deepEqual(await verifyPackage(), prepared.package);
  return prepared;
}
