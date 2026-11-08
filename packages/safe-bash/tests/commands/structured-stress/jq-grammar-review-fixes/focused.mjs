import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { artifact, digest, directory, snapshot, summarize } from './common.mjs';
import { compare, createExecutor } from '../jq-grammar-independent/harness.mjs';
import { loadFrozen } from '../jq-grammar-independent/evidence.mjs';

const [mode, label] = process.argv.slice(2);
assert.match(label ?? '', /^[a-z0-9-]+$/u);
const before = snapshot();
const oldPaths = ['focused-native.json', 'alias-order-native.json'];
const old = oldPaths.flatMap(name => JSON.parse(readFileSync(new URL(`../jq-grammar-source-review/${name}`, import.meta.url))).vectors);
const prerequisite = loadFrozen().cohorts.grammar.filter(vector => vector.id === 'nonfinite-type-copy-predicates');
assert.equal(prerequisite.length, 1);
if (mode === 'capture') {
  const executable = '/usr/bin/jq';
  const executableSha256 = digest(readFileSync(executable));
  assert.equal(executableSha256, '1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f');
  const cwd = mkdtempSync(join(directory, '.native-'));
  const env = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: cwd };
  const invoke = (argv, inputHex = '') => {
    const result = spawnSync(executable, argv, { input: Buffer.from(inputHex, 'hex'), cwd, env, timeout: 2000, maxBuffer: 65536, shell: false });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return { status: result.status, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex') };
  };
  try {
    const version = invoke(['--version']);
    assert.equal(Buffer.from(version.stdoutHex, 'hex').toString().trim(), 'jq-1.7.1-apple');
    const definitions = [
      { id: 'predicate-copy-overflow-nonnumbers', input: '[NaN,Infinity,-Infinity,1e400,9007199254740993,0,-0,true,false,null,"NaN",[],{}]\n', filter: 'map([type,isfinite,isinfinite,isnan,([.] | .[0] | isfinite),not,(. and true)])' },
      { id: 'predicate-arithmetic-generator', input: 'null\n', filter: '(nan,infinite,-infinite,(infinite-infinite),(0*infinite),(1e308*1e308),1,0,true,false,null,"1",[],{}) | [type,isfinite,isnan,isinfinite]' },
      { id: 'distinct-nested-order', input: '[[[NaN],[NaN]],[{"x":NaN},{"x":NaN}],[[[NaN]],[[NaN]]],[{"x":[NaN]},{"x":[NaN]}],[[Infinity],[Infinity]],[{"x":0},{"x":0}],[[1,2],[1,3]],[{"😀":0},{"\ue000":0}]]\n', filter: 'map([(.[0]==.[1]),(.[0]<.[1]),(.[0]<=.[1]),(.[0]>.[1]),(.[0]>=.[1])])' },
      { id: 'scalar-self-order-controls', input: '[NaN,Infinity,-Infinity,0,9007199254740993,null,false,true,"😀",[],{}]\n', filter: 'map([.==.,.<.,.<=.,.>.,.>=.])' },
    ];
    const vectors = definitions.map(definition => {
      const vector = { id: definition.id, cohort: 'neighbors', argv: ['-c', definition.filter], inputHex: Buffer.from(definition.input).toString('hex'), schedules: ['whole', 'bytewise'] };
      const expected = invoke(vector.argv, vector.inputHex);
      assert.equal(expected.status, 0);
      const repeated = invoke(vector.argv, vector.inputHex);
      assert.deepEqual(expected, repeated);
      return { ...vector, expected, repeated };
    });
    const recaptures = [...prerequisite, ...old].map(vector => {
      const observed = invoke(vector.argv, vector.inputHex);
      const repeated = invoke(vector.argv, vector.inputHex);
      assert.deepEqual(observed, vector.expected);
      assert.deepEqual(repeated, vector.expected);
      return { id: vector.id, observed, repeated };
    });
    artifact(`${label}.json`, { before, after: snapshot(), executable, executableSha256, cwd, env, watchdogMs: 2000, maxBuffer: 65536, version, buildConfiguration: invoke(['--build-configuration']), vectors, recaptures,
      immutable: Object.fromEntries(oldPaths.map(name => [name, digest(readFileSync(new URL(`../jq-grammar-source-review/${name}`, import.meta.url)))])),
      note: 'Four bounded neighbors only, twice frozen before any source edits. Five existing vectors recaptured unchanged; oracle cwd was isolated and removed when empty.' });
  } finally { rmdirSync(cwd); }
} else {
  assert.ok(['source', 'compiled'].includes(mode));
  const nativePath = new URL('native-frozen.json', import.meta.url);
  const neighbors = JSON.parse(readFileSync(nativePath)).vectors;
  const built = mode === 'compiled' ? await (await import('./build.mjs')).build() : undefined;
  const api = built?.api ?? await import('../../../../src/index.ts');
  const execute = await createExecutor(api);
  const rows = [];
  for (const [cohort, vectors] of Object.entries({ prerequisite, reviewer: old, neighbors })) {
    for (const vector of vectors) for (const route of ['direct', 'shell']) for (const transport of vector.schedules) {
      const observed = await execute(vector, route, transport);
      rows.push({ cohort, id: vector.id, route, transport, expected: vector.expected, ...observed, ...compare(vector, route, observed) });
    }
  }
  const summary = Object.fromEntries(['prerequisite', 'reviewer', 'neighbors'].map(cohort => [cohort, summarize(rows.filter(row => row.cohort === cohort))]));
  const after = snapshot();
  artifact(`${label}.json`, { before, after, stableProduct: before.productSha256 === after.productSha256, build: built?.record, nativeSha256: digest(readFileSync(nativePath)), rows, summary });
  built?.hooks.deregister();
  console.log(mode, summary);
  process.exitCode = rows.some(row => !row.pass) ? 1 : 0;
}
