import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { active, retired, assertClosed, digest, directory, identity, ready, run, save } from './tools.mjs';

ready();
const base = 'tests/commands/';
const jqPath = base + 'structured-stress/jq-grammar-author-20260827/scan-boundaries.test.ts';
const wrapperPath = base + 'search-stress/streaming.test.ts';
const streamingPath = base + 'search-stress/streaming-cases.ts';
const acceptance = JSON.parse(readFileSync(new URL('acceptance-freeze.json', import.meta.url)));
const expected = new Map(acceptance.expectations.map(entry => [`${entry.id}/${entry.route}/${entry.transport}`, digest(JSON.stringify(entry.expected))]));
const before = identity();
save('evidence/canonical-before.json', before);
const semanticResults = [];
function traces(stdout) {
  return stdout.split('\n').filter(line => line.includes('HARNESS_TIMING ')).map(line => JSON.parse(line.slice(line.indexOf('HARNESS_TIMING ') + 'HARNESS_TIMING '.length)));
}
function verify(result, kind) {
  const checks = [];
  const check = (name, action) => {
    try { action(); checks.push({ name, pass: true }); }
    catch (error) { checks.push({ name, pass: false, error: String(error) }); }
  };
  check('exact direct child and streams closed successfully', () => assertClosed(result));
  const records = traces(result.stdout);
  if (kind === 'jq') {
    check('canonical TAP retains 15 passes, zero failures/skips', () => {
      assert.match(result.stdout, /# pass 15\b/u);
      assert.match(result.stdout, /# fail 0\b/u);
      assert.match(result.stdout, /# skipped 0\b/u);
    });
    const starts = records.filter(record => record.event === 'jq-execute-start');
    const completions = records.filter(record => record.event === 'jq-execute-complete');
    check('330 independently frozen actual triple digests, unique routes/transports', () => {
      assert.equal(starts.length, 330);
      assert.equal(completions.length, 330);
      const seen = new Set();
      for (const record of completions) {
        const detail = record.detail;
        const key = `${detail.vector}/${detail.route}/${detail.transport}`;
        assert(!seen.has(key), key); seen.add(key);
        assert.equal(detail.sha256, expected.get(key), key);
      }
      assert.equal(seen.size, expected.size);
    });
    check('module readiness precedes execution and actual read/output evidence', () => {
      const readyRecord = records.find(record => record.event === 'jq-module-ready');
      assert(readyRecord);
      for (const start of starts) {
        assert(start.atMs >= readyRecord.atMs);
        const events = records.filter(record => record.detail?.invocation === start.detail.invocation);
        const read = events.find(record => record.event === 'jq-entered-read');
        const output = events.find(record => record.event === 'jq-first-data');
        const complete = events.find(record => record.event === 'jq-execute-complete');
        assert(read && output && complete);
        assert(read.atMs >= start.atMs && output.atMs >= read.atMs && complete.atMs >= output.atMs);
      }
    });
  } else {
    check('canonical child retains six passes and zero failures/skips', () => {
      assert.match(result.stdout, /# pass 6\b/u);
      assert.match(result.stdout, /# fail 0\b/u);
      assert.match(result.stdout, /# skipped 0\b/u);
      if (kind === 'wrapper') assert.match(result.stdout, /# pass 1\b/u);
    });
    const native = records.filter(record => record.event === 'native-delivery');
    check('three exact native profiles, output triples and real retirement', () => {
      assert.equal(native.length, 3);
      for (const { detail } of native) {
        assert.deepEqual(detail.argv, ['--no-config', '--line-buffered', 'foo', '-']);
        assert.equal(detail.profile, 'observed-prefix');
        assert.deepEqual({ code: detail.code, stdout: detail.stdout, stderr: detail.stderr }, acceptance.native.expected);
        assert.equal(detail.ready, true);
        assert.equal(detail.actualClose, true);
        assert.equal(detail.ownedListenersRemaining, 0);
        assert.equal(detail.activeTimers, 0);
        assert.deepEqual(detail.streamsDestroyed, [true, true, true]);
        for (const name of ['spawn', 'prefix-consumption-evidenced', 'ready', 'exit', 'stdout-close', 'stderr-close', 'close']) assert(detail.events.some(event => event.event === name), name);
        const readyIndex = detail.events.findIndex(event => event.event === 'ready');
        const prefixIndex = detail.events.findIndex(event => event.event === 'prefix-consumption-evidenced');
        const suffixIndex = detail.events.findIndex(event => event.event === 'write' && event.detail.hex === '000a6e6f0a');
        assert(prefixIndex >= 0 && readyIndex > prefixIndex && suffixIndex > readyIndex);
      }
    });
    check('virtual suffix follows actual prefix output for all three repetitions', () => {
      for (const repetition of [1, 2, 3]) {
        const events = records.filter(record => record.detail?.repetition === repetition);
        const readIndex = events.findIndex(record => record.event === 'virtual-entered-read');
        const outputIndex = events.findIndex(record => record.event === 'virtual-first-data');
        const suffixIndex = events.findIndex(record => record.event === 'virtual-suffix-after-output');
        assert(readIndex >= 0 && outputIndex > readIndex && suffixIndex > outputIndex);
      }
    });
  }
  const summary = { name: result.name, kind, durationMs: result.durationMs, checks, traceEvents: records.length, pass: checks.every(check => check.pass) };
  semanticResults.push(summary);
  save(`evidence/${result.name}-semantics.json`, summary);
  assert(summary.pass, `${result.name} semantic verification failed; stop without retries`);
}
const launch = (name, path) => run(name, process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', path], {
  extraEnv: { HARNESS_TIMING: '1' }, timeoutMs: path === wrapperPath ? 130000 : 45000,
});
try {
  const profile = await run('native-profile', 'rg', ['--version'], { cwd: directory, timeoutMs: 5000 });
  assertClosed(profile);
  verify(await launch('serial-jq', jqPath), 'jq');
  verify(await launch('serial-wrapper', wrapperPath), 'wrapper');
  for (const round of [1, 2]) {
    const jobs = round === 1 ? [['jq', jqPath], ['streaming', streamingPath]] : [['streaming', streamingPath], ['jq', jqPath]];
    const results = await Promise.all(jobs.map(([kind, path]) => launch(`concurrent-${round}-${kind}`, path)));
    for (const [index, result] of results.entries()) verify(result, jobs[index][0]);
  }
} finally {
  const after = identity();
  const changed = Object.entries(before.hashes).filter(([path, hash]) => after.hashes[path] !== hash).map(([path, hash]) => ({ path, before: hash, after: after.hashes[path] }));
  save('evidence/canonical-after.json', after);
  save('evidence/canonical-summary.json', { semanticResults, changed, directlyOwned: retired, activeChildren: [...active.keys()], maximumScheduledDescendants: 3, wrapperConcurrency: 'not exercised; exact canonical child cases concurrent instead' });
  assert.equal(active.size, 0, 'all directly owned children must close');
}
console.log(JSON.stringify({ completed: semanticResults.length, semanticResults }, null, 2));
