import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { digest, inventory, owned, policy } from './common.mjs';

const evidence = join(owned, process.argv[2] ?? 'evidence-v1');
const manifest = JSON.parse(readFileSync(join(evidence, 'MANIFEST.json'))), archive = readFileSync(join(evidence, 'RAW.json.gz'));
assert.equal(manifest.candidate, policy.candidate); assert.equal(digest(archive), manifest.archiveSha256); assert.equal(archive.length, manifest.archiveBytes);
const raw = gunzipSync(archive); assert.equal(digest(raw), manifest.rawSha256); assert.equal(raw.length, manifest.rawBytes);
const entries = JSON.parse(raw).entries;
assert.equal(entries.length, manifest.entries.length);
const directory = mkdtempSync('/private/tmp/native-data-tap-independent-');
try {
  const decoded = new Map();
  for (const [index, entry] of entries.entries()) {
    const { base64, ...metadata } = entry, bytes = Buffer.from(base64, 'base64');
    assert.deepEqual(metadata, manifest.entries[index]); assert.equal(digest(bytes), entry.sha256); assert.equal(bytes.length, entry.bytes);
    assert.match(entry.name, /^[a-zA-Z0-9.-]+$/u); assert.equal(decoded.has(entry.name), false); decoded.set(entry.name, bytes);
    if (entry.name !== 'AUDIT.json') writeFileSync(join(directory, entry.name), bytes, { flag: 'wx' });
  }
  for (const entry of manifest.harnessFiles) assert.equal(digest(readFileSync(join(owned, entry.path))), entry.sha256);
  const before = inventory(evidence);
  const output = execFileSync(process.execPath, [join(owned, 'audit.mjs'), directory], { encoding: 'utf8', timeout: 30000, maxBuffer: 1048576 });
  const newAudit = JSON.parse(readFileSync(join(directory, 'AUDIT.json'))), originalAudit = JSON.parse(decoded.get('AUDIT.json'));
  const { auditedAt: newTime, ...newContent } = newAudit, { auditedAt: oldTime, ...oldContent } = originalAudit;
  assert.deepEqual(newContent, oldContent);
  assert.deepEqual(inventory(evidence), before);
  for (const entry of inventory(owned)) { assert.doesNotMatch(entry.path, /(?:^|\/)AGENTS\.md$|\.(?:[cm]?ts|tsx)$|\.test\./u); assert.notEqual(entry.kind, 'link'); }
  const cleanup = JSON.parse(readFileSync(join(evidence, 'CLEANUP.json'))); assert.equal(cleanup.removed, true); assert.equal(cleanup.killTimeoutOutputLeakCount, 0);
  console.log(JSON.stringify({ sealedArchive: 'verified', candidate: policy.candidate, rawEntries: entries.length, audit: JSON.parse(output), fixtureExecutions: 0, canonicalDiscoveryAdditions: 0 }));
} finally { rmSync(directory, { recursive: true }); }
