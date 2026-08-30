import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HistoryModel, Meter, checkSpan } from './model.mjs';
import { authenticateInputs, hash, inventory, load } from './integrity.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const harness = new Meter({ work: 50000000, allocation: 50000000 });
harness.charge(65536, 65536);
assert(process.argv.length === 2 || (process.argv.length === 4 && process.argv[2] === '--capture'));
const before = inventory(directory, harness);
const inputs = authenticateInputs(directory, harness);
const data = load(directory, 'frozen/INPUTS.json', harness);
const predictions = load(directory, 'frozen/PREDICTIONS.json', harness);
const auth = load(directory, 'AUTHENTICATION.data', harness);
assert.equal(data.groups.length, 12);
assert.equal(data.histories.length, 36);
const rows = harness.array(0);
const checks = harness.array(0);
const targetFailures = harness.array(0);
const profileCounts = harness.array(0);
let permutationChecks = 0;
let relationChecks = 0;

function append(array, value) { harness.charge(128, 128); array.push(value); }
function check(id, action) {
  harness.charge(8192, 8192);
  try { action(); append(checks, { id, status: 'pass' }); }
  catch (error) { append(checks, { id, status: 'fail', name: error?.name, code: error?.code, message: String(error?.message ?? error) }); }
}
function refuses(action, code) { harness.charge(256, 256); assert.throws(action, error => error?.code === code); }
function fixture(id) {
  for (const entry of data.histories) { harness.charge(8); if (entry.id === id) return entry; }
  throw new Error(`Unknown frozen history ${id}`);
}
function make(id, options = {}) {
  harness.charge(1024, 1024);
  const entry = fixture(id);
  return new HistoryModel(data.asts[entry.ast].tree, entry.subject, options);
}
function build(instance, id, eligibility = 'FINITE-PERMISSIVE') {
  harness.charge(256, 256);
  const entry = fixture(id);
  const history = instance.build(entry.plan, eligibility);
  instance.validateFrozen(history, entry);
  return history;
}
function semanticEnv(history) {
  const result = harness.array(history.env.length);
  for (let group = 0; group < history.env.length; group++) {
    harness.charge(64, 64);
    const capture = history.env[group];
    result[group] = { state: capture.state, start: capture.start, end: capture.end };
  }
  return result;
}
function permutations(histories, action) {
  const selected = harness.array(histories.length);
  const used = harness.array(histories.length);
  function visit(depth) {
    harness.charge(32, 8);
    if (depth === histories.length) { action(selected); permutationChecks++; return; }
    for (let index = 0; index < histories.length; index++) {
      harness.charge(16);
      if (used[index]) continue;
      used[index] = true;
      selected[depth] = histories[index];
      visit(depth + 1);
      used[index] = false;
    }
  }
  visit(0);
}
function relations(instance, histories, policy) {
  for (const first of histories) {
    harness.charge(128);
    assert.equal(instance.compare(first, first, policy), 0); relationChecks++;
    for (const second of histories) {
      harness.charge(128);
      const forward = instance.compare(first, second, policy);
      assert.equal(Math.sign(forward) + Math.sign(instance.compare(second, first, policy)), 0); relationChecks++;
      for (const third of histories) {
        harness.charge(128);
        const following = instance.compare(second, third, policy);
        const outer = instance.compare(first, third, policy);
        assert(!(forward <= 0 && following <= 0) || outer <= 0); relationChecks++;
      }
    }
  }
}

