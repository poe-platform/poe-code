import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { captureCase, directory, invokeNative, sha256 } from './native.mjs';

const specs = [
  ['fromjson-valid-precision', 'numeric-transform', JSON.stringify('{"n":9007199254740993}'), ['-c', '--', 'fromjson']],
  ['join-mixed-valid', 'raw-join', '["😀",null,true,12.5,"\\u0000"]', ['-j', '--', 'join(("\\n","|"))']],
  ['large-length-1e20', 'numeric-length', '100000000000000000000', ['-c', '--', 'length']],
  ['tiny-length', 'numeric-length', '0.0000001', ['-c', '--', 'length']],
  ['literal-exponents', 'numeric-transform', 'null', ['-nc', '--', '[1e20,1e21]']],
  ['input-exponent-conversions', 'numeric-conversion', '1e2', ['-c', '--', '[.,tojson,tostring]']],
  ['join-quota-prefix', 'safety-reference', '["雪","x"]', ['-j', '--', 'join(("/","|","!"))']],
  ['raw-quota-reference', 'safety-reference', '雪\nx\n', ['-Rj', '--', '.']],
  ['join-json-quota-reference', 'safety-reference', '["雪","x"]', ['-c', '--', 'join("/")']],
  ['join-unicode-separator', 'safety-reference', '["雪","x"]', ['-j', '--', 'join("😀")']],
  ['chunk-edge-reference', 'safety-reference', `${'a'.repeat(16383)}😀\r\n雪`, ['-Rj', '--', '.']],
  ['json-surrogate-pair', 'safety-reference', '"\\ud83d\\ude00"\n"雪"', ['-j', '--', '.']],
  ['generator-error-suppressed-next-input', 'error-ordering', '["a","b"]\n["c","d"]', ['-c', '--', '[join(("/",1/0))?]']],
  ['runtime-error-last-false', 'error-ordering', '[{}]\nfalse', ['-ce', '--', 'if . == false then false else join("/") end']],
  ['runtime-error-last-empty', 'error-ordering', '[{}]\n[]', ['-ce', '--', 'if . == [] then empty else join("/") end']],
];
const cases = specs.map(([id, category, input, argv]) => ({ id, category, inputHex: Buffer.from(input).toString('hex'), argv, transport: 'whole' }));
const mode = process.argv[2];
assert.ok(['--freeze', '--verify', '--case'].includes(mode));
const target = join(directory, 'supplement-vectors.json');
if (mode === '--case') {
  const fixture = cases.find(fixture => fixture.id === process.argv[3]);
  assert.ok(fixture);
  console.log(JSON.stringify(await captureCase(fixture), null, 2));
} else if (mode === '--verify') {
  const frozen = JSON.parse(await readFile(target, 'utf8'));
  assert.deepEqual(await invokeNative(['--version']), frozen.provenance.version);
  assert.deepEqual(await invokeNative(['--build-configuration']), frozen.provenance.build);
  for (const fixture of frozen.cases) assert.deepEqual(await captureCase(fixture), fixture, fixture.id);
  console.log(`Verified ${frozen.cases.length} supplemental invocations + 2 metadata invocations.`);
} else {
  await assert.rejects(readFile(target), { code: 'ENOENT' });
  const primary = await readFile(join(directory, 'native-vectors.json'));
  const provenance = JSON.parse(primary.toString()).provenance;
  const document = { provenance: { ...provenance, capturedAt: new Date().toISOString(), primaryVectorSha256: sha256(primary), scriptSha256: sha256(await readFile(new URL(import.meta.url))), fixtureInvocations: cases.length, version: await invokeNative(['--version']), build: await invokeNative(['--build-configuration']), note: 'Additive valid replacements for malformed fromjson/join-mixed probes, historical numeric edges, and bounded safety references. Original vectors remain immutable.' }, cases: [] };
  for (const fixture of cases) document.cases.push(await captureCase(fixture));
  const content = `${JSON.stringify(document, null, 2)}\n`;
  const patch = `*** Begin Patch\n*** Add File: ${target}\n${content.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const applied = spawnSync('apply_patch', [patch], { shell: false, encoding: 'utf8', timeout: 2000, maxBuffer: 65536 });
  assert.equal(applied.status, 0, applied.stderr);
  console.log(`${cases.length} supplementary vectors frozen; sha256 ${sha256(content)}`);
}
