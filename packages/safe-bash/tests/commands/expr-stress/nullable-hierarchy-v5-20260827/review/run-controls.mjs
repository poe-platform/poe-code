import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { deriveTree, expectedComparison } from './oracle.mjs';

const [modulePath, bindingPath] = process.argv.slice(2);
if (!modulePath || !bindingPath) throw new Error('usage: node run-controls.mjs MODEL BINDING');
const controls = JSON.parse(await readFile(new URL('./CONTROLS.json', import.meta.url)));
const binding = JSON.parse(await readFile(bindingPath));
const api = await import(pathToFileURL(modulePath).href);
const source = await readFile(modulePath, 'utf8');
const results = [];
const observations = [];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const profiles = Object.entries(binding.profiles);
const refuses = (action, code) => assert.throws(action, (error) => error?.code === code);
const check = (id, action) => {
  try {
    action();
    results.push({ id, status: 'pass' });
  } catch (error) {
    results.push({ id, status: 'fail', message: error.message, code: error.code });
  }
};
const supplied = (name, implementation = api, options = {}) => {
  const entry = controls.cases.find((item) => item.id === name);
  assert(entry, name);
  const instance = new implementation.HistoryModel(controls.asts[entry.ast], entry.subject, options);
  const histories = entry.plans.map((plan) => instance.build(plan, entry.tail ?? true));
  return { entry, instance, histories };
};
const permutations = (items) => items.length === 0 ? [[]] : items.flatMap((item, index) => permutations(items.filter((_, other) => index !== other)).map((rest) => [item, ...rest]));
const registers = (history) => history.env.map(({ state, start, end }) => ({ state, start, end }));

function validateTrace(spec, subject, plan, history) {
  const activations = new Map();
  const expectedEvents = [];
  const stack = [];
  const state = Array.from({ length: history.env.length }, () => ({ state: 'absent' }));
  const walk = (nodeSpec, choice, tree, parent, ordinal, nodeId, start) => {
    assert.equal(tree.node.kind, nodeSpec[0]);
    assert.equal(tree.node.id, nodeId);
    assert.equal(tree.parent, parent);
    assert.equal(tree.ordinal, ordinal);
    assert.equal(tree.start, start);
    assert(!activations.has(tree.activation));
    activations.set(tree.activation, tree);
    expectedEvents.push({ type: 'enter', tree });
    let position = start;
    const kind = nodeSpec[0];
    if (kind === 'cat') {
      assert.equal(tree.children.length, nodeSpec.length - 1);
      assert.equal(choice.length, tree.children.length);
      tree.children.forEach((child, index) => {
        position = walk(nodeSpec[index + 1], choice[index], child, tree.activation, null, `${nodeId}.${index}`, position);
      });
    } else if (kind === 'group') {
      assert.equal(tree.node.group, nodeSpec[1]);
      assert.equal(tree.children.length, 1);
      position = walk(nodeSpec[2], choice, tree.children[0], tree.activation, null, `${nodeId}.0`, position);
    } else if (kind === 'repeat') {
      const count = Number.isSafeInteger(choice) ? choice : choice.length;
      assert.equal(tree.children.length, count);
      assert(count >= nodeSpec[1] && (nodeSpec[2] === null || count <= nodeSpec[2]));
      tree.children.forEach((child, index) => {
        position = walk(nodeSpec[3], Number.isSafeInteger(choice) ? null : choice[index], child, tree.activation, index, `${nodeId}.0`, position);
      });
      expectedEvents.push({ type: 'skip', tree, position, count });
    } else {
      assert.equal(choice, null);
      assert.equal(tree.children.length, 0);
      if (kind === 'byte') {
        assert.equal(tree.node.byte, nodeSpec[1]);
        assert.equal(subject[start], nodeSpec[1]);
        position++;
      } else {
        assert.equal(tree.node.group, nodeSpec[1]);
        position = tree.end;
      }
    }
    assert.equal(tree.end, position);
    assert(Number.isSafeInteger(tree.start) && Number.isSafeInteger(tree.end));
    assert(0 <= tree.start && tree.start <= tree.end && tree.end <= subject.length);
    expectedEvents.push({ type: 'exit', tree });
    return position;
  };
  walk(spec, plan, history.tree, null, null, 'r', 0);
  assert.equal(expectedEvents.length, history.events.length);
  for (let index = 0; index < expectedEvents.length; index++) {
    const expected = expectedEvents[index];
    const event = history.events[index];
    const tree = expected.tree;
    assert.equal(event.type, expected.type);
    if (event.type === 'skip') {
      assert.equal(event.activation, null);
      assert.equal(event.node, tree.node.children[0].id);
      assert.equal(event.parent, tree.activation);
      assert.equal(event.ordinal, expected.count);
      assert.equal(event.start, expected.position);
      assert.equal(event.end, expected.position);
    } else {
      assert.equal(event.activation, tree.activation);
      assert.equal(event.node, tree.node.id);
      assert.equal(event.parent, tree.parent);
      assert.equal(event.ordinal, tree.ordinal);
      assert.equal(event.start, tree.start);
      if (event.type === 'enter') {
        assert.equal(event.end, undefined);
        assert.equal(tree.parent, stack.at(-1)?.activation ?? null);
        stack.push(tree);
        if (tree.node.kind === 'group') state[tree.node.group] = { state: 'open', start: tree.start, end: undefined, activation: tree.activation };
      } else {
        assert.equal(stack.pop(), tree);
        assert.equal(event.end, tree.end);
        if (tree.node.kind === 'group') state[tree.node.group] = { state: tree.start === tree.end ? 'completed-empty' : 'completed-nonempty', start: tree.start, end: tree.end, activation: tree.activation };
        if (tree.node.kind === 'ref') {
          const capture = state[tree.node.group];
          assert(capture.state === 'completed-empty' || capture.state === 'completed-nonempty');
          assert.equal(tree.end - tree.start, capture.end - capture.start);
          assert.equal(subject.slice(tree.start, tree.end), subject.slice(capture.start, capture.end));
          const origin = activations.get(capture.activation);
          assert(origin && origin.node.kind === 'group');
          assert.equal(origin.node.group, tree.node.group);
          assert.equal(origin.start, capture.start);
          assert.equal(origin.end, capture.end);
        }
      }
    }
    assert.deepEqual(event.env, state);
  }
  assert.equal(stack.length, 0);
  assert.deepEqual(history.env, state);
}

