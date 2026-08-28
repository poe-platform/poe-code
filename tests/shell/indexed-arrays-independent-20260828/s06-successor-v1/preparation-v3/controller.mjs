import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { supervise } from '../../executor-v1/supervisor.mjs';
import { census, digest } from '../../candidate-v1/boundary-app.mjs';
import { put } from './staging.mjs';

export function controller(root, policy, tools, onIntegrity) {
  const started = performance.now(), children = [], failures = [], storage = [], records = [];
  let active = 0, captured = 0, gitBytes = 0, gitChildren = 0, otherChildren = 0, productWorkers = 0, persisted = 0;
  const remaining = () => policy.totalElapsedMsIncludingCleanup - (performance.now() - started);
  const snapshot = () => ({ elapsedMs: performance.now() - started, active, captured, gitBytes, gitChildren, otherChildren, productWorkers, persisted, failures: [...failures], records: [...records] });
  const checkpoint = () => {
    assert.ok(remaining() > policy.reservedCleanupMs, 'total elapsed admission deadline');
    let total = 0;
    for (const role of storage) {
      const bytes = Object.values(census(role.root)).reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
      assert.ok(bytes <= role.maxBytes, `${role.name} storage ceiling`); total += bytes;
    }
    assert.ok(total <= policy.maxWorkingBytes, 'total working storage ceiling');
  };
  function record(name, value) {
    assert.match(name, /^[a-zA-Z0-9_-]+$/u);
    const bytes = Buffer.from(JSON.stringify(value) + '\n'); assert.ok(bytes.length <= policy.maxRecordBytes);
    persisted += bytes.length; assert.ok(persisted <= policy.maxPersistedEvidenceBytes);
    const filename = path.join(root, 'records', `${name}.json`); put(filename, bytes);
    records.push({ name, bytes: bytes.length, sha256: digest(bytes) }); return { path: filename, sha256: digest(bytes) };
  }
  async function child(role, executable, args, options) {
    checkpoint(); onIntegrity(); assert.equal(active, 0, 'serial children only');
    const isGit = role === 'git', isProduct = role === 'product';
    if (isGit) assert.ok(++gitChildren <= policy.maxGitChildren);
    else assert.ok(++otherChildren <= policy.maxOtherSupervisedChildren);
    if (isProduct) assert.ok(++productWorkers <= policy.maxProductWorkers);
    assert.ok(gitChildren + otherChildren <= policy.maxGitChildren + policy.maxOtherSupervisedChildren);
    assert.ok(options.timeoutMs + 3000 < remaining() - policy.reservedCleanupMs);
    assert.equal(executable, isGit ? tools.git.path : tools.node.path);
    const allowed = isGit ? policy.maxGitCaptureBytes : isProduct ? policy.maxRuntimeWorkerCaptureBytes : role === 'type' ? policy.maxTypeWorkerCaptureBytes : policy.maxToolCaptureBytes;
    const room = Math.min(allowed, policy.maxTotalCapturedChildBytes - captured, isGit ? policy.maxTotalGitBytes - gitBytes : Infinity);
    assert.ok(room > 0); active++;
    let run;
    try { run = await supervise(executable, args, { ...options, maxBytes: Math.min(options.maxBytes ?? allowed, room) }); }
    finally { active--; }
    captured += run.bytes; if (isGit) gitBytes += run.bytes;
    const receipt = record(`child-${String(children.length + 1).padStart(3, '0')}`, { role, ...run }); children.push({ role, receipt, run });
    assert.ok(run.closeObserved && run.groupAbsent && !run.fault && !run.spawnError && !run.signal, 'unsafe child lifecycle; stop dependents');
    onIntegrity(); checkpoint(); return run;
  }
  return { child, record, checkpoint, snapshot, failures, children,
    registerStorage(name, directory, maxBytes) { assert.ok(!storage.some(entry => directory.startsWith(entry.root + '/') || entry.root.startsWith(directory + '/') || directory === entry.root)); storage.push({ name, root: directory, maxBytes }); },
    ordinary(label, accepted) { if (!accepted) failures.push(label); },
    finish() { assert.equal(active, 0); assert.ok(remaining() > 0); return snapshot(); },
    cleanupReady() { assert.equal(active, 0); assert.ok(children.every(child => child.run.closeObserved && child.run.groupAbsent)); return remaining(); }
  };
}