for (const policy of predictions.policies) for (const eligibility of ['FINITE-PERMISSIVE', 'LOCAL-TAIL-HYPOTHESIS']) {
  harness.charge(2048, 2048);
  const counts = { policy, eligibility, groups: 12, rankingDomains: 0, attempts: 0, accepted: 0, rejected: 0, matchedRankPredictions: 0, failedRankPredictions: 0, permutations: 0, relations: 0, reconstructedControls: 0, maxModelWork: 0, maxModelAllocation: 0 };
  const startPermutations = permutationChecks;
  const startRelations = relationChecks;
  for (let groupIndex = 0; groupIndex < data.groups.length; groupIndex++) {
    harness.charge(4096, 4096);
    const group = data.groups[groupIndex];
    const prediction = predictions.groups[groupIndex];
    assert.equal(group.id, prediction.id);
    const buckets = harness.array(0);
    for (const id of group.histories) {
      const entry = fixture(id);
      let bucket;
      for (const existing of buckets) { harness.charge(8); if (existing.ast === entry.ast && existing.subject === entry.subject) bucket = existing; }
      if (!bucket) { bucket = { ast: entry.ast, subject: entry.subject, entries: harness.array(0) }; append(buckets, bucket); }
      append(bucket.entries, entry);
    }
    for (const bucket of buckets) check(`${policy}/${eligibility}/${group.id}/${bucket.ast}:${bucket.subject}`, () => {
      harness.charge(4096, 4096);
      counts.rankingDomains++;
      const instance = new HistoryModel(data.asts[bucket.ast].tree, bucket.subject);
      const aliases = {};
      harness.charge(4096, 4096);
      for (let index = 0; index < instance.aliasCount; index++) {
        harness.charge(128, 128);
        aliases[instance.aliases[index].raw] = instance.aliases[index].semantic;
      }
      assert.deepEqual(aliases, data.asts[bucket.ast].captureAliases);
      const histories = harness.array(0);
      const ids = harness.array(0);
      const rejections = harness.array(0);
      for (const entry of bucket.entries) {
        counts.attempts++;
        if (eligibility === 'LOCAL-TAIL-HYPOTHESIS' && entry.localTail === 'reject') {
          const code = entry.id === 'two-empty' ? 'OPTIONAL_CYCLE' : 'OPTIONAL_TAIL';
          refuses(() => instance.build(entry.plan, eligibility), code);
          append(rejections, { id: entry.id, code }); counts.rejected++;
        } else {
          const history = instance.build(entry.plan, eligibility);
          instance.validateFrozen(history, entry);
          append(histories, history); append(ids, entry.id); counts.accepted++;
        }
      }
      const ordered = harness.array(histories.length);
      for (let index = 0; index < histories.length; index++) {
        harness.charge(128);
        let position = index;
        while (position > 0 && instance.compare(histories[index], histories[ordered[position - 1]], policy) < 0) {
          harness.charge(128);
          ordered[position] = ordered[position - 1]; position--;
        }
        ordered[position] = index;
      }
      const order = harness.array(ordered.length);
      for (let index = 0; index < ordered.length; index++) { harness.charge(8); order[index] = ids[ordered[index]]; }
      const declared = prediction[policy] ?? prediction.both;
      const expected = declared[eligibility] ?? declared.eitherEligibility ?? (histories.length > 1 ? declared.comparablePair : declared.singletonControls);
      const scopedExpected = harness.array(0);
      for (const id of expected) { harness.charge(64); if (ids.includes(id)) append(scopedExpected, id); }
      const matched = JSON.stringify(order) === JSON.stringify(scopedExpected);
      if (matched) counts.matchedRankPredictions++; else counts.failedRankPredictions++;
      const winner = instance.rank(histories, policy);
      permutations(histories, permutation => assert.equal(instance.rank(permutation, policy), winner));
      relations(instance, histories, policy);
      if (group.id === 'G10') {
        const duplicate = instance.build(bucket.entries[0].plan, eligibility);
        instance.validateFrozen(duplicate, bucket.entries[0]);
        assert.equal(instance.compare(duplicate, histories[0], policy), 0);
        assert.equal(Math.sign(instance.compare(duplicate, histories[1], policy)), Math.sign(instance.compare(histories[0], histories[1], policy)));
        counts.reconstructedControls++;
      }
      if (group.id === 'G09') {
        assert.deepEqual(semanticEnv(histories[0]), semanticEnv(histories[1]));
        assert.notEqual(instance.compare(histories[0], histories[1], policy), 0);
        assert.equal(instance.builtCount, 2);
      }
      if (group.id === 'G01') append(targetFailures, { policy, eligibility, group: 'G01', target: 'immutable review C1 first body: p4-aa before p4-111', observed: order, status: 'FAIL: aggregate-first conflict preserved' });
      if (group.id === 'G08' && order[0] !== 'p3-narrow') append(targetFailures, { policy, eligibility, group: 'G08', target: 'fixed root P/aaa completed a', observed: order[0], status: 'FAIL: capture-changing tail remains eligible' });
      counts.maxModelWork = Math.max(counts.maxModelWork, instance.meter.work);
      counts.maxModelAllocation = Math.max(counts.maxModelAllocation, instance.meter.allocation);
      append(rows, { policy, eligibility, group: group.id, ast: bucket.ast, subject: bucket.subject, order, expected: scopedExpected, predictionMatched: matched, rejections, winnerEnv: semanticEnv(winner), meter: { work: instance.meter.work, allocation: instance.meter.allocation } });
      assert.deepEqual(order, scopedExpected);
    });
  }
  counts.permutations = permutationChecks - startPermutations;
  counts.relations = relationChecks - startRelations;
  append(profileCounts, counts);
}

