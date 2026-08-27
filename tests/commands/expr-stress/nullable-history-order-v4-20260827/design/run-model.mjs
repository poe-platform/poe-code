import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HistoryModel, Meter, Refusal, checkSpan, sameContinuationState } from './model.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const harness = new Meter({ work: 50000000, allocation: 50000000 });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const load = (name, json = true) => {
  const location = new URL(name, import.meta.url);
  const size = statSync(location).size;
  assert.ok(size <= 1048576);
  harness.charge(size * 32 + 1, size * 32 + 1);
  const bytes = readFileSync(location);
  return json ? JSON.parse(bytes.toString('utf8')) : bytes;
};
const witnessBytes = load('WITNESSES.data', false);
harness.charge(witnessBytes.length * 32, witnessBytes.length * 32);
const data = JSON.parse(witnessBytes.toString('utf8'));
const sealedWitness = execFileSync('git', ['show', 'a6ce736d:tests/commands/expr-stress/nullable-history-order-v4-20260827/design/WITNESSES.data'], { cwd: directory, maxBuffer: 1048576 });
assert.equal(digest(witnessBytes), digest(sealedWitness));
const manifestBytes = load('../frozen/FREEZE-MANIFEST.json', false);
assert.equal(digest(manifestBytes), data.freezeManifestSha256);
const frozenPrefix = 'tests/commands/expr-stress/nullable-history-order-v4-20260827/frozen';
const frozenFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', data.freezeCommit, '--', frozenPrefix], { cwd: fileURLToPath(new URL('../../../../../', import.meta.url)), maxBuffer: 1048576 }).toString().trim().split('\n');
assert.equal(frozenFiles.length, 9);
for (const filename of frozenFiles) {
  const baseline = execFileSync('git', ['show', `${data.freezeCommit}:${filename}`], { cwd: directory, maxBuffer: 1048576 });
  const local = load(`../frozen/${filename.slice(frozenPrefix.length + 1)}`, false);
  assert.equal(digest(local), digest(baseline), filename);
}
const inputs = load('../frozen/INPUTS.json');
assert.equal(data.cases.length, 10);
const rows = [];
const models = new Map();
let fixtureAttempts = 0;
let validFixtureHistories = 0;
let rejectedFixtureHistories = 0;
let permutationRanks = 0;
let relationChecks = 0;
const predictionFailures = [];
const controls = [];

function permutations(values, visit, prefix = harness.array(0)) {
  harness.charge(4);
  if (values.length === 0) return visit(prefix);
  for (let index = 0; index < values.length; index++) {
    const remaining = harness.array(values.length - 1);
    const next = harness.array(prefix.length + 1);
    for (let previous = 0; previous < prefix.length; previous++) next[previous] = prefix[previous];
    next[prefix.length] = values[index];
    let target = 0;
    for (let candidate = 0; candidate < values.length; candidate++) if (candidate !== index) remaining[target++] = values[candidate];
    permutations(remaining, visit, next);
  }
}

function refuses(callback, code) {
  assert.throws(callback, error => error instanceof Refusal && error.code === code);
}

