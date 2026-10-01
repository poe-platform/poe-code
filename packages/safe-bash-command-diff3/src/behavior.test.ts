import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtures, controls } from './fixtures.js';
import { compareDiff3, parseDiff3Arguments } from './behavior.js';

const bytes = (s: string): Uint8Array => Uint8Array.from(s, c => c.charCodeAt(0));
const limits = { inputBytes: 1000000, retainedBytes: 4000000, tokens: 10000, graphCells: 1000000, work: 20000000, outputBytes: 1000000, argumentBytes: 65536, decodedBytes: 200000, labelBytes: 65536 };
for (const control of controls.filter(c => ['core', 'corners', 'alignment', 'options', 'inventory'].includes(c.group))) {
  test(`GNU 3.12 bytes with supported status contract ${control.id}`, () => {
    // GNU 3.12 -X captured unflagged output; retain those byte checks as -x.
    const selected = control.args.map(arg => arg === '-X' && !control.args.includes('-x') ? '-x' : arg);
    const args = selected.includes('--') ? selected : [...selected, ...control.operands];
    if (control.status === 2) {
      assert.throws(() => compareDiff3((fixtures[control.id.split('/')[0]!] ?? fixtures.conflict)!.map(bytes), parseDiff3Arguments(args, limits), limits));
      return;
    }
    // Literal CR/LF labels in ed are a declared safety deviation.
    if (!control.args.includes('-m') && control.args.some(s => s.includes('\n'))) {
      assert.throws(() => parseDiff3Arguments(args, limits)); return;
    }
    const inputs = fixtures[control.id.split('/')[0]!] ?? fixtures[control.id] ?? fixtures.conflict!;
    const result = compareDiff3(inputs.map(bytes), parseDiff3Arguments(args, limits), limits);
    assert.deepEqual(result.stdout, bytes(control.stdout));
    assert.deepEqual(result.stderr, bytes(control.stderr.replaceAll('<DIFF3>', 'diff3')));
    assert.equal(result.exitCode, parseDiff3Arguments(args, limits).merge ? control.status : 0);
  });
}

test('reject external engines, unsupported selectors, unsafe ed labels and multiple stdin before input', () => {
  for (const args of [['--diff-program=anything'], ['-y'], ['-m', '-i'], ['-e', '-L', 'bad'], ['-A', '-L', 'x\rq'], ['-m', '-', '-', 'theirs']]) {
    assert.throws(() => parseDiff3Arguments([...args, ...(args.includes('-') ? [] : ['ours', 'base', 'theirs'])], limits));
  }
});
test('output, decoded label and work limits fail explicitly; pre-abort publishes nothing', () => {
  const options = parseDiff3Arguments(['-m', 'ours', 'base', 'theirs'], limits);
  for (const resource of ['outputBytes', 'retainedBytes', 'work', 'decodedBytes'] as const) {
    assert.throws(() => compareDiff3(fixtures.conflict!.map(bytes), options, { ...limits, [resource]: 1 }));
  }
  const controller = new AbortController(); controller.abort();
  assert.throws(() => compareDiff3(fixtures.conflict!.map(bytes), options, limits, controller.signal));
});
test('accounting includes comparison/rendering and metadata, with zero source decoding', () => {
  const invocation = { files: ['ours', 'base', 'theirs'], merge: true };
  const result = compareDiff3(fixtures.conflict!.map(bytes), invocation, limits);
  assert.equal(result.accounting.inputBytes, 29);
  assert.equal(result.accounting.outputBytes, result.stdout.length + result.stderr.length);
  assert.ok(result.accounting.decodedBytes >= 28);
  assert.ok(result.accounting.work > 29);
  assert.ok(result.accounting.peakRetainedBytes >= 29 + result.stdout.length);
  assert.ok(result.accounting.peakGraphCells > 0);
  assert.equal(result.accounting.retainedBytes, 0);
});
test('unflagged ed accepts newline paths; flagging refuses inherited newline labels', () => {
  assert.equal(compareDiff3(fixtures.conflict!.map(bytes), { files: ['our\ns', 'base', 'theirs'], selector: 'e' }, limits).exitCode, 0);
  assert.throws(() => compareDiff3(fixtures.conflict!.map(bytes), { files: ['our\ns', 'base', 'theirs'], selector: 'A' }, limits));
});
test('required behavior limits and information routes are validated', () => {
  const incomplete: Partial<typeof limits> = { ...limits }; delete incomplete.outputBytes;
  assert.throws(() => compareDiff3([], { files: [], information: 'version' }, incomplete as typeof limits));
  assert.throws(() => parseDiff3Arguments(['--show=bad', 'ours', 'base', 'theirs']));
});
test('flagged ed repairs dots in base sections using exact inserted addresses', () => {
  const invocation = { files: ['ours', 'base', 'theirs'], selector: 'A' as const };
  assert.deepEqual(compareDiff3(['ours\n', '.\n..\n', 'theirs\n'].map(bytes), invocation, limits).stdout,
    bytes('1a\n||||||| base\n..\n...\n=======\ntheirs\n>>>>>>> theirs\n.\n3,6s/^\\.//\n0a\n<<<<<<< ours\n.\n'));
  assert.deepEqual(compareDiff3(['new\n', '.\n', 'new\n'].map(bytes), invocation, limits).stdout,
    bytes('1a\n>>>>>>> theirs\n.\n0a\n<<<<<<< base\n..\n=======\n.\n2s/^\\.//\n'));
});
test('stdin as common remaps pairwise comparison without changing operand labels', () => {
  const result = compareDiff3(['x\ny\n', 'y\nx\n', 'x\nz\n'].map(bytes), { files: ['ours', '-', 'theirs'], merge: true }, limits);
  assert.deepEqual(result.stdout, bytes('<<<<<<< -\ny\n=======\n>>>>>>> theirs\nx\n<<<<<<< ours\ny\n||||||| -\n=======\nz\n>>>>>>> theirs\n'));
});
test('byte API refuses array-like impostors instead of coercing them into source bytes', () => {
  assert.throws(() => compareDiff3([{ length: 0 }, bytes(''), bytes('')] as unknown as Uint8Array[], { files: ['ours', 'base', 'theirs'], text: true }, limits));
});
test('SDK metadata does not invoke borrowed array methods or unrelated property getters', () => {
  const files: string[] = [];
  Object.defineProperty(files, 'map', { value() { throw new Error('Borrowed method used'); } });
  const invocation = { files, information: 'version' as const };
  Object.defineProperty(invocation, 'unrelated', { enumerable: true, get() { throw new Error('Unrelated property read'); } });
  assert.equal(compareDiff3([], invocation, limits).exitCode, 0);
});