function group1(implementation = api, prefix = '') {
  for (const [profile, policy] of profiles) {
    for (const name of ['P4', 'prefix', 'boundedPrefix', 'nestedPrefix']) check(`${prefix}G1/${profile}/${name}`, () => {
      const { entry, instance, histories } = supplied(name, implementation);
      assert.equal(instance.rank(histories, policy), histories[entry.winner[profile]]);
      const expected = entry.plans.map((plan) => deriveTree(controls.asts[entry.ast], entry.subject, plan));
      for (let first = 0; first < histories.length; first++) for (let second = 0; second < histories.length; second++) assert.equal(Math.sign(instance.compare(histories[first], histories[second], policy)) || 0, Math.sign(expectedComparison(expected[first], expected[second], profile)) || 0);
    });
    check(`${prefix}G1/${profile}/all24-orders`, () => {
      for (const permutation of permutations([0, 1, 2, 3])) {
        const { instance, histories } = supplied('P4', implementation);
        assert.equal(instance.rank(permutation.map((index) => histories[index]), policy), histories[1]);
      }
    });
    check(`${prefix}G1/${profile}/finite-order-laws`, () => {
      for (let first = 0; first < 4; first++) for (let second = 0; second < 4; second++) for (let third = 0; third < 4; third++) {
        const { instance, histories } = supplied('P4', implementation);
        const forward = instance.compare(histories[first], histories[second], policy);
        const backward = instance.compare(histories[second], histories[first], policy);
        assert.equal(Math.sign(forward) + Math.sign(backward), 0);
        if (first === second) assert.equal(forward, 0);
        if (forward <= 0 && instance.compare(histories[second], histories[third], policy) <= 0) assert(instance.compare(histories[first], histories[third], policy) <= 0);
      }
    });
  }
  check(`${prefix}G1/over-max`, () => {
    const { instance } = supplied('boundedPrefix', implementation);
    refuses(() => instance.build([3, 0]), 'MAXIMUM');
  });
}