for (const fixture of data.cases) {
  harness.charge(128, 128);
  const input = inputs.cases.find(row => row.id === fixture.id);
  assert.ok(input, fixture.id);
  const model = new HistoryModel(data.asts[fixture.ast], input.subject);
  const histories = harness.array(fixture.histories.length);
  const labels = new Map();
  let count = 0;
  for (const witness of fixture.histories) {
    fixtureAttempts++;
    if (witness.reject) {
      refuses(() => model.build(witness.plan), witness.reject);
      rejectedFixtureHistories++;
    } else {
      const history = model.build(witness.plan);
      model.validateExpected(history, witness.whole, witness.captures);
      histories[count++] = history;
      labels.set(history, witness.id);
      validFixtureHistories++;
      assert.ok(Object.isFrozen(history) && Object.isFrozen(history.tree) && Object.isFrozen(history.events) && Object.isFrozen(history.env));
      for (const event of history.events) {
        assert.ok(Object.isFrozen(event) && Object.isFrozen(event.env));
        if (event.type === 'exit') checkSpan(model.meter, event.start, event.end, input.subject.length);
      }
    }
  }
  histories.length = count;
  const winners = {};
  for (const policy of ['AGGREGATE-v1', 'ITERATION-v1']) {
    const winner = model.rank(histories, policy);
    winners[policy] = labels.get(winner);
    if (winners[policy] !== fixture.winners[policy]) predictionFailures.push({ case: fixture.id, policy, predicted: fixture.winners[policy], actual: winners[policy] });
    permutations(histories, order => {
      assert.equal(model.rank(order, policy), winner);
      permutationRanks++;
    });
    for (const first of histories) for (const second of histories) {
      assert.equal(Math.sign(model.compare(first, second, policy)) + Math.sign(model.compare(second, first, policy)), 0);
      assert.equal(model.compare(first, first, policy), 0);
      relationChecks += 2;
      for (const third of histories) {
        const premise = model.compare(first, second, policy) <= 0 && model.compare(second, third, policy) <= 0;
        if (premise) assert.ok(model.compare(first, third, policy) <= 0);
        relationChecks++;
      }
    }
  }
  rows.push({ id: fixture.id, pattern: input.pattern, subjectHex: Buffer.from(input.subject).toString('hex'), supplied: fixture.histories.length, eligible: count, winners, meterAfterFixtureOrdering: { work: model.meter.work, allocation: model.meter.allocation } });
  models.set(fixture.id, { model, histories, labels });
}

assert.deepEqual(predictionFailures, [
  { case: 'prefix-star', policy: 'ITERATION-v1', predicted: 'prefix-long', actual: 'capture-long' },
  { case: 'prefix-two-captures', policy: 'ITERATION-v1', predicted: 'prefix-long', actual: 'capture-long' }
]);
controls.push('frozen-policy-prediction-failures-preserved');

const prefix = models.get('prefix-star');
assert.notEqual(prefix.model.rank(prefix.histories, 'AGGREGATE-v1'), prefix.histories[1]);
assert.ok(prefix.histories[1].env[1].end - prefix.histories[1].env[1].start > prefix.histories[0].env[1].end - prefix.histories[0].env[1].start);
assert.notEqual(prefix.histories[0], prefix.histories[1]);
const firstDFS = order => order[0];
assert.notEqual(firstDFS(prefix.histories), firstDFS([prefix.histories[1], prefix.histories[0], prefix.histories[2]]));
controls.push('uncaptured-prefix-beats-final-capture-sort', 'firstDFS-enumeration-counterexample');

const repeated = models.get('P-aaaa');
for (let index = 0; index < repeated.histories[0].env.length; index++) {
  const first = repeated.histories[0].env[index];
  const second = repeated.histories[2].env[index];
  assert.equal(first.state, second.state);
  assert.equal(first.start, second.start);
  assert.equal(first.end, second.end);
}
assert.equal(repeated.histories[0].tree.end, repeated.histories[2].tree.end);
assert.ok(repeated.model.compare(repeated.histories[0], repeated.histories[2], 'AGGREGATE-v1') < 0);
assert.ok(repeated.model.compare(repeated.histories[0], repeated.histories[2], 'ITERATION-v1') < 0);
controls.push('same-accept-pc-position-final-env-different-history');

