import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const own = path.dirname(fileURLToPath(import.meta.url));
const relative = path.relative(process.cwd(), own);
const captures = '/tmp/b2-r7-independent-20260829-startup';
const fixture = '/private/tmp/b2-r7-independent-harmless-20260829';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function inventory(root) {
  const rows = [];
  function walk(directory) { for (const name of fs.readdirSync(directory)) { const absolute = path.join(directory, name); const stat = fs.lstatSync(absolute); assert.ok(!stat.isSymbolicLink()); if (stat.isDirectory()) walk(absolute); else { assert.ok(stat.isFile() && stat.size <= 1048576); const bytes = fs.readFileSync(absolute); rows.push({ path: path.relative(root, absolute), bytes: bytes.length, sha256: hash(bytes) }); } } }
  walk(root); rows.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))); return rows;
}
for (const [root, prefix] of [[captures, 'raw'], [fixture, 'harmless']]) {
  for (const row of inventory(root)) {
    if (row.path.startsWith('publication.')) continue;
    const target = path.join(own, prefix, row.path); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fs.readFileSync(path.join(root, row.path)), { flag: 'wx', mode: 0o600 });
  }
}
const result = JSON.parse(fs.readFileSync(path.join(fixture, 'RESULT.json')));
assert.equal(result.status, 'PASS'); assert.equal(result.controls.length, 14); assert.equal(result.children.length, 2);
const snapshot = inventory(own);
const bytes = snapshot.reduce((sum, row) => sum + row.bytes, 0);
assert.ok(bytes < 192 * 1024 * 1024);
const receipt = { utc: new Date().toISOString(), verdict: 'SCOPED_PREEXEC_ACCEPT', controls: 14, harmlessConsumers: 2, productCalls: 0, loaderAdmissions: 2, individualLoaderExits: 'UNOBSERVED', nativeThreads: 'UNOBSERVED', knownOsConservativePublicationInclusive: 29, maximum: 32, peak: 3, snapshot: { domain: 'own relative UTF8 paths, Buffer.compare ordering; excludes this self-referential receipt and ongoing external publication captures', files: snapshot.length, bytes, sha256: hash(Buffer.from(JSON.stringify(snapshot))), rows: snapshot }, futureAuthority: 'PENDING_NEW_BINDING_AND_ROOT_GO_NO_WINDOW' };
fs.writeFileSync(path.join(own, 'PUBLICATION.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
for (const args of [['add', '--', relative], ['commit', '--only', '-m', 'test: qualify B2 r7 loader trace delta independently', '--', relative], ['status', '--porcelain', '--', relative], ['rev-parse', 'HEAD']]) {
  const result = spawnSync('/usr/bin/git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], { stdio: ['ignore', 1, 2] });
  assert.equal(result.status, 0);
}
console.log(JSON.stringify({ utc: new Date().toISOString(), receiptSha256: hash(fs.readFileSync(path.join(own, 'PUBLICATION.json'))), scopedVerdict: receipt.verdict, files: snapshot.length, bytes, knownOsConservative: 29, activeChildren: 0 }));