function group2(implementation = api, prefix = '') {
  for (const [profile, policy] of profiles) {
    check(`${prefix}G2/${profile}/initial-participation`, () => {
      const { instance, histories } = supplied('emptyBody', implementation);
      assert(instance.compare(histories[1], histories[0], policy) < 0);
      assert.equal(histories[0].env[1].state, 'absent');
      assert.equal(histories[1].env[1].state, 'completed-empty');
    });
    check(`${prefix}G2/${profile}/END-after-prefix`, () => {
      const { instance, histories } = supplied('emptyBody', implementation);
      assert(instance.compare(histories[1], histories[2], policy) < 0);
    });
    check(`${prefix}G2/${profile}/permissive-tail-not-cycle`, () => {
      const { instance, histories } = supplied('P3', implementation);
      assert.equal(instance.rank(histories, policy), histories[1]);
      assert.deepEqual([histories[0].env[1].start, histories[0].env[1].end], [1, 2]);
      assert.deepEqual([histories[1].env[1].start, histories[1].env[1].end], [3, 3]);
      assert.notDeepEqual(registers(histories[0]), registers(histories[1]));
    });
  }
  check(`${prefix}G2/LOCAL-TAIL-HYPOTHESIS-only`, () => {
    const { instance, entry } = supplied('P3', implementation);
    refuses(() => instance.build(entry.plans[1], true), 'OPTIONAL_TAIL');
    assert.equal(instance.build(entry.plans[0], true).env[1].state, 'completed-nonempty');
  });
  check(`${prefix}G2/required-two`, () => {
    const { instance, histories } = supplied('Q0', implementation);
    assert.equal(histories[0].tree.children[0].children.length, 2);
    refuses(() => instance.build([[0], null]), 'MINIMUM');
  });
  for (const name of ['requiredChild', 'requiredPrefix']) check(`${prefix}G2/${name}/local-counts`, () => {
    const { entry, histories } = supplied(name, implementation);
    validateTrace(controls.asts[entry.ast], entry.subject, entry.plans[0], histories[0]);
    const entries = histories[0].events.filter((event) => event.type === 'enter' && event.ordinal !== null);
    assert(entries.some((event) => event.ordinal === 1));
    assert.equal(histories[0].tree.end, entry.ends[0]);
  });
}

function group3(implementation = api, prefix = '') {
  for (const [profile, policy] of profiles) for (const name of ['W3', 'W4', 'W4bare', 'W4wrapped']) check(`${prefix}G3/${profile}/${name}`, () => {
    const { entry, instance, histories } = supplied(name, implementation);
    assert.equal(instance.rank(histories, policy), histories[entry.winner[profile]]);
    assert(instance.compare(histories[entry.winner[profile]], histories[1 - entry.winner[profile]], policy) < 0);
    const expected = entry.plans.map((plan) => deriveTree(controls.asts[entry.ast], entry.subject, plan));
    assert.equal(Math.sign(instance.compare(histories[0], histories[1], policy)), Math.sign(expectedComparison(expected[0], expected[1], profile)));
  });
}

