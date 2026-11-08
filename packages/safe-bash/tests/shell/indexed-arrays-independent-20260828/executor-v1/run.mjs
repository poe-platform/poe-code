import assert from 'node:assert/strict';
import { writeFileSync, lstatSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { admit, authenticate, digest, verifyTree } from './boundary.mjs';
import { supervise, classify } from './supervisor.mjs';

try {
  const [manifestPath, manifestSha256, goPath, goSha256, outputPath, cohort, idsJson] = process.argv.slice(2);
  assert.ok(outputPath && idsJson, 'explicit root authorization/manifest/output/cohort/IDs required');
  const bound = admit(manifestPath, manifestSha256, goPath, goSha256);
  const { manifest } = bound;
  if (manifest.layout === 'moved') {
    assert.ok(manifest.priorAppRoot && manifest.priorAppRoot !== manifest.harnessRoot);
    assert.throws(() => lstatSync(manifest.priorAppRoot), error => error.code === 'ENOENT', 'prior app really absent after physical move');
  }
  for (const entry of manifest.sourceProjection) {
    const committed = execFileSync('/usr/bin/git', ['show', `${entry.commit}:${entry.path}`], { cwd: manifest.repository, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(digest(committed), entry.sha256, 'immutable selected source, never working-tree fallback');
  }
  const ids = JSON.parse(idsJson); assert.ok(Array.isArray(ids) && ids.length > 0 && ids.length <= 64);
  authenticate(manifest.workerModule, bound.allowed.get(manifest.workerModule));
  const flags = ['--permission', ...manifest.trees.map(tree => `--allow-fs-read=${tree.root}`),
    ...[manifest.node.path, manifestPath, goPath, manifest.astTypes.receiptPath].map(path => `--allow-fs-read=${path}`)];
  const run = await supervise(manifest.node.path, [...flags, manifest.workerModule, manifestPath, manifestSha256, goPath, goSha256, cohort, idsJson], {
    cwd: manifest.harnessRoot, env: { PATH: dirname(manifest.node.path), LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: 30000, maxBytes: 1024 * 1024
  });
  const verdict = classify(run, ids, { loads: [manifest.rootModule, manifest.runtimeModule].map(path => ({ path, sha256: bound.allowed.get(path) })), ...(manifest.mutant ? { mutant: manifest.mutant } : {}) });
  let integrityError = null;
  try {
    for (const tree of manifest.trees) verifyTree(tree);
    authenticate(manifestPath, manifestSha256); authenticate(goPath, goSha256); authenticate(manifest.node.path, manifest.node.sha256);
  } catch (error) { integrityError = String(error); }
  const record = { kind: 'array-independent-candidate-run-v1', manifestSha256, goSha256, candidate: manifest.candidate,
    layout: manifest.layout, cohort, ids, run, verdict, integrityError,
    unsafeStop: !verdict.coherent || integrityError !== null, category: 'actual candidate execution only after root GO' };
  const capture = JSON.stringify(record, null, 2) + '\n';
  writeFileSync(outputPath, capture, { flag: 'wx' });
  console.log(JSON.stringify({ outputPath, sha256: digest(Buffer.from(capture)), accepted: verdict.accepted && !integrityError, unsafeStop: record.unsafeStop }));
  process.exitCode = record.unsafeStop ? 78 : verdict.accepted || verdict.mutantKilled ? 0 : 1;
} catch (error) { console.error(String(error?.stack ?? error)); process.exitCode = 78; }
