import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const bytes = await readFile(new URL('./CONTROLS.json', import.meta.url));
const controls = JSON.parse(bytes);
const derivations = [];
for (const entry of controls.cases) {
  const histories = entry.plans.map((plan, index) => {
    let position = 0;
    const env = new Map();
    const occurrences = [];
    const references = [];
    const visit = (spec, choice, path, context) => {
      const start = position;
      const kind = spec[0];
      const occurrence = { path, context, kind, start, end: null };
      occurrences.push(occurrence);
      if (kind === 'cat') {
        assert.equal(choice.length, spec.length - 1);
        for (let child = 1; child < spec.length; child++) visit(spec[child], choice[child - 1], `${path}.${child - 1}`, context);
      } else if (kind === 'group') {
        env.set(spec[1], { state: 'open' });
        visit(spec[2], choice, `${path}.0`, context);
        env.set(spec[1], { state: position === start ? 'completed-empty' : 'completed-nonempty', start, end: position, origin: { path, context } });
      } else if (kind === 'repeat') {
        const abbreviated = Number.isSafeInteger(choice);
        if (abbreviated) assert.equal(spec[3][0], 'byte');
        const count = abbreviated ? choice : choice.length;
        assert(count >= spec[1] && (spec[2] === null || count <= spec[2]));
        assert(count <= 32);
        for (let ordinal = 0; ordinal < count; ordinal++) visit(spec[3], abbreviated ? null : choice[ordinal], `${path}.0`, [...context, ordinal]);
      } else if (kind === 'byte') {
        assert.equal(choice, null);
        assert.equal(entry.subject[position], spec[1]);
        position++;
      } else if (kind === 'ref') {
        assert.equal(choice, null);
        const capture = env.get(spec[1]);
        assert(capture && capture.state !== 'open');
        const value = entry.subject.slice(capture.start, capture.end);
        assert.equal(entry.subject.slice(position, position + value.length), value);
        position += value.length;
        references.push({ group: spec[1], consumed: [start, position], origin: capture.origin, capture: [capture.start, capture.end] });
      } else assert.fail(`unsupported exact AST kind ${kind}`);
      assert(position <= entry.subject.length);
      occurrence.end = position;
    };
    visit(controls.asts[entry.ast], plan, 'r', []);
    assert.equal(position, entry.ends[index]);
    return { index, classification: entry.newIndices?.includes(index) ? 'new-supplied-history' : 'reused-v4-or-independent32-plan', whole: [0, position], captures: Object.fromEntries(env), occurrences, references };
  });
  derivations.push({ id: entry.id, ast: entry.ast, subject: entry.subject, histories });
}
assert.equal(derivations.flatMap((entry) => entry.histories).filter((history) => history.classification === 'new-supplied-history').length, 5);
const pair = derivations.find((entry) => entry.id === 'P4').histories;
assert.deepEqual(pair.slice(0, 2).map((history) => history.occurrences.find((occurrence) => occurrence.path === 'r.0').end), [2, 3]);
console.log(JSON.stringify({ schema: 1, controlsSha256: createHash('sha256').update(bytes).digest('hex'), candidateCodeInspected: false, histories: derivations.reduce((sum, entry) => sum + entry.histories.length, 0), newHistories: 5, cases: derivations.length, scope: 'Independent byte/AST/reference derivation, no model import or native execution, not a comparator or parser-equivalence proof.', derivations }, null, 2));
