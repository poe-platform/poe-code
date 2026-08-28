import assert from 'node:assert/strict';
import path from 'node:path';
import { census, digest } from '../../candidate-v1/boundary-app.mjs';
import { put } from '../preparation-v3/staging.mjs';
import { ownership, retired, supervise } from './supervisor.mjs';

function exactRoles(value, names) {
  const keys = Reflect.ownKeys(value);
  assert.deepEqual(keys, names.filter(name => Object.hasOwn(value, name)), 'finite own-data role keys/order');
  for (const key of keys) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'), 'no role getters');
}
export function controller(root, policy, tools, onIntegrity, clock, dependencies = {}) {
  exactRoles(dependencies, ['publish','scan','beforePersist','afterPublish','supervisorHooks']);
  for (const key of ['publish','scan','beforePersist','afterPublish']) if (Object.hasOwn(dependencies, key)) assert.equal(typeof dependencies[key], 'function');
  const hooks = dependencies.supervisorHooks ?? {};
  exactRoles(hooks, ['spawn','afterSpawn']); for (const key of Reflect.ownKeys(hooks)) assert.equal(typeof hooks[key], 'function');
  const publish = dependencies.publish ?? put, scan = dependencies.scan ?? census;
  const children = [], failures = [], storage = [], records = [], faults = [];
  let active = 0, captured = 0, gitBytes = 0, gitChildren = 0, otherChildren = 0, productWorkers = 0, persisted = 0, halted = false, finalizing = false;
  const firstFault = (phase, reason) => { halted = true; faults.push({ phase, reason }); };
  const facts = owner => ({ id: owner.id, role: owner.role, spawnAttempted: owner.spawnAttempted, spawnReturned: owner.spawnReturned, spawnEvent: owner.spawnEvent, spawnThrew: owner.spawnThrew, pid: owner.pid, closeObserved: owner.closeObserved, code: owner.code, signal: owner.signal, groupAbsent: owner.groupAbsent, supervisorSettled: owner.supervisorSettled, retired: retired(owner), receipt: owner.receipt ?? null });
  const snapshot = () => ({ elapsedMs: clock.elapsed(), origin: 'process performance.timeOrigin; no reset at admission', active, captured, gitBytes, gitChildren, otherChildren, productWorkers, persisted, failures: [...failures], records: [...records], children: children.map(facts), halted, faults: faults.map(entry => ({ phase: entry.phase, reason: String(entry.reason) })) });
  function storageCheck() {
    let total = 0;
    for (const role of storage) {
      clock.check(`storage:${role.name}:before`);
      const entries = scan(role.root), bytes = Object.values(entries).reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
      clock.check(`storage:${role.name}:after`); assert.ok(bytes <= role.maxBytes, `${role.name} storage ceiling`); total += bytes;
    }
    assert.ok(total <= policy.maxWorkingBytes, 'total working storage ceiling');
  }
  function checkpoint() { clock.check('admission', policy.reservedCleanupMs); storageCheck(); }
  function cleanupReady() {
    clock.check('cleanup-accounting');
    assert.equal(active, 0); assert.ok(children.every(retired), 'unknown/unretired child; no cleanup claim');
    return snapshot();
  }
  async function record(name, value, options = {}) {
    try {
      clock.check(`publication:${name}:before`); assert.match(name, /^[a-zA-Z0-9_-]+$/u);
      assert.ok(!records.some(row => row.name === name), 'no receipt overwrite/retry');
      const bytes = Buffer.from(JSON.stringify(value) + '\n'); assert.ok(bytes.length <= policy.maxRecordBytes);
      persisted += bytes.length; assert.ok(persisted <= policy.maxPersistedEvidenceBytes);
      dependencies.beforePersist?.(name, value, children);
      clock.check(`publication:${name}:before-write`);
      const filename = path.join(root, 'records', `${name}.json`);
      await clock.wait(publish(filename, bytes), `publication:${name}`);
      const receipt = { path: filename, sha256: digest(bytes) };
      records.push({ name, bytes: bytes.length, sha256: receipt.sha256 });
      dependencies.afterPublish?.(name, value, children);
      clock.check(`publication:${name}:after-write`); storageCheck();
      if (options.final) cleanupReady();
      return receipt;
    } catch (reason) { firstFault(`publication:${name}`, reason); throw reason; }
  }
  async function child(role, executable, args, options) {
    let owner;
    try {
      assert.equal(halted, false, 'dependent work stopped'); assert.equal(finalizing, false, 'no child after finalization');
      checkpoint(); onIntegrity(); clock.check('after-prechild-integrity', policy.reservedCleanupMs); assert.equal(active, 0, 'serial children only');
      assert.ok(['git','product','type','tool'].includes(role));
      const isGit = role === 'git', isProduct = role === 'product';
      if (isGit) assert.ok(++gitChildren <= policy.maxGitChildren); else assert.ok(++otherChildren <= policy.maxOtherSupervisedChildren);
      if (isProduct) assert.ok(++productWorkers <= policy.maxProductWorkers);
      assert.ok(gitChildren + otherChildren <= policy.maxGitChildren + policy.maxOtherSupervisedChildren);
      assert.ok(options.timeoutMs + 3000 < clock.remaining() - policy.reservedCleanupMs);
      assert.equal(executable, isGit ? tools.git.path : tools.node.path);
      const allowed = isGit ? policy.maxGitCaptureBytes : isProduct ? policy.maxRuntimeWorkerCaptureBytes : role === 'type' ? policy.maxTypeWorkerCaptureBytes : policy.maxToolCaptureBytes;
      const room = Math.min(allowed, policy.maxTotalCapturedChildBytes - captured, isGit ? policy.maxTotalGitBytes - gitBytes : Infinity); assert.ok(room > 0);
      owner = ownership(children.length + 1, role); active++;
      let run;
      try { run = await supervise(executable, args, { ...options, maxBytes: Math.min(options.maxBytes ?? allowed, room) }, owner, clock, hooks); }
      finally { active--; }
      captured += run.bytes; if (isGit) gitBytes += run.bytes;
      if (owner.hasFailureReason) throw owner.failureReason;
      assert.ok(run.closeObserved && run.groupAbsent === true && !run.fault && !run.spawnError && !run.signal, 'unsafe child lifecycle; stop dependents');
      owner.receipt = await record(`child-${String(owner.id).padStart(3, '0')}`, { role, ...run }); children.push(owner);
      onIntegrity(); checkpoint(); return run;
    } catch (reason) { firstFault(owner ? `child:${owner.id}` : 'child-admission', reason); throw reason; }
  }
  async function finalize(value, collect, announce) {
    try {
      assert.equal(finalizing, false); finalizing = true;
      cleanupReady(); clock.check('final-integrity:before'); onIntegrity(); clock.check('final-integrity:after');
      const finalData = await clock.wait(collect(), 'final-census'); clock.check('final-census:after'); cleanupReady();
      const eligibleAcceptance = value.complete === true && value.unsafeStop !== true && !halted && failures.length === 0;
      const receipt = await record('FINAL', { ...value, ...finalData, accounting: snapshot(), eligibleAcceptance, publication: 'provisional; acceptance also requires terminal announcement and zero coordinator exit within the same deadline' }, { final: true });
      const terminal = { receipt, accepted: eligibleAcceptance, unsafeStop: !eligibleAcceptance && (halted || value.unsafeStop === true), elapsedBeforeAnnouncementMs: clock.elapsed(), work: root, childrenRetired: children.every(retired), requiresZeroCoordinatorExit: true };
      clock.check('terminal-announcement:before'); await clock.wait(announce(terminal), 'terminal-announcement'); clock.check('terminal-announcement:after'); cleanupReady();
      return { ...terminal, elapsedMs: clock.elapsed() };
    } catch (reason) { firstFault('finalization', reason); throw reason; }
  }
  return { child, record, checkpoint, snapshot, cleanupReady, finalize, failures, children,
    registerStorage(name, directory, maxBytes) { assert.ok(!storage.some(entry => directory.startsWith(entry.root + '/') || entry.root.startsWith(directory + '/') || directory === entry.root)); storage.push({ name, root: directory, maxBytes }); },
    ordinary(label, accepted) { if (!accepted) failures.push(label); },
    admission(action) { try { checkpoint(); const value = action(); clock.check('after-admission', policy.reservedCleanupMs); return value; } catch (reason) { firstFault('admission', reason); throw reason; } }
  };
}
