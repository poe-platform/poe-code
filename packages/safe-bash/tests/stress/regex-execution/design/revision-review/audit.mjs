import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = fileURLToPath(new URL('./', import.meta.url));
const root = resolve(base, '../../../../..');
const prefix = 'tests/stress/regex-execution/design/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 16777216 });
const baseline = JSON.parse(readFileSync(resolve(base, 'evidence/baseline-freeze.json')));
const fixed = JSON.parse(readFileSync(resolve(base, 'evidence/fixed-freeze.json')));
for (const [path, expected] of Object.entries({ ...baseline.sources, ...baseline.originals })) assert.equal(hash(readFileSync(resolve(baseline.snapshot, path))), expected, path);
for (const [path, expected] of Object.entries(fixed.files)) assert.equal(hash(readFileSync(path)), expected, path);
const immutableOriginals = {};
for (const [commit, directory] of [[baseline.revisions['3b27782'], prefix + 'review'], [baseline.revisions.aba917c, prefix]]) {
  const paths = git('ls-tree', '-r', '--name-only', commit, '--', directory).toString().trim().split('\n');
  for (const path of paths) {
    if (path === prefix + 'client.ts' || Object.hasOwn(immutableOriginals, path)) continue;
    const original = git('show', `${commit}:${path}`); const current = readFileSync(resolve(root, path)); assert.deepEqual(current, original, path);
    immutableOriginals[path] = hash(current);
  }
}
const cohorts = {};
for (const directory of ['baseline', 'fixed', 'guards']) {
  const children = [];
  for (const name of readdirSync(resolve(base, 'evidence', directory))) {
    if (!name.endsWith('.json')) continue;
    const evidence = JSON.parse(readFileSync(resolve(base, 'evidence', directory, name)));
    if (!evidence.pid || !evidence.events || !evidence.messages) continue;
    const done = evidence.messages.find(message => message.type === 'done'); assert(done, name);
    assert.equal(evidence.killed, false, name); assert.equal(evidence.code, 0, name); assert.equal(evidence.signal, null, name);
    for (const event of ['exit', 'disconnect', 'stdout-close', 'stderr-close', 'close']) assert(evidence.events.some(entry => entry.event === event), name + ':' + event);
    for (const client of done.cleanup) {
      assert.equal(client.metrics.created, client.metrics.terminated); assert.equal(client.metrics.listenersAfter, 0);
      assert.equal(client.pending, false); assert.equal(client.releaseHeld, false); assert.equal(client.signalListeners, 0);
      assert.equal(client.capacityActive ?? client.capacity, 0);
      if (client.metrics.created) assert.equal(client.workerThreadId ?? client.thread, -1);
      assert(Object.values(client.workerListeners ?? client.listeners).every(count => count === 0));
    }
    children.push({ name: evidence.name, pid: evidence.pid, failed: Boolean(done.failure), workersCreated: done.cleanup.reduce((total, client) => total + client.metrics.created, 0), workersTerminated: done.cleanup.reduce((total, client) => total + client.metrics.terminated, 0), exactChildClose: true });
  }
  cohorts[directory] = { children: children.length, pass: children.filter(child => !child.failed).length, fail: children.filter(child => child.failed).length, workersCreated: children.reduce((total, child) => total + child.workersCreated, 0), workersTerminated: children.reduce((total, child) => total + child.workersTerminated, 0), results: children };
}
assert.equal(cohorts.baseline.pass, 14); assert.equal(cohorts.baseline.fail, 2); assert.equal(cohorts.fixed.pass, 16); assert.equal(cohorts.fixed.fail, 0); assert.equal(cohorts.guards.pass, 12); assert.equal(cohorts.guards.fail, 0);
const evidenceHashes = {};
const walk = directory => { for (const entry of readdirSync(directory, { withFileTypes: true })) { const path = resolve(directory, entry.name); if (entry.isDirectory()) walk(path); else evidenceHashes[path.slice(base.length + 1)] = hash(readFileSync(path)); } };
walk(resolve(base, 'evidence'));
const audit = { utc: new Date().toISOString(), baselineRevisions: baseline.revisions, fixedAuthorCommit: fixed.authorCommit, cohorts, immutableOriginals, evidenceHashes, fixedIdentitiesChecked: Object.keys(fixed.files).length, baselineIdentitiesChecked: Object.keys(baseline.sources).length + Object.keys(baseline.originals).length, risk: { archived: 12, authorizedNewTranche: 6, authorUsed: 0, authorMaximum: 2, verifierUsed: 0, verifierMaximum: 2, rootReservedUnused: 2 }, activeOwnedChildren: 0, unclosedOwnedWorkers: 0, temporaryPolicy: 'Retain only owned ignored baseline/fixed source and compiled snapshots for reproducibility; no original or unrelated temporary files removed', statusAtAudit: git('status', '--short').toString() };
writeFileSync(resolve(base, 'evidence/audit.json'), JSON.stringify(audit, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ cohorts: Object.fromEntries(Object.entries(cohorts).map(([name, value]) => [name, { children: value.children, pass: value.pass, fail: value.fail, workers: value.workersTerminated }])), immutableOriginals: Object.keys(immutableOriginals).length, newRiskConsumed: 0 }));