for (const selector of ['X', 'E', 'A'] as const) {
  test(`flagged ${selector} scripts succeed while merges report conflicts`, () => {
    const inputs = ['a\nb_mine\nc\nd\ne_mine\n', 'a\nb\nc\nd\ne\n', 'a\nb\nc\nd_yours\ne_yours\n'].map(bytes);
    const script = compareDiff3(inputs, parseDiff3Arguments([`-${selector}`, '/mine', '/older', '/yours'], limits), limits);
    assert.equal(script.exitCode, 0);
    if (selector !== 'A') assert.deepEqual(script.stdout, bytes('5a\n=======\nd_yours\ne_yours\n>>>>>>> /yours\n.\n3a\n<<<<<<< /mine\n.\n'));
    const merge = compareDiff3(inputs, parseDiff3Arguments([`-m${selector}`, '/mine', '/older', '/yours'], limits), limits);
    assert.equal(merge.exitCode, 1);
    if (selector !== 'A') assert.deepEqual(merge.stdout, bytes('a\nb_mine\nc\n<<<<<<< /mine\nd\ne_mine\n=======\nd_yours\ne_yours\n>>>>>>> /yours\n'));
  });
}

test('overlap-only markers admit labels and reject unsafe ed labels', () => {
  const options = parseDiff3Arguments(['-X', '-L', 'mine', 'ours', 'base', 'theirs'], limits);
  assert.ok(new TextDecoder().decode(compareDiff3(fixtures.conflict!.map(bytes), options, limits).stdout).includes('<<<<<<< mine'));
  assert.throws(() => parseDiff3Arguments(['-X', '-L', 'bad\nlabel', 'ours', 'base', 'theirs'], limits));
  assert.throws(() => parseDiff3Arguments(['-X', 'bad\npath', 'base', 'theirs'], limits));
});

test('X excludes non-overlapping changes while preserving merge source', () => {
  const inputs = ['a\nb\nc\n', 'a\nb\nc\n', 'a\nyours\nc\n'].map(bytes);
  const files = ['ours', 'base', 'theirs'];
  const script = compareDiff3(inputs, { files, selector: 'X' }, limits);
  assert.equal(script.exitCode, 0);
  assert.deepEqual(script.stdout, bytes(''));
  const merge = compareDiff3(inputs, { files, selector: 'X', merge: true }, limits);
  assert.equal(merge.exitCode, 0);
  assert.deepEqual(merge.stdout, inputs[0]);
});