function group4(implementation = api, prefix = '') {
  check(`${prefix}G4/TEMP-origin-not-final-parent`, () => {
    const { entry, histories } = supplied('D', implementation);
    const history = histories[0];
    validateTrace(controls.asts.D, entry.subject, entry.plans[0], history);
    assert.deepEqual([history.env[1].start, history.env[1].end], [2, 3]);
    assert.deepEqual([history.env[2].start, history.env[2].end], [1, 2]);
    const childEntry = history.events.find((event) => event.type === 'enter' && event.activation === history.env[2].activation);
    assert(childEntry);
    assert.notEqual(childEntry.parent, history.env[1].activation);
  });
  check(`${prefix}G4/failed-branch-isolation`, () => {
    const { instance, histories, entry } = supplied('D', implementation);
    const before = JSON.stringify(histories[0]);
    assert.throws(() => instance.build([[[null, [null]], [null, [null]]], null]));
    assert.equal(JSON.stringify(histories[0]), before);
    assert.deepEqual(instance.build(entry.plans[0]).env, histories[0].env);
    assert.equal(instance.builtCount, 2);
  });
  for (const [name, span] of [['Dreentry', [3, 4]], ['E', [3, 3]]]) check(`${prefix}G4/${name}/open-replace`, () => {
    const { entry, histories } = supplied(name, implementation);
    const history = histories[0];
    validateTrace(controls.asts[entry.ast], entry.subject, entry.plans[0], history);
    assert.deepEqual([history.env[2].start, history.env[2].end], span);
    const entries = history.events.filter((event) => event.type === 'enter' && event.env[2]?.state === 'open');
    assert(entries.length >= 2);
    assert.notEqual(entries[0].env[2].activation, history.env[2].activation);
  });
}

function group5(implementation = api, prefix = '') {
  for (const entry of controls.cases) check(`${prefix}G5/${entry.id}/exact-AST-subject-trace`, () => {
    const { histories } = supplied(entry.id, implementation);
    histories.forEach((history, index) => {
      assert.equal(history.tree.end, entry.ends[index]);
      validateTrace(controls.asts[entry.ast], entry.subject, entry.plans[index], history);
    });
  });
  for (const [name, start, end] of [['negative', -1, 2], ['reversed', 2, 1], ['fractional', 0.5, 2], ['beyond', 0, 5], ['unsafe', 0, Number.MAX_SAFE_INTEGER + 1]]) check(`${prefix}G5/span/${name}`, () => refuses(() => implementation.checkSpan(new implementation.Meter(), start, end, 4), 'SPAN'));
  for (const mutation of ['parent', 'ordinal', 'span', 'unclosed', 'origin']) check(`${prefix}G5/forged-${mutation}/ownership-only`, () => {
    const { instance, histories } = supplied('P4', implementation);
    const history = histories[0];
    const forged = { ...history, tree: { ...history.tree } };
    if (mutation === 'parent') forged.tree.parent = 42;
    if (mutation === 'ordinal') forged.tree.ordinal = 7;
    if (mutation === 'span') forged.tree.end = 5;
    if (mutation === 'unclosed') forged.events = history.events.slice(0, -1);
    if (mutation === 'origin') forged.env = history.env.map((capture) => ({ ...capture, activation: -1 }));
    refuses(() => instance.compare(forged, history, profiles[0][1]), 'UNVALIDATED');
  });
  check(`${prefix}G5/expected-span`, () => {
    const { instance, histories } = supplied('P4', implementation);
    refuses(() => instance.validateExpected(histories[0], [0, 4], [[2, 1]]), 'SPAN');
  });
  check(`${prefix}G5/missing-plan-child`, () => {
    const { instance } = supplied('P4', implementation);
    refuses(() => instance.build([[2]]), 'PLAN');
  });
}

function group6(implementation = api, prefix = '') {
  check(`${prefix}G6/same-position-different-env`, () => {
    const { instance, histories } = supplied('D', implementation);
    assert.equal(instance.reference(histories[0].env[2], 3), 4);
    refuses(() => instance.reference({ state: 'absent' }, 3), 'REFERENCE');
    refuses(() => instance.reference({ state: 'open', start: 3, activation: 7 }, 3), 'REFERENCE');
    const empty = supplied('emptyRef', implementation);
    assert.equal(empty.instance.reference(empty.histories[0].env[2], 1), 1);
  });
  for (const [profile, policy] of profiles) check(`${prefix}G6/${profile}/no-merge-equivalent-rebuild`, () => {
    const { entry, instance, histories } = supplied('W3', implementation);
    assert.deepEqual(registers(histories[0]), registers(histories[1]));
    assert.notDeepEqual(histories[0].tree, histories[1].tree);
    assert.equal(instance.builtCount, 2);
    assert(instance.compare(histories[0], histories[1], policy) < 0);
    assert.equal(instance.compare(histories[0], instance.build(entry.plans[0]), policy), 0);
    assert.equal(instance.builtCount, 3);
  });
}

