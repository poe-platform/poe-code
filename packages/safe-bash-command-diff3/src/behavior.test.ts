import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtures, controls } from './fixtures.js';
import { compareDiff3, parseDiff3Arguments } from './behavior.js';

const bytes = (s: string): Uint8Array => Uint8Array.from(s, c => c.charCodeAt(0));
const limits = { inputBytes: 1000000, retainedBytes: 4000000, tokens: 10000, graphCells: 1000000, work: 20000000, outputBytes: 1000000, argumentBytes: 65536, decodedBytes: 200000, labelBytes: 65536 };
for (const control of controls.filter(c => ['core', 'corners', 'alignment', 'options', 'inventory'].includes(c.group))) {
  test(`GNU 3.12 ${control.id}`, () => {
    const args = control.args.includes('--') ? control.args : [...control.args, ...control.operands];
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
    assert.equal(result.exitCode, control.status);
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