check('G04/overmaximum', () => refuses(() => make('bounded-2').build([3, 0], 'FINITE-PERMISSIVE'), 'MAXIMUM'));
check('G07/missing-local-minimum', () => refuses(() => make('q-empty').build([[0], null], 'FINITE-PERMISSIVE'), 'MINIMUM'));
check('G07/restarted-required-ordinals', () => {
  for (const id of ['required-child', 'required-nested']) {
    const instance = make(id);
    const history = build(instance, id);
    const entries = harness.array(0);
    for (const event of history.events) {
      harness.charge(128);
      const node = instance.rawNode(event.node);
      if (event.type === 'enter' && node.kind === 'group' && node.group === 2) append(entries, event);
    }
    assert.equal(entries.length, 4);
    assert.deepEqual(entries.map(event => event.ordinal), [0, 1, 0, 1]);
    assert.notEqual(entries[0].parent, entries[2].parent);
  }
});
check('G11/failed-sibling-preserves-retained-history', () => {
  const instance = make('d-skip');
  const retained = build(instance, 'd-skip');
  const env = retained.env;
  const beforeAllocation = instance.meter.allocation;
  refuses(() => instance.build([[[null, [null]], [null, [null]]], null], 'FINITE-PERMISSIVE'), 'SPAN');
  assert.equal(instance.builtCount, 1);
  assert.equal(retained.env, env);
  assert(instance.meter.allocation > beforeAllocation);
  instance.validateFrozen(retained, fixture('d-skip'));
});
for (const negative of predictions.groups[11].negative) check(`G12/${negative.ast}`, () => {
  const instance = new HistoryModel(data.asts[negative.ast].tree, negative.subject);
  refuses(() => instance.build(negative.plan, 'FINITE-PERMISSIVE'), 'REFERENCE');
  assert.equal(instance.builtCount, 0);
});
check('G12/malformed-span-membership-and-expected-projection', () => {
  for (const span of [[-1, 0], [2, 1], [0, 4], [0, 0.5], [0, Infinity]]) refuses(() => checkSpan(harness, span[0], span[1], 3), 'SPAN');
  const instance = make('p3-narrow');
  const valid = build(instance, 'p3-narrow');
  for (const tree of [{ ...valid.tree, parent: 42 }, { ...valid.tree, ordinal: 99 }, { ...valid.tree, end: 4 }]) refuses(() => instance.compare({ ...valid, tree }, valid, predictions.policies[0]), 'UNVALIDATED');
  refuses(() => instance.rank([{ ...valid, events: [] }], predictions.policies[0]), 'UNVALIDATED');
  refuses(() => instance.validateExpected(valid, [0, 2], [[1, 2]]), 'EXPECTED');
});
check('G12/unchanged-caps-and-invalid-cap-refusal', () => {
  for (const field of ['work', 'allocation']) {
    refuses(() => make('p3-narrow', { [field]: 0 }), 'LIMIT');
    refuses(() => make('p3-narrow', { [field]: 1000001 }), 'CAP');
    refuses(() => make('p3-narrow', { [field]: NaN }), 'CAP');
  }
  refuses(() => make('p3-narrow', { meter: new Meter({ work: 1000001 }) }), 'CAP');
  refuses(() => make('p3-narrow', { depth: 0 }), 'DEPTH');
  refuses(() => make('p3-narrow', { depth: 25 }), 'CAP');
  refuses(() => make('p3-narrow', { events: 2049 }), 'CAP');
  refuses(() => make('p3-narrow', { candidates: 33 }), 'CAP');
  refuses(() => new HistoryModel(data.asts.P.tree, 'a'.repeat(33)), 'INPUT');
  refuses(() => new HistoryModel(data.asts.P.tree, 'é'), 'ASCII');
  const events = make('p3-narrow', { events: 1 });
  refuses(() => events.build(fixture('p3-narrow').plan, 'FINITE-PERMISSIVE'), 'EVENTS');
  const zero = make('p3-narrow', { candidates: 0 });
  refuses(() => zero.build(fixture('p3-narrow').plan, 'FINITE-PERMISSIVE'), 'CANDIDATES');
  const one = make('p4-aa', { candidates: 1 }); build(one, 'p4-aa');
  refuses(() => one.build(fixture('p4-111').plan, 'FINITE-PERMISSIVE'), 'CANDIDATES');
});
check('G12/explicit-profiles-required', () => {
  const instance = make('p3-narrow');
  refuses(() => instance.build(fixture('p3-narrow').plan), 'ELIGIBILITY');
  const history = build(instance, 'p3-narrow');
  refuses(() => instance.rank([history], 'AGGREGATE-v1'), 'POLICY');
});
check('G12/AST-node-arity-capture-repeat-caps', () => {
  const many = ['cat', ...Array.from({ length: 16 }, () => ['cat', ...Array.from({ length: 4 }, () => ['byte', 'a'])])];
  refuses(() => new HistoryModel(many, ''), 'NODES');
  refuses(() => new HistoryModel(['cat', ...Array.from({ length: 17 }, () => ['byte', 'a'])], ''), 'AST');
  refuses(() => new HistoryModel(['group', 17, ['byte', 'a']], ''), 'AST');
  refuses(() => new HistoryModel(['repeat', 0, 33, ['byte', 'a']], ''), 'AST');
});
for (const policy of predictions.policies) for (const field of ['work', 'allocation']) check(`G12/${policy}/${field}-after-incumbent`, () => {
  const instance = make('p4-aa');
  const histories = [build(instance, 'p4-aa'), build(instance, 'p4-111')];
  const owned = instance.owned.bind(instance);
  let admitted = false;
  instance.owned = history => {
    const result = owned(history);
    if (!admitted) { admitted = true; instance.meter[`${field}Limit`] = instance.meter[field]; }
    return result;
  };
  let output;
  refuses(() => { output = instance.rank(histories, policy); }, 'LIMIT');
  assert(admitted); assert.equal(output, undefined);
});
check('G12/preparation-failure-rolls-back-membership-not-charges', () => {
  const instance = make('p4-aa');
  const retained = build(instance, 'p4-aa');
  const allocation = instance.meter.allocation;
  const normalize = instance.normalized.bind(instance);
  instance.normalized = (...args) => { instance.meter.allocationLimit = instance.meter.allocation; return normalize(...args); };
  refuses(() => instance.build(fixture('p4-111').plan, 'FINITE-PERMISSIVE'), 'LIMIT');
  assert.equal(instance.builtCount, 1);
  assert.equal(instance.built[0], retained);
  assert(instance.meter.allocation > allocation);
  assert.equal(instance.built[1], undefined);
});
check('G12/exact-abort-before-work', () => {
  const reason = Object.freeze({ code: 'ENOENT', task: 'synchronous-model-abort' });
  assert.throws(() => make('p3-narrow', { signal: AbortSignal.abort(reason) }), error => error === reason);
});
check('G12/exact-abort-during-table-preparation-after-acceptance', () => {
  const controller = new AbortController();
  const reason = Object.freeze({ tableAbort: true });
  const instance = make('p4-aa', { signal: controller.signal });
  const retained = build(instance, 'p4-aa');
  const visit = instance.visitParents.bind(instance);
  instance.visitParents = (...args) => { controller.abort(reason); return visit(...args); };
  assert.throws(() => instance.build(fixture('p4-111').plan, 'FINITE-PERMISSIVE'), error => error === reason);
  assert.equal(instance.builtCount, 1); assert.equal(instance.built[0], retained);
});
for (const policy of predictions.policies) {
  check(`G12/${policy}/exact-abort-after-incumbent`, () => {
    const controller = new AbortController(); const reason = Object.freeze({ incumbentAbort: true });
    const instance = make('p4-aa', { signal: controller.signal });
    const histories = [build(instance, 'p4-aa'), build(instance, 'p4-111')];
    const owned = instance.owned.bind(instance);
    instance.owned = history => { const result = owned(history); controller.abort(reason); return result; };
    let output;
    assert.throws(() => { output = instance.rank(histories, policy); }, error => error === reason);
    assert.equal(output, undefined);
  });
  check(`G12/${policy}/exact-abort-during-comparison`, () => {
    const controller = new AbortController(); const reason = Object.freeze({ comparisonAbort: true });
    const instance = make('p4-aa', { signal: controller.signal });
    const histories = [build(instance, 'p4-aa'), build(instance, 'p4-111')];
    const charge = instance.meter.charge.bind(instance.meter);
    let calls = 0;
    instance.meter.charge = (...args) => { if (++calls === 12) controller.abort(reason); return charge(...args); };
    assert.throws(() => instance.compare(histories[0], histories[1], policy), error => error === reason);
    assert.equal(calls, 12);
  });
}

