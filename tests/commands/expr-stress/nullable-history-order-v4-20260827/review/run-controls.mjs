import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const modelPath = process.argv[2];
if (!modelPath) throw new Error('Pass the authenticated archived model.mjs path');
const source = readFileSync(modelPath, 'utf8');
const model = await import(pathToFileURL(modelPath).href);
const policies = ['AGGREGATE-v1', 'ITERATION-v1'];
const results = [];
const observations = [];
const byte = (character) => ['byte', character];
const repeat = (body, minimum = 0, maximum = null) => ['repeat', minimum, maximum, body];
const group = (number, body) => ['group', number, body];
const cat = (...children) => ['cat', ...children];
const ref = (number) => ['ref', number];
const aStar = () => repeat(byte('a'));
const patternP = () => cat(repeat(group(1, aStar())), ref(1));
const patternD = () => cat(repeat(group(1, cat(byte('a'), repeat(group(2, byte('b')))))), ref(2));
const patternE = () => cat(repeat(group(1, cat(byte('a'), group(2, repeat(byte('b')))))), ref(2));

function check(id, action) {
  try {
    action();
    results.push({ id, status: 'pass' });
  } catch (error) {
    results.push({ id, status: 'fail', name: error.name, code: error.code, message: error.message });
  }
}

function refuses(action, code) {
  assert.throws(action, (error) => error.code === code);
}

function permutations(values) {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) => permutations(values.filter((_, other) => index !== other)).map((tail) => [value, ...tail]));
}

function orderControls(api, prefix = '') {
  const instance = new api.HistoryModel(patternP(), 'aaaa');
  const histories = [[[2], null], [[1, 1, 1], null], [[1, 1], null], [[1], null]].map((plan) => instance.build(plan));
  for (const policy of policies) {
    observations.push({ id: `${prefix}C1/${policy}`, winnerIndex: histories.indexOf(instance.rank(histories, policy)), firstBodyComparison: instance.compare(histories[0], histories[1], policy) });
    check(`${prefix}C1/${policy}/first-body-priority`, () => assert(instance.compare(histories[0], histories[1], policy) < 0));
    check(`${prefix}C1/${policy}/all-24-enumerations`, () => {
      const expected = instance.rank(histories, policy);
      for (const permutation of permutations(histories)) assert.equal(instance.rank(permutation, policy), expected);
    });
    check(`${prefix}C1/${policy}/total-order-on-four`, () => {
      for (const first of histories) {
        assert.equal(instance.compare(first, first, policy), 0);
        for (const second of histories) {
          const forward = Math.sign(instance.compare(first, second, policy));
          const backward = Math.sign(instance.compare(second, first, policy));
          assert.equal(forward + backward, 0);
          for (const third of histories) {
            if (instance.compare(first, second, policy) <= 0 && instance.compare(second, third, policy) <= 0) assert(instance.compare(first, third, policy) <= 0);
          }
        }
      }
      assert(instance.compare(histories[0], histories[2], policy) < 0);
      assert(instance.compare(histories[1], histories[2], policy) < 0);
    });
  }
}

function prefixControls(api, prefix = '') {
  for (const [name, ast, plans] of [
    ['prefix-star', cat(aStar(), group(1, aStar())), [[3, 0], [2, 1], [0, 3]]],
    ['prefix-interval', cat(repeat(byte('a'), 0, 2), group(1, aStar())), [[2, 1], [1, 2], [0, 3]]],
    ['nested-prefix', group(1, cat(aStar(), group(2, aStar()))), [[3, 0], [2, 1], [0, 3]]],
  ]) {
    const instance = new api.HistoryModel(ast, 'aaa');
    const histories = plans.map((plan) => instance.build(plan));
    for (const policy of policies) {
      const winner = instance.rank(histories, policy);
      observations.push({ id: `${prefix}C2/${policy}/${name}`, winnerIndex: histories.indexOf(winner), captures: winner.env });
      check(`${prefix}C2/${policy}/${name}`, () => assert(winner === histories[0], 'longest legal uncaptured prefix must win'));
    }
    if (name === 'prefix-interval') check(`${prefix}C2/overmaximum`, () => refuses(() => instance.build([3, 0]), 'MAXIMUM'));
  }
}

