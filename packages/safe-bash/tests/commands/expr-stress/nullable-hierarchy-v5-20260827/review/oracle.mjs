import assert from 'node:assert/strict';

export function deriveTree(spec, subject, plan) {
  let position = 0;
  const env = new Map();
  const visit = (node, choice) => {
    const kind = node[0];
    const start = position;
    const children = [];
    if (kind === 'cat') {
      assert.equal(choice.length, node.length - 1);
      for (let index = 1; index < node.length; index++) children.push(visit(node[index], choice[index - 1]));
    } else if (kind === 'group') {
      env.set(node[1], null);
      children.push(visit(node[2], choice));
      env.set(node[1], [start, position]);
    } else if (kind === 'repeat') {
      const abbreviated = Number.isSafeInteger(choice);
      if (abbreviated) assert.equal(node[3][0], 'byte');
      const count = abbreviated ? choice : choice.length;
      assert(count >= node[1] && count <= 32 && (node[2] === null || count <= node[2]));
      for (let index = 0; index < count; index++) children.push(visit(node[3], abbreviated ? null : choice[index]));
    } else if (kind === 'byte') {
      assert.equal(choice, null);
      assert.equal(subject[position], node[1]);
      position++;
    } else if (kind === 'ref') {
      assert.equal(choice, null);
      const capture = env.get(node[1]);
      assert(capture);
      const value = subject.slice(...capture);
      assert.equal(subject.slice(position, position + value.length), value);
      position += value.length;
    } else assert.fail(kind);
    return { kind, start, end: position, children };
  };
  return visit(spec, plan);
}

const semantic = (tree) => tree.kind === 'group' ? semantic(tree.children[0]) : tree;
const span = (left, right) => left.start - right.start || right.end - left.end;
const terminal = (left, right) => left.length === 0 || right.length === 0 ? right.length - left.length : left.length - right.length;

function dynamic(leftRaw, rightRaw) {
  const left = semantic(leftRaw);
  const right = semantic(rightRaw);
  assert.equal(left.kind, right.kind);
  const extent = span(left, right);
  if (extent) return extent;
  for (let index = 0; index < Math.min(left.children.length, right.children.length); index++) {
    const result = dynamic(left.children[index], right.children[index]);
    if (result) return result;
  }
  return terminal(left.children, right.children);
}

function staticContexts(leftRaw, rightRaw) {
  assert.equal(leftRaw.length, rightRaw.length);
  const left = leftRaw.map((context) => context.map(semantic));
  const right = rightRaw.map((context) => context.map(semantic));
  for (let context = 0; context < left.length; context++) {
    for (let index = 0; index < Math.min(left[context].length, right[context].length); index++) {
      const extent = span(left[context][index], right[context][index]);
      if (extent) return extent;
    }
    const ending = terminal(left[context], right[context]);
    if (ending) return ending;
  }
  const first = left.flat()[0];
  if (!first) return 0;
  if (first.kind === 'repeat') return staticContexts(left.flat().map((node) => node.children), right.flat().map((node) => node.children));
  if (first.kind === 'cat') {
    for (let child = 0; child < first.children.length; child++) {
      const result = staticContexts(left.flat().map((node) => [node.children[child]]), right.flat().map((node) => [node.children[child]]));
      if (result) return result;
    }
  }
  return 0;
}

export function expectedComparison(left, right, profile) {
  const whole = span(left, right);
  if (whole) return whole;
  if (profile === 'NODE') return staticContexts([[left]], [[right]]);
  assert.equal(profile, 'TREE');
  return dynamic(left, right);
}
