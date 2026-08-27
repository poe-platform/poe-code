import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const authorRelative = 'tests/commands/grep-aliases-stress/settlement-v2';
const author = join(repository, authorRelative);
const evidence = 'b6987ae7e6348ffb3deeacdade033ec281849aa7';
const preparation = '8b89c0e76dfe581ce57418b391e74ce299686af7';
const candidate = '0123c83d3aae72a15621acbb29a165b97b2c6ab6';
const destination = resolve(process.argv[2]);
assert.ok(process.argv[2]);
mkdirSync(destination);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(path));
const blob = (revision, path) => execFileSync('git', ['show', `${revision}:${path}`], { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
const save = (name, data) => writeFileSync(join(destination, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const report = { candidate, evidence, preparation, startedAt: new Date().toISOString(), sourceChanges: false, productRetries: 0, checks: [], commands: [] };
function check(name, action) { action(); report.checks.push(name); }
function run(name, args) {
  const result = spawnSync(process.execPath, args, { cwd: repository, env: process.env, timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
  const record = { name, executable: process.execPath, args, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout?.toString() ?? '', stderr: result.stderr?.toString() ?? '' };
  save(`${name}.json`, record); report.commands.push(record);
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, record.stderr + record.stdout);
}
function authenticate() {
  const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', evidence, '--', authorRelative], { cwd: repository, encoding: 'utf8' }).trim().split('\n');
  const files = paths.map(path => {
    const actual = readFileSync(join(repository, path)), expected = blob(evidence, path);
    assert.equal(lstatSync(join(repository, path)).isFile(), true);
    assert.deepEqual(actual, expected, path);
    return { path, bytes: actual.length, sha256: hash(actual) };
  });
  function walk(root, prefix = '') {
    return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(root, entry.name), prefix + entry.name + '/') : [authorRelative + '/' + prefix + entry.name]);
  }
  assert.deepEqual(walk(author).sort(), paths.sort());
  return files;
}
try {
  report.runtime = { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)), platform: process.platform, arch: process.arch };
  report.before = authenticate();
  const freeze = json(join(author, 'freeze.json'));
  for (const entry of freeze.preparationSources) assert.deepEqual(blob(preparation, `${authorRelative}/${entry.path}`), readFileSync(join(author, entry.path)));
  const patch = readFileSync(join(author, 'fixture.patch'), 'utf8');
  const sections = patch.split('\n@@\n');
  assert.equal(sections.shift(), '*** Begin Patch\n*** Update File: holdouts.mts');
  assert.equal(sections.length, 2);
  const deltas = sections.map((section, index) => {
    const lines = section.replace(/\n\*\*\* End Patch\n$/, '').split('\n');
    assert.ok(lines.every(line => line.startsWith('+') || line.startsWith('-')));
    return { id: ['S07', 'ROOT-CONTROL'][index], before: lines.filter(line => line.startsWith('-')).map(line => line.slice(1)).join('\n'), after: lines.filter(line => line.startsWith('+')).map(line => line.slice(1)).join('\n') };
  });
  const original = blob(candidate, 'tests/commands/grep-aliases-stress/verification/holdouts.mts').toString();
  assert.equal(hash(original), 'd454002f97fa37b6546bad238feec5472774646a6bf0d766fea32c2c0c32977b');
  let derived = original;
  for (const delta of deltas) { assert.equal(derived.split(delta.before).length, 2); derived = derived.replace(delta.before, delta.after); }
  check('two authorized spans only; reverse produces every original fixture byte', () => {
    let restored = derived;
    for (const delta of deltas) { assert.equal(restored.split(delta.after).length, 2); restored = restored.replace(delta.after, delta.before); }
    assert.equal(restored, original);
    assert.equal(hash(derived), '41fb87e021e9d851905e889e26beaad4a779336b787e665b21c76bbace5f8850');
    const mask = (text, key) => deltas.reduce((value, delta, index) => value.replace(delta[key], `<AUTHORIZED-SETTLEMENT-${index}>`), text);
    assert.equal(mask(original, 'before'), mask(derived, 'after'));
    assert.equal(hash(mask(original, 'before')), freeze.fixture.unchangedRemainderSha256);
  });
  check('capture collision is disclosed and only output filename repaired', () => {
    const executed = readFileSync(join(author, 'attempts/01/replay-source.txt'), 'utf8');
    const old = "join(destination, 'assertion-controls.json')", replacement = "join(destination, 'assertion-control-results.json')";
    assert.equal(executed.split(old).length, 2);
    assert.equal(executed.replace(old, replacement), readFileSync(join(author, 'replay.mjs'), 'utf8'));
    assert.equal(json(join(author, 'controls/01-process.json')).status, 0);
    assert.equal(json(join(author, 'controls/02-process.json')).status, 0);
    const controls = json(join(author, 'controls/02-results.json'));
    assert.equal(controls.negativeControlsRejected, 8); assert.equal(controls.positiveControlsAccepted, 2);
  });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const rows = [];
  for (const delta of deltas) {
    const body = new AsyncFunction('shell', 'input', 'failure', 'details', 'assert', delta.after);
    for (const mode of ['fulfilled-status0', 'fulfilled-status2', 'fulfilled-undefined', 'rejected-zero', 'equal-message-distinct-error', 'return-count0', 'return-count2', 'exact-sentinel']) {
      const failure = new Error(`independent-${delta.id}-sentinel`);
      let execCalls = 0, disposeCalls = 0;
      const input = { input: {}, nextCalls: () => 1, returns: () => mode === 'return-count0' ? 0 : mode === 'return-count2' ? 2 : 1 };
      const shell = { commands: { has: () => false }, dispose: async () => { disposeCalls++; }, exec: async (command, options) => {
        execCalls++; assert.equal(command, delta.id === 'S07' ? 'egrep -q keep' : 'grep -q keep'); assert.equal(options.stdin, input.input);
        if (mode === 'fulfilled-undefined') return undefined;
        if (mode.startsWith('fulfilled')) return { exitCode: mode === 'fulfilled-status2' ? 2 : 0, stdout: '', stderr: failure.message };
        if (mode === 'rejected-zero') throw 0;
        if (mode === 'equal-message-distinct-error') throw new Error(failure.message);
        throw failure;
      } };
      const details = {}; let error;
      try { await body(shell, input, failure, details, assert); } catch (caught) { error = caught; }
      assert.equal(execCalls, 1); assert.equal(disposeCalls, 1);
      if (mode === 'exact-sentinel') assert.equal(error, undefined);
      else assert.equal(error?.code, 'ERR_ASSERTION');
      rows.push({ id: delta.id, mode, exactBodySha256: hash(delta.after), assertionRejected: !!error, error: error ? { code: error.code, message: error.message } : null, details, execCalls, disposeCalls });
    }
  }
  report.assertionControls = { negativeDetected: rows.filter(row => row.assertionRejected).length, positiveAccepted: rows.filter(row => !row.assertionRejected).length, productExecutions: 0, sourceMutants: 0, rows };
  assert.equal(report.assertionControls.negativeDetected, 14); assert.equal(report.assertionControls.positiveAccepted, 2);
  save('independent-assertion-controls.json', report.assertionControls);
  run('author-sealed-evidence-before', [join(author, 'verify.mjs'), '--retained-snapshot']);
  save('before-product.json', report);
  run('unchanged-replay', [join(author, 'replay.mjs'), join(destination, 'replay')]);
  run('author-sealed-evidence-after', [join(author, 'verify.mjs'), '--retained-snapshot']);
  report.after = authenticate(); assert.deepEqual(report.after, report.before);
  const execution = json(join(destination, 'replay/execution.json'));
  assert.equal(execution.candidate, candidate);
  assert.equal(execution.packageSha256, '62228b67ca6793544f0f4374ca00fbbb6e627f514f184d5880fd7723ccf179c6');
  assert.equal(execution.sourceOverlay, false); assert.equal(execution.newProductBuild, false); assert.equal(execution.newNpmPack, false); assert.equal(execution.forcedCleanup, false);
  assert.ok(execution.cohorts.every(row => row.processStatus === 0));
  report.status = 'replay-complete-awaiting-independent-result-inspection';
} catch (error) {
  report.status = 'review-failed'; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1;
} finally {
  report.endedAt = new Date().toISOString(); save('REVIEW.json', report);
  console.log(JSON.stringify({ status: report.status, candidate, output: destination, checks: report.checks, assertionControls: report.assertionControls ? { negativeDetected: report.assertionControls.negativeDetected, positiveAccepted: report.assertionControls.positiveAccepted } : null, failure: report.failure }));
}
