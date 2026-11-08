import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(directory, name));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = name => JSON.parse(read(name).toString('utf8'));
const schema = parse('SCHEMA.json');
const manifest = parse('MANIFEST.json');
const cases = parse('CASES.json');
const fixtures = parse('FIXTURES.json');
const expectedFiles = ['READY.md', 'CASES.json', 'FIXTURES.json', 'SCHEMA.json', 'BINDINGS.json', 'EXECUTION-RECIPE.md', 'verify.mjs'];
const workflowIds = Array.from({ length: 24 }, (_, index) => 'P' + String(index + 1).padStart(2, '0'));
const controlIds = Array.from({ length: 7 }, (_, index) => 'C' + String(index + 1).padStart(2, '0'));
const object = value => assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
const text = value => assert.equal(typeof value, 'string');
const keys = (value, required, optional = []) => {
  object(value);
  for (const key of required) assert.ok(Object.hasOwn(value, key), 'missing:' + key);
  for (const key of Object.keys(value)) assert.ok(required.includes(key) || optional.includes(key), 'extra:' + key);
};
const bytes = value => {
  text(value);
  const decoded = Buffer.from(value, 'base64');
  assert.equal(decoded.toString('base64'), value, 'canonical-base64');
  return decoded;
};
const relative = value => {
  text(value);
  assert.ok(value.length > 0 && !value.startsWith('/') && !value.includes('\0'));
  assert.ok(value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'relative-path');
};
const status = value => assert.ok(Number.isInteger(value) && value >= 0 && value <= 255, 'exit-status');
const argv = value => {
  assert.ok(Array.isArray(value) && value.length > 0);
  for (const entry of value) {
    assert.ok(Array.isArray(entry) && entry.length > 0);
    for (const argument of entry) { text(argument); assert.ok(!argument.includes('\0')); }
    assert.ok(['sed', 'rg', 'printf', 'nl', 'cat', 'head', 'echo', 'find', 'tail', 'ls', 'curl'].includes(entry[0]), 'real-priority-dispatch');
  }
};
function validate(data, fixtureData) {
  assert.equal(data.schema, 'priority-workflows-v1');
  assert.equal(data.phase, 'PREPARATION_ONLY_STATIC_UNEXECUTED');
  assert.deepEqual(data.counts, { workflows: 24, controls: 7, productExecutions: 0 });
  assert.deepEqual(data.workflows.map(row => row.id), workflowIds);
  assert.deepEqual(data.controls.map(row => row.id), controlIds);
  const rows = [...data.workflows, ...data.controls];
  assert.deepEqual(fixtureData.rows.map(row => row.id), [...workflowIds, ...controlIds]);
  for (const row of rows) {
    keys(row, schema.requiredCaseKeys, schema.optionalCaseKeys);
    for (const field of ['id', 'title', 'classification', 'script', 'reason']) text(row[field]);
    assert.ok(row.classification.startsWith('STATIC_UNEXECUTED'));
    assert.ok(Buffer.byteLength(row.script) <= schema.limits.maxScriptBytes && !row.script.includes('\0'));
    argv(row.argv);
    if (row.literalChildArgv) argv(row.literalChildArgv);
    assert.ok(Array.isArray(row.anchors) && row.anchors.length > 0);
    row.anchors.forEach(text);
    const expected = row.expected;
    keys(expected, schema.requiredExpectationKeys, schema.optionalExpectationKeys);
    assert.ok(['result', 'throw'].includes(expected.kind));
    if (expected.kind === 'result') { status(expected.exitCode); assert.ok(!Object.hasOwn(expected, 'reasonIdentity')); }
    else { assert.equal(expected.exitCode, null); text(expected.reasonIdentity); }
    assert.ok(bytes(expected.stdoutBase64).length <= schema.limits.maxCaseOutputBytes);
    assert.ok(bytes(expected.stderrBase64).length <= schema.limits.maxCaseOutputBytes);
    assert.equal(expected.stageExitCodes.length, row.argv.length);
    for (const code of expected.stageExitCodes) if (code !== null) status(code); else assert.equal(expected.kind, 'throw');
    object(expected.changedFiles);
    for (const [name, entry] of Object.entries(expected.changedFiles)) {
      relative(name); keys(entry, ['base64']); assert.ok(bytes(entry.base64).length <= schema.limits.maxCaseOutputBytes);
    }
    assert.ok(Array.isArray(expected.absent));
    for (const name of expected.absent) { relative(name); assert.ok(!Object.hasOwn(expected.changedFiles, name)); }
    const fixture = fixtureData.rows.find(entry => entry.id === row.id);
    keys(fixture, schema.requiredFixtureKeys, schema.optionalFixtureKeys);
    assert.ok(['memory', 'mock-http', 'readonly-memory', 'fault-memory', 'cooperative-transport', 'owned-sink-http', 'opaque-authorizer'].includes(fixture.infrastructure));
    object(fixture.files);
    assert.ok(Object.keys(fixture.files).length <= schema.limits.maxFixtureEntries);
    let total = 0;
    for (const [name, entry] of Object.entries(fixture.files)) {
      relative(name); keys(entry, ['base64']); const content = bytes(entry.base64);
      assert.ok(content.length <= schema.limits.maxCaseFileBytes); total += content.length;
      assert.ok(!expected.absent.includes(name));
    }
    assert.ok(total <= schema.limits.maxFixtureBytes);
    if (fixture.stdin.kind === 'omitted') keys(fixture.stdin, ['kind']);
    else { keys(fixture.stdin, ['kind', 'base64']); assert.equal(fixture.stdin.kind, 'chunks'); assert.ok(Array.isArray(fixture.stdin.base64)); fixture.stdin.base64.forEach(bytes); }
    if (fixture.network) {
      keys(fixture.network, ['routes']); assert.ok(Array.isArray(fixture.network.routes) && fixture.network.routes.length <= 2);
      for (const route of fixture.network.routes) {
        keys(route, ['authorize', 'request', 'response']);
        keys(route.authorize, ['url', 'method', 'attempt'], ['redirectFrom']);
        keys(route.request, ['url', 'method', 'headers', 'bodyBase64']);
        assert.equal(route.authorize.url, route.request.url); assert.equal(route.authorize.method, route.request.method);
        assert.equal(route.authorize.attempt, 0);
        assert.ok(['https://mock.example/', 'https://other.example/'].some(prefix => route.request.url.startsWith(prefix)));
        for (const pair of route.request.headers) { assert.equal(pair.length, 2); pair.forEach(text); }
        if (route.request.bodyBase64 !== null) bytes(route.request.bodyBase64);
        if (route.response !== null) {
          keys(route.response, ['status', 'statusText', 'headers', 'chunks']);
          assert.ok(Number.isInteger(route.response.status) && route.response.status >= 100 && route.response.status <= 599);
          text(route.response.statusText); route.response.chunks.forEach(bytes);
          for (const pair of route.response.headers) { assert.equal(pair.length, 2); pair.forEach(text); }
        }
      }
    }
  }
}
assert.deepEqual(schema.fixedIds, { workflows: workflowIds, controls: controlIds });
assert.deepEqual(manifest.files.map(row => row.path), expectedFiles);
let packetBytes = read('MANIFEST.json').length;
for (const row of manifest.files) {
  const filename = path.join(directory, row.path);
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  const content = read(row.path); packetBytes += content.length;
  assert.equal(content.length, row.bytes); assert.equal(digest(content), row.sha256, 'manifest:' + row.path);
}
assert.ok(packetBytes <= schema.limits.maxPacketBytes);
validate(cases, fixtures);
const mutations = [
  data => { data.workflows.pop(); },
  data => { data.workflows[1].id = 'P01'; },
  data => { data.workflows[0].expected.stdoutBase64 = '!'; },
  (_data, fixtureData) => { fixtureData.rows[0].files['../escape'] = { base64: '' }; },
  data => { data.workflows[0].expected.exitCode = 256; },
  data => { data.workflows[0].expected.stageExitCodes.pop(); },
  data => { data.workflows[0].unrecognized = true; },
];
for (const mutate of mutations) {
  const data = structuredClone(cases), fixtureData = structuredClone(fixtures);
  mutate(data, fixtureData); assert.throws(() => validate(data, fixtureData));
}
const changed = structuredClone(cases); changed.workflows[0].script += ' ';
assert.throws(() => assert.equal(digest(Buffer.from(JSON.stringify(changed, null, 2) + '\n')), manifest.files.find(row => row.path === 'CASES.json').sha256));
console.log(JSON.stringify({ role: 'SYNTHETIC_METADATA_ONLY', workflows: 24, separateControls: 7, malformedDataVariantsRejected: 8, packetBytes, productExecutions: 0, qualification: 'Bound files/counts/encoding/structural consistency only; not script/argv equivalence, behavioral proof, guard implementation verification or append-proof directory validation.' }));
