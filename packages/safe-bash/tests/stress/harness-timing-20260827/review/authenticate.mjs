import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { digest, root, save } from './tools.mjs';

const base = 'tests/stress/harness-timing-20260827/';
const path = base + 'evidence/author-manifest.json';
const bytes = readFileSync(root + path);
const manifest = JSON.parse(bytes);
assert.equal(digest(bytes), '4a2f7cca93a2aa81e5e4cde09f2c7d6ebac779d630a2e7017921177112ae03fd');
const evidenceCommit = '0619e1c47ecffb9913f35d5ad86c177e74ab67f7';
assert.deepEqual(bytes, execFileSync('git', ['show', `${evidenceCommit}:${path}`], { cwd: root }));
const verified = [];
for (const [kind, records] of [['implementation', manifest.code], ['artifact', manifest.artifacts], ['report', { [manifest.report.path]: manifest.report.sha256 }]]) {
  for (const [path, sha256] of Object.entries(records)) {
    const current = readFileSync(root + path);
    assert.equal(digest(current), sha256, path);
    const commit = kind === 'implementation' ? manifest.implementation : evidenceCommit;
    assert.deepEqual(current, execFileSync('git', ['show', `${commit}:${path}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 }), path);
    verified.push({ kind, path, sha256, commit });
  }
}
save('evidence/author-authentication.json', { implementation: manifest.implementation, evidenceCommit, manifestSha256: digest(bytes), verified });
console.log(JSON.stringify({ verified: verified.length, implementationFiles: Object.keys(manifest.code).length, artifacts: Object.keys(manifest.artifacts).length, report: manifest.report }));
