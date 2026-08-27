import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { artifact, digest, directory, snapshot, summarize } from './common.mjs';
import { compare, createExecutor } from '../jq-grammar-independent/harness.mjs';

const mode = process.argv[2];
const family = process.argv[3] ?? 'focused';
assert.ok(['focused', 'alias-order'].includes(family));
const before = snapshot();
if (mode === 'capture') {
  const executable = '/usr/bin/jq';
  const executableSha256 = digest(readFileSync(executable));
  assert.equal(executableSha256, '1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f');
  const env = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: directory };
  const invoke = (argv, inputHex = '') => {
    const result = spawnSync(executable, argv, { input: Buffer.from(inputHex, 'hex'), cwd: directory, env, timeout: 2000, maxBuffer: 65536, shell: false });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return { status: result.status, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex') };
  };
  const version = invoke(['--version']);
  assert.equal(Buffer.from(version.stdoutHex, 'hex').toString().trim(), 'jq-1.7.1-apple');
  const definitions = family === 'alias-order' ? [
    { id: 'aliased-container-nan-order', reason: 'values.compare returns zero on container reference equality before recursing. Tagged jq jv_cmp recursively compares even aliased arrays/objects; the first focused control only compares distinct enclosing containers.',
      input: '[[NaN],{"x":NaN},[[NaN]],{"x":[NaN]},[Infinity],{"x":0}]\n', filter: 'map([.==.,.<.,.<=.,.>.,.>=.])' },
  ] : [
    { id: 'nested-nonfinite-copy-equality-order', reason: 'values.ts newly separates recursive equality from ordering; independent35 self-comparisons are scalar, not fresh enclosing containers sharing a Decimal.',
      input: '[NaN,Infinity,-Infinity,9007199254740993]\n', filter: 'map([([.] == [.]),({n:.} == {n:.}),([.] <= [.]),contains(.)])' },
    { id: 'quoted-escaped-lookalikes-observable', reason: 'The frozen mixed-quoted-container overwrites its numeric member. Inspecting string decoding warrants one separately observable escaped/string control without modifying that fixture.',
      input: '{"numbers":[NaN,Infinity,01,1.],"strings":["NaN","\\u004e\\u0061\\u004e","Infinity","01","1.","\\ufeff","\\\\NaN"]}\n', filter: '.' },
    { id: 'bom-byte-prefix-at-eof', reason: 'JsonParser.finish has no partial-BOM rejection; independent35 partial BOM includes a mismatching third byte, not pure EOF.',
      inputHex: 'efbb', filter: '.' },
  ];
  const vectors = definitions.map(definition => {
    const vector = { id: definition.id, reason: definition.reason, cohort: 'focused', argv: ['-c', definition.filter], inputHex: definition.inputHex ?? Buffer.from(definition.input).toString('hex'), schedules: ['whole', 'bytewise'] };
    const expected = invoke(vector.argv, vector.inputHex);
    const repeated = invoke(vector.argv, vector.inputHex);
    assert.deepEqual(expected, repeated);
    return { ...vector, expected, repeated };
  });
  assert.equal(digest(readFileSync(executable)), executableSha256);
  artifact(`${family}-native.json`, { recordedAt: new Date().toISOString(), before, after: snapshot(), executable, executableSha256, env,
    cwd: directory, watchdogMs: 2000, version, buildConfiguration: invoke(['--build-configuration']), vectors,
    note: `${vectors.length} source-inspection-driven neighbors, frozen twice before virtual replay. No broad fuzz, native files, shell, network, or product native invocation.` });
} else {
  assert.ok(['source', 'compiled'].includes(mode));
  const nativePath = new URL(`${family}-native.json`, import.meta.url);
  const frozen = JSON.parse(readFileSync(nativePath));
  const built = mode === 'compiled' ? await (await import('./build.mjs')).build() : undefined;
  const api = built?.api ?? await import('../../../../src/index.ts');
  const execute = await createExecutor(api);
  const rows = [];
  for (const vector of frozen.vectors) for (const route of ['direct', 'shell']) for (const transport of vector.schedules) {
    const observed = await execute(vector, route, transport);
    rows.push({ cohort: 'focused', id: vector.id, route, transport, expected: vector.expected, ...observed, ...compare(vector, route, observed) });
  }
  artifact(`${family}-${mode}.json`, { before, after: snapshot(), build: built?.record, nativeSha256: digest(readFileSync(nativePath)), rows, summary: summarize(rows) });
  built?.hooks.deregister();
  console.log(mode, summarize(rows));
  process.exitCode = rows.some(row => !row.pass) ? 1 : 0;
}
