import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scripts } from './corpus.mjs';
import { owned, relative, hash, git, inventory, committedTree, save, verifyFreeze, verifyPhase1 } from './lib.mjs';

const phase1 = verifyPhase1();
const freeze = verifyFreeze();
const manifest = JSON.parse(fs.readFileSync(path.join(owned, 'freeze-manifest.json')));
assert.deepEqual(scripts.map(entry => ({ id: entry.id, productBytes: Buffer.byteLength(entry.productScript), productSHA256: hash(Buffer.from(entry.productScript)), completeControlSHA256: hash(Buffer.from(JSON.stringify(entry))) })), manifest.scripts);
const invariants = JSON.parse(fs.readFileSync(path.join(owned, 'invariants.json')));
assert.deepEqual(invariants.controls.map(entry => ({ id: entry.id, sha256: hash(Buffer.from(JSON.stringify(entry))) })), manifest.invariants);
if (fs.existsSync(path.join(owned, 'capture-01/manifest.json'))) {
  const actual = inventory(path.join(owned, 'capture-01'), new Set(['manifest.json']));
  assert.deepEqual(actual, JSON.parse(fs.readFileSync(path.join(owned, 'capture-01/manifest.json'))), 'capture bytes and exact membership');
  for (const profile of ['bash53', 'bash32']) {
    const record = JSON.parse(fs.readFileSync(path.join(owned, `capture-01/${profile}.json`)));
    assert.deepEqual(record.results.map(entry => entry.id), scripts.map(entry => entry.id));
    for (const result of record.results) {
      assert(Buffer.from(result.execution.stdoutBase64, 'base64').equals(Buffer.from(result.execution.stdout)));
      assert(Buffer.from(result.execution.stderrBase64, 'base64').equals(Buffer.from(result.execution.stderr)));
      assert.equal(result.execution.closeAwaited, true);
    }
  }
}
if (process.argv.includes('--seal')) save('evidence-manifest.json', { format: 'stage2-complete-sidecar-inventory-v1', sealedAt: new Date().toISOString(), freeze, phase1, entries: inventory(owned, new Set(['evidence-manifest.json'])) });
if (fs.existsSync(path.join(owned, 'evidence-manifest.json'))) assert.deepEqual(inventory(owned, new Set(['evidence-manifest.json'])), JSON.parse(fs.readFileSync(path.join(owned, 'evidence-manifest.json'))).entries, 'sidecar membership, including new entries');
let committedFiles = null;
if (process.argv.includes('--committed')) {
  const commit = git('log', '-1', '--format=%H', '--', `${relative}/evidence-manifest.json`).toString().trim();
  assert(commit, 'evidence commit required');
  committedFiles = committedTree(commit, owned, inventory(owned));
}
console.log(JSON.stringify({ integrity: 'pass', phase1, freeze, sidecarSealPresent: fs.existsSync(path.join(owned, 'evidence-manifest.json')), committedFiles, candidateOrNativeExecution: false, originalVerifierRun: false, originalVerifierBoundary: 'unchanged old exact-parent-tree verifier would reject authorized stage2 append; this verifier excludes ONLY stage2 from old membership and checks sidecar separately' }));