function malformedControls(api, prefix = '') {
  for (const [name, start, end] of [['negative', -1, 2], ['beyond', 0, 4], ['reversed', 2, 1], ['fractional', 0.5, 2], ['unsafe', 0, Number.MAX_SAFE_INTEGER + 1]]) {
    check(`${prefix}C3/span/${name}`, () => refuses(() => api.checkSpan(new api.Meter(), start, end, 3), 'SPAN'));
  }
  const instance = new api.HistoryModel(patternP(), 'aaa');
  const valid = instance.build([[1, 1], null]);
  for (const [name, tree] of [
    ['wrong-parent', { ...valid.tree, parent: 42 }],
    ['wrong-slot', { ...valid.tree, ordinal: 99 }],
    ['outside-origin', { ...valid.tree, end: 4 }],
  ]) check(`${prefix}C3/${name}/unowned-operand`, () => refuses(() => instance.compare({ ...valid, tree }, valid, policies[0]), 'UNVALIDATED'));
  check(`${prefix}C3/missing-child`, () => refuses(() => instance.build([[1, 1]]), 'PLAN'));
  check(`${prefix}C3/immutable-tree`, () => assert.throws(() => { valid.tree.end = 4; }, TypeError));
  check(`${prefix}C3/expected-span`, () => refuses(() => instance.validateExpected(valid, [0, 3], [[2, 1]]), 'SPAN'));
}

function lifetimeControls(api, prefix = '') {
  const instance = new api.HistoryModel(patternD(), 'abab');
  const retained = instance.build([[[null, [null]], [null, []]], null]);
  check(`${prefix}C4/TEMP-retention-origin`, () => {
    assert.deepEqual([retained.env[2].start, retained.env[2].end], [1, 2]);
    assert.deepEqual([retained.env[1].start, retained.env[1].end], [2, 3]);
    assert.equal(retained.tree.end, 4);
  });
  check(`${prefix}C4/failed-branch-isolation`, () => {
    const before = JSON.stringify(retained);
    assert.throws(() => instance.build([[[null, [null]], [null, [null]]], null]));
    assert.equal(JSON.stringify(retained), before);
    assert.deepEqual(instance.build([[[null, [null]], [null, []]], null]).env, retained.env);
  });
  const reentered = new api.HistoryModel(patternE(), 'aba').build([[[null, 1], [null, 0]], null]);
  check(`${prefix}C4/empty-reentry-open-completed`, () => {
    const entries = reentered.events.filter((event) => event.type === 'enter' && event.node === 'r.0.0.0.1');
    assert.equal(entries.length, 2);
    assert.equal(entries[1].env[2].state, 'open');
    assert.equal(reentered.env[2].state, 'completed-empty');
    assert.deepEqual([reentered.env[2].start, reentered.env[2].end], [3, 3]);
  });
  check(`${prefix}C4/nonempty-reentry`, () => {
    const history = new api.HistoryModel(patternD(), 'ababb').build([[[null, [null]], [null, [null]]], null]);
    assert.deepEqual([history.env[2].start, history.env[2].end, history.tree.end], [3, 4, 5]);
  });
  check(`${prefix}C4/open-reference`, () => refuses(() => new api.HistoryModel(group(1, cat(byte('a'), ref(1))), 'aa').build([null, null]), 'REFERENCE'));
  check(`${prefix}C4/open-reentry-not-stale`, () => refuses(() => new api.HistoryModel(repeat(group(1, cat(byte('a'), repeat(ref(1))))), 'aa').build([[null, []], [null, [null]]]), 'REFERENCE'));
}

