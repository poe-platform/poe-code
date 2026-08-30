import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { differential, host } from './cases.mjs';
const own = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(own, '../../..');
const root = JSON.parse(fs.readFileSync(path.join(own, 'CAPTURE.json'))).root;
const logPath = path.join(root, 'publication.json');
const log = { started: new Date().toISOString(), role: 'SOURCE_DATA_PUBLICATION', product: 0, native: 0, children: [] };
const save = () => fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
save();
try {
  const start = JSON.parse(fs.readFileSync(path.join(root, 'START.json')));
  assert.ok(Date.now() - Date.parse(start.started) < 25 * 60000);
  const binding = JSON.parse(fs.readFileSync(path.join(root, 'BINDING.json')));
  const additional = JSON.parse(fs.readFileSync(path.join(root, 'ADDITIONAL.json')));
  binding.selected.push(...additional.selected); binding.children.push(...additional.children);
  assert.equal(binding.selected.length, 38); assert.equal(new Set(binding.selected.map(row => row.path)).size, 38);
  for (const row of binding.selected) assert.equal(sha(fs.readFileSync(path.join(root, row.path + '.data'))), row.sha256);
  assert.equal(differential.length, 40); assert.equal(host.length, 10);
  assert.equal(new Set([...differential, ...host].map(row => row.id)).size, 50);
  assert.ok(differential.every(row => row.nativeExpected === null && row.productExpected === null && row.result === 'UNRUN'));
  const original = 'tests/compatibility/bash-surface-20260829';
  const result = spawnSync('/usr/bin/git', ['diff', '--name-only', '-z', '--', original], { cwd: repo, env: { PATH: '/usr/bin:/bin', GIT_OPTIONAL_LOCKS: '0' }, timeout: 10000, maxBuffer: 1024 * 1024 });
  fs.writeFileSync(path.join(root, 'original-surface-diff.stdout'), result.stdout ?? '', { flag: 'wx' });
  fs.writeFileSync(path.join(root, 'original-surface-diff.stderr'), result.stderr ?? '', { flag: 'wx' });
  log.children.push({ argv: ['git', 'diff', '--name-only', '-z', '--', original], status: result.status, signal: result.signal }); save();
  assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.error, undefined); assert.equal(result.stdout.length, 0);
  const entries = [];
  function inventory(directory, relative = '') {
    for (const name of fs.readdirSync(directory).sort()) {
      assert.notEqual(name.toLowerCase(), 'agents.md');
      const absolute = path.join(directory, name), member = path.posix.join(relative, name), stat = fs.lstatSync(absolute);
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) inventory(absolute, member);
      else { assert.ok(stat.isFile() && stat.size <= 8 * 1024 * 1024); const bytes = fs.readFileSync(absolute); entries.push({ path: member, bytes: bytes.length, sha256: sha(bytes), base64: bytes.toString('base64') }); }
    }
  }
  log.completed = new Date().toISOString(); log.elapsedMs = Date.now() - Date.parse(start.started); save(); inventory(root);
  const rawBytes = entries.reduce((total, row) => total + row.bytes, 0); assert.ok(rawBytes < 64 * 1024 * 1024);
  const capsule = gzipSync(Buffer.from(JSON.stringify({ role: 'SOURCE_DATA_ONLY', entries }))); assert.ok(capsule.length < 8 * 1024 * 1024);
  for (const [name, bytes] of [
    ['BINDING.json', JSON.stringify(binding, null, 2)],
    ['CASES.json', JSON.stringify({ differential, host }, null, 2)],
    ['SOURCE-DATA.json.gz', capsule],
    ['PREPARATION.json', JSON.stringify({ ...log, dataEntries: entries.length, capturedBytes: rawBytes, capsuleSha256: sha(capsule), sourceBlobs: binding.selected.length, sourceGitChildren: binding.children.length, newPublicationGitChildren: log.children.length, allNativeProductBuildWorkerEngineExecutions: 0, preparationProcessCap: 48, peakAdmittedIncludingToolShell: 3, processAccounting: 'Tool launches plus five synchronous development Git children; no product children, background sessions or workers. Direct context instruction reads excluded from evidence.', differentialUnrun: 40, hostProtocolsUnrun: 10, existingSurfaceWorkingDiffBytes: 0 }, null, 2)],
  ]) fs.writeFileSync(path.join(own, name), bytes, { flag: 'wx' });
  console.log(JSON.stringify({ elapsedMs: log.elapsedMs, entries: entries.length, rawBytes, capsuleBytes: capsule.length, sourceBlobs: binding.selected.length, differential: differential.length, host: host.length, product: 0 }));
} catch (error) { log.error = { message: String(error), stack: error?.stack }; save(); throw error; }