const narrow = models.get('P-aaa');
const tailWitness = data.cases[0].histories[3];
const permissiveTail = narrow.model.build(tailWitness.plan, false);
narrow.model.validateExpected(permissiveTail, tailWitness.whole, tailWitness.captures);
const withTail = harness.array(narrow.histories.length + 1);
for (let index = 0; index < narrow.histories.length; index++) withTail[index] = narrow.histories[index];
withTail[withTail.length - 1] = permissiveTail;
for (const policy of ['AGGREGATE-v1', 'ITERATION-v1']) assert.equal(narrow.model.rank(withTail, policy), permissiveTail);
assert.equal(narrow.histories[0].env[1].start, 1);
assert.equal(narrow.histories[0].env[1].end, 2);
controls.push('tail-admission-conflicts-with-narrow-root-under-both-policies');

const descendant = models.get('D-abab');
const retained = descendant.histories[0];
const skipped = retained.events.find(event => event.type === 'skip' && event.node === 'r.0.0.0.1.0' && event.start === 3);
assert.equal(skipped.env[2].state, 'completed-nonempty');
assert.ok(retained.events.some(event => event.type === 'exit' && event.activation === skipped.env[2].activation && event.start === 1 && event.end === 2));
assert.equal(descendant.model.reference(skipped.env[2], 3), 4);
const open = retained.events.find(event => event.type === 'enter' && event.node === 'r.0.0.0.1.0');
assert.equal(open.env[2].state, 'open');
refuses(() => descendant.model.reference(open.env[2], 3), 'REFERENCE');
refuses(() => descendant.model.reference(retained.events[0].env[2], 3), 'REFERENCE');
controls.push('descendant-skip-retains', 'open-invalidates-reference', 'absent-does-not-mean-empty');

const empty = models.get('descendant-reentered-empty');
const emptyHistory = empty.histories[0];
const emptyOpen = emptyHistory.events.find(event => event.type === 'enter' && event.node === 'r.0.0.0.1' && event.start === 3);
assert.equal(emptyOpen.env[2].state, 'open');
assert.equal(emptyHistory.env[2].state, 'completed-empty');
assert.equal(empty.model.reference(emptyHistory.env[2], 3), 3);
assert.equal(skipped.env[2].state, 'completed-nonempty');
controls.push('reentry-completes-empty-without-mutating-old-branch');

const state = harness.record(() => ({ pc: 17, position: 3, required: 0, progressed: false, optionalEmpty: false, activation: 2, parent: 1, env: skipped.env }));
const changed = harness.record(() => ({ ...state, env: open.env }));
assert.equal(sameContinuationState(harness, state, state), true);
assert.equal(sameContinuationState(harness, state, changed), false);
assert.equal(sameContinuationState(harness, state, harness.record(() => ({ ...state, required: 1 }))), false);
assert.equal(sameContinuationState(harness, state, harness.record(() => ({ ...state, activation: 3 }))), false);
controls.push('same-pc-position-distinct-env-distinct-continuation', 'required-count-and-activation-not-equivalent-cycles');

const zero = new HistoryModel(data.asts.P, '');
refuses(() => zero.build([[0, 0], null]), 'OPTIONAL_CYCLE');
assert.equal(models.get('Q-empty').histories[0].tree.children[0].children.length, 2);
assert.equal(models.get('required-child-empty').histories[0].env[2].state, 'completed-empty');
controls.push('optional-empty-cycle-refused', 'required-empty-local-iterations-retained');

for (const span of [[2, 1], [-1, 0], [0, 4], [0, 0.5], [0, Infinity]]) refuses(() => checkSpan(harness, span[0], span[1], 3), 'SPAN');
refuses(() => prefix.model.validateExpected(prefix.histories[0], [0, 2], [[3, 3]]), 'EXPECTED');
refuses(() => prefix.model.rank([{}], 'AGGREGATE-v1'), 'UNVALIDATED');
controls.push('five-malformed-byte-spans-refused', 'incorrect-expected-span-refused', 'unvalidated-history-refused');