function emptyControls(api, prefix = '') {
  const exact = cat(repeat(group(1, aStar()), 2, 2), ref(1));
  check(`${prefix}C5/exact-two-required`, () => {
    const instance = new api.HistoryModel(exact, '');
    const history = instance.build([[0, 0], null]);
    assert.equal(history.tree.children[0].children.length, 2);
    refuses(() => instance.build([[0], null]), 'MINIMUM');
  });
  check(`${prefix}C5/nested-local-counts`, () => {
    const ast = repeat(group(1, repeat(group(2, aStar()), 2, 2)), 2, 2);
    const history = new api.HistoryModel(ast, '').build([[0, 0], [0, 0]]);
    const entries = history.events.filter((event) => event.type === 'enter' && event.node === 'r.0.0.0');
    assert.equal(entries.length, 4);
    assert.deepEqual(entries.map((event) => event.ordinal), [0, 1, 0, 1]);
    assert.notEqual(entries[0].parent, entries[2].parent);
  });
  check(`${prefix}C5/required-after-prefix`, () => {
    const ast = cat(aStar(), repeat(group(1, repeat(byte('b'))), 2, 2), ref(1));
    const history = new api.HistoryModel(ast, 'a').build([1, [0, 0], null]);
    assert.equal(history.tree.end, 1);
    assert.equal(history.tree.children[1].children.length, 2);
  });
  check(`${prefix}C5/required-child-after-parent-progress`, () => {
    const ast = cat(repeat(group(1, cat(byte('a'), repeat(group(2, repeat(byte('b'))), 2, 2)))), ref(2));
    const history = new api.HistoryModel(ast, 'aa').build([[[null, [0, 0]], [null, [0, 0]]], null]);
    assert.equal(history.tree.end, 2);
    assert.equal(history.events.filter((event) => event.type === 'enter' && event.node === 'r.0.0.0.1.0').length, 4);
  });
  check(`${prefix}C5/optional-tail-separate-rule`, () => {
    const instance = new api.HistoryModel(patternP(), 'aaa');
    const narrow = instance.build([[1, 1], null]);
    refuses(() => instance.build([[3, 0], null]), 'OPTIONAL_TAIL');
    const tail = instance.build([[3, 0], null], false);
    const groupEntries = tail.events.filter((event) => event.type === 'exit' && event.node === 'r.0.0');
    assert.equal(groupEntries[0].env[1].state, 'completed-nonempty');
    assert.equal(groupEntries[1].env[1].state, 'completed-empty');
    assert.equal(tail.tree.end, 3);
    for (const policy of policies) assert.equal(instance.rank([narrow, tail], policy), tail);
  });
}

function contextControls(api, prefix = '') {
  check(`${prefix}C6/absent-not-empty`, () => {
    refuses(() => new api.HistoryModel(cat(repeat(group(1, byte('a')), 0, 0), ref(1)), '').build([[], null]), 'REFERENCE');
    const history = new api.HistoryModel(cat(group(1, aStar()), group(2, repeat(byte('b'))), ref(2)), 'a').build([1, 0, null]);
    assert.equal(history.env[2].state, 'completed-empty');
  });
  check(`${prefix}C6/END-not-absent-empty`, () => {
    const instance = new api.HistoryModel(repeat(group(1, aStar())), '');
    const absent = instance.build([]);
    const empty = instance.build([0]);
    assert.equal(absent.env[1].state, 'absent');
    assert.equal(empty.env[1].state, 'completed-empty');
    assert.equal(absent.tree.children.length, 0);
    assert.equal(empty.tree.children.length, 1);
    assert.equal(empty.events.filter((event) => event.type === 'skip' && event.node === 'r.0').length, 1);
    for (const policy of policies) {
      observations.push({ id: `${prefix}C6/${policy}/empty-vs-absent`, comparison: instance.compare(empty, absent, policy) });
      check(`${prefix}C6/${policy}/participating-empty-before-zero`, () => assert(instance.compare(empty, absent, policy) < 0));
    }
  });
  const ast = repeat(group(1, cat(group(2, aStar()), aStar())));
  const instance = new api.HistoryModel(ast, 'aaaa');
  const first = instance.build([[0, 2], [2, 0]]);
  const second = instance.build([[2, 0], [1, 0], [1, 0]]);
  for (const policy of policies) check(`${prefix}C6/${policy}/W4-dynamic-tree-profile`, () => assert(instance.compare(second, first, policy) < 0));
  check(`${prefix}C6/identical-reconstruction-equivalent`, () => {
    const duplicate = instance.build([[0, 2], [2, 0]]);
    for (const policy of policies) assert.equal(instance.compare(duplicate, first, policy), 0);
  });
}