authenticateInputs(directory, harness);
assert.deepEqual(inventory(directory, harness), before);
harness.charge(1048576, 1048576);
const failedChecks = checks.filter(entry => entry.status === 'fail');
const report = {
  schema: 1, status: 'HOLD: supplied-history implementation evidence, not an accepted policy or matcher',
  freezeCommit: auth.freezeCommit, freezeManifestSha256: auth.freezeManifestSha256,
  runInputsSha256: hash(load(directory, 'RUN-INPUTS.data', harness, false)), sourceHashes: inputs.entries,
  runtime: { node: process.version, platform: process.platform },
  counts: { frozenGroups: 12, uniqueSuppliedHistories: 36, groupMemberships: 38, profiles: 4, predictionAndControlChecks: checks.length, failedChecks: failedChecks.length, preservedTargetFailures: targetFailures.length, permutationChecks, relationChecks, nativeRegexCalls: 0, workerExecutions: 0, oldCohortRuns: 0, historical137Runs: 0 },
  profileCounts, rows, checks, targetFailures,
  historical: { authorFailedPredictions: 2, independent: '46/52; six policy failures', originalAdapter: '44/50 historical', source: 'frozen/BINDINGS.json; authenticated only, not rerun or rescored' },
  interpretation: ['Five prior discrepancy assertions receive the frozen repaired ordering; C1 remains contradictory under both hierarchies.', 'P/aaa narrow a succeeds only in the separately named conditional eligibility domain; permissive tails conflict with root.', 'W4 splits NODE A versus TREE B. No native vote chooses a policy.', 'TEMP D/abab retained-b differs from explicit Issue8; not a POSIX pass. GNU empty gap retained.'],
  unproven: ['Matcher and parser correspondence; complete path enumeration; arbitrary external-log validation', 'General eligibility/cycle quotient and suffix-compatible dominance; no merge implemented', 'Supported arbitrary activation-ID renaming API; reconstructed histories only checked', 'Async worker cleanup, responsiveness, opaque-host preemption, physical RSS and historical137', 'General policy selection, root authorization, production integration or parity'],
  archiveIntegrity: { completeEntryInventoryEqualBeforeAfter: true, detectsAddedFilesDirectoriesAndSymlinks: true, scope: 'owned execution archive only, not the concurrent repository' },
  harness: { workLimit: 50000000, allocationLimit: 50000000, cumulativeAdmissionEnforced: true, integrityInventoryCostsDependOnInertArchiveContents: true },
};
const output = JSON.stringify(report, null, 2) + '\n';
assert(output.length <= 1048576);
if (process.argv.length === 4) {
  const capture = path.resolve(process.argv[3]);
  assert(!capture.startsWith(directory));
  writeFileSync(capture, output, { flag: 'wx' });
}
process.stdout.write(output);
process.exitCode = failedChecks.length || targetFailures.length ? 1 : 0;