function group7(implementation = api, prefix = '') {
  for (const kind of ['work', 'allocation']) {
    check(`${prefix}G7/${kind}/zero`, () => refuses(() => new implementation.Meter({ [kind]: 0 }), 'LIMIT'));
    check(`${prefix}G7/${kind}/failed-build-cumulative`, () => {
      const { instance } = supplied('P4', implementation);
      const before = instance.meter[kind];
      refuses(() => instance.build([[5], null]), 'BYTE');
      assert(instance.meter[kind] > before);
      const used = instance.meter[kind];
      instance.meter[`${kind}Limit`] = used;
      refuses(() => instance.build([[2], null]), 'LIMIT');
      assert.equal(instance.meter[kind], used);
    });
    for (const [profile, policy] of profiles) {
      check(`${prefix}G7/${profile}/${kind}/after-incumbent`, () => {
        const { instance, histories } = supplied('P4', implementation);
        const original = instance.owned.bind(instance);
        let admissions = 0;
        instance.owned = (history) => {
          original(history);
          if (++admissions === 1) instance.meter[`${kind}Limit`] = instance.meter[kind];
        };
        refuses(() => instance.rank(histories, policy), 'LIMIT');
        assert(admissions >= 1);
      });
      check(`${prefix}G7/${profile}/${kind}/comparison-preadmission`, () => {
        const { instance, histories } = supplied('W4', implementation);
        const used = instance.meter[kind];
        instance.meter[`${kind}Limit`] = used;
        refuses(() => instance.compare(histories[0], histories[1], policy), 'LIMIT');
        assert.equal(instance.meter[kind], used);
      });
    }
  }
  check(`${prefix}G7/candidate-state-cap`, () => {
    const instance = new implementation.HistoryModel(controls.asts.emptyBody, '', { candidates: 1 });
    instance.build([]);
    refuses(() => instance.build([0]), 'CANDIDATES');
    assert.equal(instance.builtCount, 1);
  });
  check(`${prefix}G7/events-cap`, () => {
    const instance = new implementation.HistoryModel(controls.asts.P, 'aaaa', { events: 1 });
    refuses(() => instance.build([[2], null]), 'EVENTS');
    assert.equal(instance.builtCount, 0);
  });
  check(`${prefix}G7/depth-cap`, () => refuses(() => new implementation.HistoryModel(controls.asts.P, 'aaaa', { depth: 0 }), 'DEPTH'));
  check(`${prefix}G7/input-cap`, () => refuses(() => new implementation.HistoryModel(controls.asts.P, 'a'.repeat(33)), 'INPUT'));
  check(`${prefix}G7/nodes-cap`, () => {
    const leaf = ['byte', 'a'];
    const branch = ['cat', ...Array.from({ length: 16 }, () => leaf)];
    refuses(() => new implementation.HistoryModel(['cat', branch, branch, branch, branch], ''), 'NODES');
  });
  check(`${prefix}G7/repeat-count-cap`, () => {
    const instance = new implementation.HistoryModel(controls.asts.emptyBody, '');
    refuses(() => instance.build(Array(33).fill(0), false), 'MAXIMUM');
  });
  for (const [name, maximum] of [['depth', 24], ['events', 2048], ['candidates', 32]]) check(`${prefix}G7/${name}/no-cap-raise`, () => refuses(() => new implementation.HistoryModel(controls.asts.P, '', { [name]: maximum + 1 }), 'CAP'));
}

