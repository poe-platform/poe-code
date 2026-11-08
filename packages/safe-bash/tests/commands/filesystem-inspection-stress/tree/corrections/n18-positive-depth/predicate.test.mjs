import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertPositiveDepthFailure } from './n18-predicate.mjs';

const bytes = (text) => new TextEncoder().encode(text);
const reply = (diagnostic, extra = {}) => ({ exitCode: 2, stdout: bytes(''), stderr: bytes(diagnostic), ...extra });
const positives = [
  'tree: Invalid level, must be greater than 0.\n',
  'tree: -L must be between 1 and 256\n',
  'tree: depth must be a positive integer\n',
  'tree: level must be at least 1\n',
  'tree: -L valid range: 2..32\n',
  'tree: depth required range 1 to 4\n',
  'tree: LEVEL must be greater than 2\n',
  'tree: maximum depth must be between 1 and 4096\n',
];
for (const [index, diagnostic] of positives.entries()) {
  test(`nonproduct positive depth diagnostic ${index + 1}`, () => assert.doesNotThrow(() => assertPositiveDepthFailure(reply(diagnostic))));
}
const negatives = [
  ['success status', reply(positives[0], { exitCode: 0 })],
  ['empty diagnostic', reply('')],
  ['whitespace diagnostic', reply(' \n')],
  ['unrelated permission diagnostic', reply('tree: permission denied\n')],
  ['unrelated positive range', reply('tree: width must be between 1 and 256\n')],
  ['option without a positive constraint', reply('tree: -L cannot open file\n')],
  ['zero inclusive range', reply('tree: depth must be between 0 and 256\n')],
  ['zero minimum', reply('tree: depth must be at least 0\n')],
  ['negative exclusive lower bound', reply('tree: level must be greater than -1\n')],
  ['zero dotted range', reply('tree: depth required range 0..64\n')],
  ['reversed range', reply('tree: -L must be between 8 and 2\n')],
  ['zero upper range', reply('tree: depth must be between 1 and 0\n')],
  ['wrong case short flag', reply('tree: -l must be between 1 and 256\n')],
  ['nonempty normal stdout', reply(positives[0], { stdout: bytes('basic\n') })],
  ['diagnostic in stdout only', reply('', { stdout: bytes(positives[0]) })],
  ['fractional bound', reply('tree: depth must be between 1.5 and 4\n')],
  ['fractional upper bound', reply('tree: depth must be between 1 and 256.5\n')],
  ['unsafe upper bound', reply('tree: depth must be between 1 and 9007199254740992\n')],
  ['positive but contradictory zero bound', reply('tree: level must be positive; allowed range: 0..256\n')],
  ['positive or zero', reply('tree: level must be positive or zero\n')],
  ['invalid negative status', reply(positives[0], { exitCode: -1 })],
  ['invalid oversized status', reply(positives[0], { exitCode: 256 })],
];
for (const [name, result] of negatives) {
  test(`nonproduct countercheck rejects ${name}`, () => assert.throws(() => assertPositiveDepthFailure(result), assert.AssertionError));
}
test('only the derived N18 predicate and its import differ; corpus and native bytes remain unchanged', async () => {
  const original = await readFile(new URL('./original-run.mjs', import.meta.url), 'utf8');
  const derived = await readFile(new URL('./derived/run.mjs', import.meta.url), 'utf8');
  const importLine = "import { assertPositiveDepthFailure } from '../n18-predicate.mjs';\n";
  const originalLine = "    if (entry.id === 'N18') assert.match(text, /level|depth|invalid|positive|greater/iu);";
  const correctedLine = "    if (entry.id === 'N18') assertPositiveDepthFailure({ exitCode: outcome.result.exitCode, stdout: run.stdout.bytes(), stderr: run.stderr.bytes() });";
  assert.equal(derived.split(importLine).length, 2);
  assert.equal(derived.split(correctedLine).length, 2);
  assert.equal(derived.replace(importLine, '').replace(correctedLine, originalLine), original);
  assert.equal(createHash('sha256').update(original).digest('hex'), '3068e51fece206bdcab38a53f5fb47b61cdfc5a71f35900f7241bf9f291fc03d');
  for (const [name, expected] of [['corpus.mjs', '1dc3e241eaf3708facb9062abf219c7a7e6c01d348ebd7cb1516aaff3d0ae8a4'], ['native.json', '5b89a6577600326878987f4d985270087d26fa7d3abd00f5c98fab973619c897']]) {
    assert.equal(createHash('sha256').update(await readFile(new URL(`./derived/${name}`, import.meta.url))).digest('hex'), expected);
  }
});