function limitControls(api, prefix = '') {
  for (const kind of ['work', 'allocation']) {
    check(`${prefix}C7/${kind}/zero`, () => refuses(() => new api.Meter({ [kind]: 0 }), 'LIMIT'));
    check(`${prefix}C7/${kind}/after-incumbent`, () => {
      const instance = new api.HistoryModel(patternP(), 'aaaa');
      const histories = [instance.build([[2], null]), instance.build([[1, 1, 1], null])];
      const original = instance.owned.bind(instance);
      let firstAdmitted = false;
      instance.owned = (history) => {
        original(history);
        if (!firstAdmitted) {
          firstAdmitted = true;
          instance.meter[`${kind}Limit`] = instance.meter[kind];
        }
      };
      refuses(() => instance.rank(histories, policies[0]), 'LIMIT');
      assert(firstAdmitted);
    });
  }
  check(`${prefix}C7/cancellation-after-incumbent`, () => {
    const controller = new AbortController();
    const reason = new Error('independent cooperative comparison abort');
    const instance = new api.HistoryModel(patternP(), 'aaaa', { signal: controller.signal });
    const histories = [instance.build([[2], null]), instance.build([[1, 1, 1], null])];
    const original = instance.owned.bind(instance);
    instance.owned = (history) => { original(history); controller.abort(reason); };
    assert.throws(() => instance.rank(histories, policies[0]), (error) => error === reason);
  });
  check(`${prefix}C7/cancellation-before-admission`, () => {
    const reason = new Error('independent initial abort');
    assert.throws(() => new api.Meter({ signal: AbortSignal.abort(reason) }), (error) => error === reason);
  });
  check(`${prefix}C7/cancellation-during-comparison`, () => {
    const controller = new AbortController();
    const reason = new Error('independent recursive comparison abort');
    const instance = new api.HistoryModel(patternP(), 'aaaa', { signal: controller.signal });
    const histories = [instance.build([[2], null]), instance.build([[1, 1, 1], null])];
    const original = instance.meter.charge.bind(instance.meter);
    let comparisons = 0;
    instance.meter.charge = (work, allocation) => {
      if (work === 16 && allocation === 4 && ++comparisons === 2) controller.abort(reason);
      return original(work, allocation);
    };
    assert.throws(() => instance.rank(histories, policies[1]), (error) => error === reason);
    assert.equal(comparisons, 2);
  });
  check(`${prefix}C7/cumulative-failed-build`, () => {
    const instance = new api.HistoryModel(patternP(), 'aaa');
    const before = instance.meter.allocation;
    refuses(() => instance.build([[3, 0], null]), 'OPTIONAL_TAIL');
    assert(instance.meter.allocation > before);
    assert.equal(instance.builtCount, 0);
  });
}

function mergeControls(api, prefix = '') {
  const instance = new api.HistoryModel(repeat(group(1, aStar())), 'aaaa');
  const first = instance.build([3, 1]);
  const second = instance.build([2, 1, 1]);
  check(`${prefix}C8/same-final-env-distinct-history`, () => {
    const registers = (history) => history.env.map(({ state, start, end }) => ({ state, start, end }));
    assert.deepEqual(registers(first), registers(second));
    assert.notDeepEqual(first.tree, second.tree);
    for (const policy of policies) assert(instance.compare(first, second, policy) < 0);
  });
  check(`${prefix}C8/both-operands-retained`, () => assert.equal(instance.builtCount, 2));
}

