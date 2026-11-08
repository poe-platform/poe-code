import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const bytes = await readFile(process.argv[2]);
const inputs = JSON.parse(bytes);
const results = [];
for (const supplied of inputs.histories) {
  const completions = {};
  const env = new Map();
  const refs = [];
  let position = 0;
  let nodes = 0;
  const initialize = (spec) => {
    if (spec[0] === 'group') completions[spec[1]] = [];
    const children = spec[0] === 'cat' ? spec.slice(1) : spec[0] === 'group' ? [spec[2]] : spec[0] === 'repeat' ? [spec[3]] : [];
    for (const child of children) initialize(child);
  };
  const visit = (spec, plan) => {
    nodes++;
    const start = position;
    const kind = spec[0];
    if (kind === 'cat') {
      assert.equal(plan.length, spec.length - 1);
      for (let index = 1; index < spec.length; index++) visit(spec[index], plan[index - 1]);
    } else if (kind === 'group') {
      env.set(spec[1], null);
      visit(spec[2], plan);
      const span = [start, position];
      completions[spec[1]].push(span);
      env.set(spec[1], { span, completion: completions[spec[1]].length - 1 });
    } else if (kind === 'repeat') {
      const abbreviated = Number.isSafeInteger(plan);
      if (abbreviated) assert.equal(spec[3][0], 'byte');
      const count = abbreviated ? plan : plan.length;
      assert(count >= spec[1] && count <= 32 && (spec[2] === null || count <= spec[2]));
      for (let index = 0; index < count; index++) visit(spec[3], abbreviated ? null : plan[index]);
    } else if (kind === 'byte') {
      assert.equal(plan, null);
      assert.equal(supplied.subject[position], spec[1]);
      position++;
    } else if (kind === 'ref') {
      assert.equal(plan, null);
      const capture = env.get(spec[1]);
      assert(capture);
      const value = supplied.subject.slice(...capture.span);
      assert.equal(supplied.subject.slice(position, position + value.length), value);
      position += value.length;
      refs.push({ group: spec[1], completion: capture.completion, span: [start, position] });
    } else assert.fail(`unknown AST kind ${kind}`);
    assert(position <= supplied.subject.length);
  };
  try {
    initialize(inputs.asts[supplied.ast].tree);
    visit(inputs.asts[supplied.ast].tree, supplied.plan);
    assert.deepEqual([0, position], supplied.whole);
    assert.deepEqual(completions, supplied.captureCompletions);
    assert.deepEqual(refs, supplied.refs);
    results.push({ id: supplied.id, status: 'pass', occurrences: nodes, whole: [0, position], captureCompletions: completions, refs });
  } catch (error) {
    results.push({ id: supplied.id, status: 'fail', message: error.message, captureCompletions: completions, refs });
  }
}
console.log(JSON.stringify({ schema: 1, inputsSha256: createHash('sha256').update(bytes).digest('hex'), scope: 'Independent exact-AST/permissive-plan byte, complete capture-lifetime and reference-origin derivation. No candidate code, ranking, search, native or old cohort execution.', counts: { histories: results.length, passed: results.filter((item) => item.status === 'pass').length, failed: results.filter((item) => item.status === 'fail').length }, results }, null, 2));
process.exitCode = results.some((item) => item.status === 'fail') ? 1 : 0;
