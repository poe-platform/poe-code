import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const requiredInputs = ['supervise-representative.mjs', 'representative.mjs', 'launch-seal.mjs', 'driver-lifecycle.mjs', 'observe-process.mjs', 'observe-load.mjs', 'representative-plan-v3.json', 'execution-closure.json', 'download.json', 'package-comparison.json'];
export const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function approvedBytes(name, bytes, expectedHash) {
  assert.equal(digest(bytes), expectedHash, `unapproved consumed input: ${name}`);
  return bytes;
}
export function verifyLaunch(output, approvalPath) {
  assert.ok(approvalPath?.startsWith('/tmp/safe-bash-baseline-auth-'));
  const approvalBytes = fs.readFileSync(approvalPath), approval = JSON.parse(approvalBytes);
  assert.equal(approval.approved, true); assert.equal(approval.authority, 'root');
  assert.equal(approval.resultBearingCalls, 8); assert.equal(approval.engineChildren, 8);
  assert.equal(approval.coordinatorProcesses, 1); assert.equal(approval.supervisorProcesses, 1);
  const inputs = new Map();
  for (const name of requiredInputs) {
    const bytes = fs.readFileSync(path.join(output, name));
    approvedBytes(name, bytes, approval.files?.[name]);
    inputs.set(name, bytes);
  }
  const textPlan = fs.readFileSync('/tmp/safe-bash-baseline-auth-plan.txt');
  assert.equal(digest(textPlan), approval.textPlanSha256);
  const plan = JSON.parse(inputs.get('representative-plan-v3.json'));
  const closure = JSON.parse(inputs.get('execution-closure.json'));
  const download = JSON.parse(inputs.get('download.json'));
  assert.equal(plan.textPlanSha256, approval.textPlanSha256);
  assert.equal(plan.rows.length, 8); assert.equal(new Set(plan.rows.map(row => row.id)).size, 7);
  assert.equal(plan.budget.resultBearingBashExecCalls, 8);
  assert.equal(plan.budget.warmups, 0);
  assert.equal(plan.budget.freshEngineChildren, 8);
  assert.equal(plan.budget.coordinatorProcesses, 1);
  assert.equal(plan.budget.supervisorProcesses, 1);
  assert.deepEqual(plan.rows.map(row => row.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(JSON.parse(inputs.get('package-comparison.json')).allEqual, true);
  assert.equal(fs.realpathSync(download.executable), download.executable);
  assert.ok(fs.lstatSync(download.executable).isFile());
  assert.equal(digest(fs.readFileSync(download.executable)), download.nodeSha256, 'selected Node executable changed');
  assert.equal(fs.realpathSync(process.execPath), download.executable, 'actual running Node path differs');
  assert.equal(digest(fs.readFileSync(process.execPath)), download.nodeSha256, 'actual running Node bytes differ');
  const root = fs.realpathSync(closure.root);
  assert.equal(root, closure.root);
  assert.ok(root.startsWith('/private/tmp/safe-bash-published-auth-'));
  for (const name of ['HOME', 'TMPDIR', 'npm_config_cache']) assert.ok(fs.realpathSync(download.environment[name]).startsWith(`${download.scratch}/`));
  return { approval, approvalSha256: digest(approvalBytes), inputs, plan, closure, download, root };
}
export function observerEntries(verified) {
  const entries = ['observe-process.mjs', 'observe-load.mjs'].map(name => ({ path: `auth-observer/${name}`, source: name, sha256: verified.approval.files[name], bytes: verified.inputs.get(name).length, mode: 0o444 }));
  assert.deepEqual(entries, verified.plan.closureAdditions);
  return entries;
}
export function exactMembership(expected, actual) {
  const wanted = [...expected].sort(), observed = [...actual].sort();
  assert.deepEqual(observed, wanted, 'closure file membership changed');
}
export function checkClosure(verified, observersPresent) {
  const entries = [...verified.closure.files, ...(observersPresent ? observerEntries(verified) : [])];
  const expected = new Map(entries.map(entry => [entry.path, entry]));
  assert.equal(expected.size, entries.length, 'duplicate sealed path');
  const directories = new Set();
  for (const entry of entries) {
    assert.ok(entry.path && !path.posix.isAbsolute(entry.path) && !entry.path.split('/').some(part => !part || part === '.' || part === '..'));
    let parent = path.posix.dirname(entry.path);
    while (parent !== '.') { directories.add(parent); parent = path.posix.dirname(parent); }
  }
  const observed = [];
  function visit(relative = '') {
    for (const entry of fs.readdirSync(path.join(verified.root, relative), { withFileTypes: true })) {
      const filename = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(verified.root, filename), stat = fs.lstatSync(full);
      assert.ok(!stat.isSymbolicLink(), `closure symlink ${filename}`);
      if (stat.isDirectory()) { assert.ok(directories.has(filename), `undeclared closure directory ${filename}`); visit(filename); }
      else {
        assert.ok(stat.isFile() && stat.nlink === 1, `closure not independent regular file ${filename}`);
        const sealed = expected.get(filename); assert.ok(sealed, `undeclared closure file ${filename}`);
        assert.equal(digest(fs.readFileSync(full)), sealed.sha256, `closure bytes ${filename}`);
        assert.equal(stat.size, sealed.bytes); assert.equal(stat.mode & 0o777, sealed.mode);
        observed.push(filename);
      }
    }
  }
  visit(); exactMembership(expected.keys(), observed);
  return { files: observed.length, exactMembership: true, observerAdditions: observersPresent ? observerEntries(verified) : [] };
}
export function stageObservers(verified) {
  fs.mkdirSync(path.join(verified.root, 'auth-observer'), { mode: 0o700 });
  for (const entry of observerEntries(verified)) {
    const bytes = verified.inputs.get(entry.source);
    assert.equal(digest(bytes), entry.sha256);
    fs.writeFileSync(path.join(verified.root, entry.path), bytes, { flag: 'wx', mode: entry.mode });
    assert.equal(digest(fs.readFileSync(path.join(verified.root, entry.path))), verified.approval.files[entry.source], 'staged observer differs from approved bytes');
  }
  return checkClosure(verified, true);
}