for (const control of [orderControls, prefixControls, malformedControls, lifetimeControls, emptyControls, contextControls, limitControls, mergeControls]) {
  try { control(model); } catch (error) { results.push({ id: `${control.name}/setup`, status: 'fail', message: error.message }); }
}

const mutations = [
  { name: 'firstDFS', before: 'if (!winner || this.compare(histories[index], winner, policy) < 0) winner = histories[index];', after: 'if (!winner) winner = histories[index];', control: orderControls },
  { name: 'finalcapture-only', before: 'return compareTree(left.tree, right.tree, 0);', after: 'return (right.env[1].end - right.env[1].start) - (left.env[1].end - left.env[1].start);', control: prefixControls },
  { name: 'skip-clears', before: "event('skip', node.children[0], null, activation, count, position, position);", after: "const clear = (child) => { if (child.kind === 'group') update(child.group, 'absent'); for (const nested of child.children) clear(nested); }; if (count === 0) clear(node.children[0]); event('skip', node.children[0], null, activation, count, position, position);", control: lifetimeControls },
  { name: 'no-budget', before: "if (work > this.workLimit - this.work || allocation > this.allocationLimit - this.allocation) throw new Refusal('LIMIT');", after: '', control: limitControls },
  { name: 'badspan', before: "if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end > size) throw new Refusal('SPAN');", after: '', control: malformedControls },
];
const mutantResults = [];
for (const mutation of mutations) {
  if (source.split(mutation.before).length !== 2) {
    mutantResults.push({ name: mutation.name, status: 'not-applied', reason: 'exact mutation anchor changed' });
    continue;
  }
  const modified = source.replace(mutation.before, mutation.after);
  const api = await import(`data:text/javascript;base64,${Buffer.from(modified).toString('base64')}`);
  const start = results.length;
  try { mutation.control(api, `mutant/${mutation.name}/`); } catch (error) { results.push({ id: `mutant/${mutation.name}/setup`, status: 'fail', message: error.message }); }
  const outcomes = results.splice(start);
  const failures = outcomes.filter((result) => result.status === 'fail');
  const discriminating = failures.filter((failure) => {
    const originalId = failure.id.slice(`mutant/${mutation.name}/`.length);
    return results.some((result) => result.id === originalId && result.status === 'pass') || failure.id.endsWith('/setup');
  });
  mutantResults.push({ name: mutation.name, status: discriminating.length ? 'killed' : 'survived', sha256: createHash('sha256').update(modified).digest('hex'), discriminating: discriminating.map((result) => result.id), outcomes });
}

console.log(JSON.stringify({
  schema: 1,
  kind: 'independent-eight-control-groups',
  modelSha256: createHash('sha256').update(source).digest('hex'),
  controlsFrozenCommit: 'a5c2aed54437f68dff5708a0e652fe1e72039c21',
  modelScope: 'Supplied finite-history constructor/comparator only; no engine acceptance/completeness, native runs, worker cleanup or theorem.',
  counts: { groups: 8, assertions: results.length, passed: results.filter((result) => result.status === 'pass').length, failed: results.filter((result) => result.status === 'fail').length, mutantsKilled: mutantResults.filter((result) => result.status === 'killed').length, mutantsAttempted: mutations.length },
  untested: ['Arbitrary event replay/origin validation beyond constructor provenance', 'Independent activation-ID alpha-renaming through a supported API', 'Branch alternation AST support and parser translation', 'Actual worker cleanup and historical137', 'Regex search completeness and future prefix/cycle pruning', 'Physical RSS or asynchronous event-loop cancellation'],
  results,
  observations,
  mutants: mutantResults,
}, null, 2));
process.exitCode = results.some((result) => result.status === 'fail') ? 1 : 0;