function group8(implementation = api, prefix = '') {
  check(`${prefix}G8/exact-initial-abort`, () => {
    const reason = Object.freeze({ label: 'independent-initial', code: 'ENOENT' });
    assert.throws(() => new implementation.Meter({ signal: AbortSignal.abort(reason) }), (error) => error === reason);
  });
  for (const [profile, policy] of profiles) {
    check(`${prefix}G8/${profile}/exact-after-incumbent`, () => {
      const controller = new AbortController();
      const reason = Object.freeze({ label: 'independent-incumbent', code: 'EIO' });
      const { instance, histories } = supplied('P4', implementation, { signal: controller.signal });
      const original = instance.owned.bind(instance);
      instance.owned = (history) => { original(history); controller.abort(reason); };
      assert.throws(() => instance.rank(histories, policy), (error) => error === reason);
    });
    check(`${prefix}G8/${profile}/exact-during-comparison`, () => {
      const controller = new AbortController();
      const reason = Object.freeze({ label: 'independent-comparison' });
      const { instance, histories } = supplied('W4', implementation, { signal: controller.signal });
      const original = instance.meter.charge.bind(instance.meter);
      let checkpoints = 0;
      instance.meter.charge = (work, allocation) => {
        if (++checkpoints === 12) controller.abort(reason);
        return original(work, allocation);
      };
      assert.throws(() => instance.compare(histories[0], histories[1], policy), (error) => error === reason);
      assert.equal(checkpoints, 12);
    });
  }
}

const groups = [group1, group2, group3, group4, group5, group6, group7, group8];
for (const group of groups) {
  try { group(); } catch (error) { results.push({ id: `${group.name}/setup`, status: 'fail', message: error.message }); }
}
for (const [profile, policy] of profiles) {
  check(`historical-conflict-observation/${profile}/literal-B-vs-old-C1-A`, () => {
    const { instance, histories } = supplied('P4');
    const comparison = instance.compare(histories[0], histories[1], policy);
    observations.push({ id: 'old-C1-not-rescored', profile, actualPairWinner: comparison < 0 ? 'A' : comparison > 0 ? 'B' : 'tie', frozenV4Expectation: 'A', newLiteralExpectation: 'B', oldAssertionSatisfied: comparison < 0 });
    assert(comparison > 0);
  });
}

const mutations = binding.mutations ?? [];
assert(mutations.length <= 5);
const mutantResults = [];
for (const mutation of mutations) {
  if (source.split(mutation.before).length !== 2) {
    mutantResults.push({ name: mutation.name, status: 'not-applied', reason: 'unique exact anchor missing' });
    continue;
  }
  const modified = source.replace(mutation.before, mutation.after);
  const implementation = await import(`data:text/javascript;base64,${Buffer.from(modified).toString('base64')}`);
  const start = results.length;
  const prefix = `mutant/${mutation.name}/`;
  for (const number of mutation.groups) {
    try { groups[number - 1](implementation, prefix); } catch (error) { results.push({ id: `${prefix}G${number}/setup`, status: 'fail', message: error.message }); }
  }
  const outcomes = results.splice(start);
  const additionalFailures = outcomes.filter((item) => item.status === 'fail' && results.some((baseline) => baseline.id === item.id.slice(prefix.length) && baseline.status === 'pass'));
  mutantResults.push({ name: mutation.name, status: additionalFailures.length ? 'killed' : 'survived', sha256: hash(modified), additionalFailures: additionalFailures.map((item) => item.id), outcomes });
}
const grouped = Object.fromEntries(Array.from({ length: 8 }, (_, index) => {
  const name = `G${index + 1}/`;
  const subset = results.filter((item) => item.id.startsWith(name));
  return [name.slice(0, -1), { assertions: subset.length, passed: subset.filter((item) => item.status === 'pass').length, failed: subset.filter((item) => item.status === 'fail').length }];
}));
console.log(JSON.stringify({
  schema: 1,
  controlsCommit: '18104988c32c467e4025743927c20ee80eaa1781',
  controlsSha256: hash(await readFile(new URL('./CONTROLS.json', import.meta.url))),
  modelSha256: hash(source),
  binding,
  counts: { groups: 8, newHistories: 5, assertions: results.length, passed: results.filter((item) => item.status === 'pass').length, failed: results.filter((item) => item.status === 'fail').length, mutantsAttempted: mutations.length, mutantsKilled: mutantResults.filter((item) => item.status === 'killed').length, actualWorkers: 0 },
  grouped,
  results,
  observations,
  mutants: mutantResults,
  limits: controls.v4Limits,
  scope: 'New supplied-history review only; no v4 rescore, native/product execution, generic external-log validator, async preemption, worker cleanup or promotion claim.',
}, null, 2));
process.exitCode = results.some((item) => item.status === 'fail') ? 1 : 0;