refuses(() => new Meter({ allocation: 127 }), 'LIMIT');
refuses(() => new Meter({ work: 127 }), 'LIMIT');
refuses(() => new Meter({ work: NaN }), 'CAP');
refuses(() => new HistoryModel(data.asts.P, 'a'.repeat(33)), 'INPUT');
refuses(() => new HistoryModel(data.asts.P, 'é'), 'ASCII');
refuses(() => new HistoryModel(data.asts.P, '', { depth: 1 }), 'DEPTH');
const limitedEvents = new HistoryModel(data.asts.P, '', { events: 1 });
refuses(() => limitedEvents.build([[0], null]), 'EVENTS');
const limitedCandidates = new HistoryModel(data.asts.P, '', { candidates: 0 });
refuses(() => limitedCandidates.build([[0], null]), 'CANDIDATES');
controls.push('allocation-work-input-ascii-depth-event-candidate-limits');

const savedWork = repeated.model.meter.workLimit;
repeated.model.meter.workLimit = repeated.model.meter.work + 18;
let partial;
refuses(() => { partial = repeated.model.rank(repeated.histories, 'AGGREGATE-v1'); }, 'LIMIT');
assert.equal(partial, undefined);
repeated.model.meter.workLimit = savedWork;
const savedAllocation = repeated.model.meter.allocationLimit;
repeated.model.meter.allocationLimit = repeated.model.meter.allocation;
refuses(() => repeated.model.compare(repeated.histories[0], repeated.histories[2], 'AGGREGATE-v1'), 'LIMIT');
repeated.model.meter.allocationLimit = savedAllocation;
controls.push('exhaustion-after-incumbent-never-returns', 'comparison-stack-allocation-charged');

const reason = Object.freeze({ taskOwnedReason: 'cancel' });
const controller = new AbortController();
controller.abort(reason);
assert.throws(() => new Meter({ signal: controller.signal }), error => error === reason);
prefix.model.meter.signal = controller.signal;
assert.throws(() => prefix.model.rank(prefix.histories, 'AGGREGATE-v1'), error => error === reason);
prefix.model.meter.signal = undefined;
controls.push('exact-abort-reason-before-work-and-ranking');

const report = {
  schema: 1,
  role: 'MODEL ONLY; finite hand-authored histories, not matcher/native acceptance',
  node: process.version,
  platform: process.platform,
  freezeCommit: data.freezeCommit,
  freezeManifestSha256: digest(manifestBytes),
  witnessFreezeCommit: 'a6ce736d',
  witnessSha256: digest(witnessBytes),
  sourceHashes: { model: digest(load('model.mjs', false)), runner: digest(load('run-model.mjs', false)) },
  counts: { selectedInputs: rows.length, fixtureAttempts, validFixtureHistories, rejectedFixtureHistories, additionalPermissiveTailHistories: 1, permutationRanks, relationChecks, namedControls: controls.length, nativeCalls: 0, engineExecutions: 0, workersCreated: 0, historical137Rerun: 0 },
  rows,
  predictionFailures,
  controls,
  decisions: ['ITERATION-v1 frozen prefix predictions refuted; not repaired', 'AGGREGATE-v1 remains provisional under stronger optional-tail hypothesis', 'P-aaaa ambiguity and P-aaa admission conflict unresolved', 'D-abab deliberately departs from Issue8 under project retention'],
  limits: ['No exhaustive parse forest', 'No actual worker lifecycle validation', 'No regular path theorem extended to backrefs', 'Cycle signature is necessary bookkeeping, not a dominance proof'],
  harnessMeterBeforeSerialization: { work: harness.work, allocation: harness.allocation }
};
harness.charge(1048576, 1048576);
const output = JSON.stringify(report, null, 2) + '\n';
assert.ok(output.length <= 1048576);
if (process.argv.length > 2) {
  assert.equal(process.argv.length, 4);
  assert.equal(process.argv[2], '--capture');
  assert.equal(process.argv[3], 'model-01.data');
  writeFileSync(new URL(process.argv[3], import.meta.url), output, { flag: 'wx' });
}
console.log(output);
