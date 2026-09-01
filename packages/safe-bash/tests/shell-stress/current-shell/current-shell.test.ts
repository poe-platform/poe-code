import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { maxBatchCases } from '../model.js';

test('independent frozen current-shell cohort', { timeout: 400_000 }, async (context) => {
  const { runProduct } = await import(new URL('./run-product.mjs', import.meta.url).href);
  const report = await runProduct();
  for (const row of report.rows) {
    await context.test(`${row.cohort}: ${row.id}`, () => {
      assert.equal(row.valid, true, JSON.stringify({ process: row.process, sourceGuard: row.sourceGuard }));
      assert.equal(row.passed, true, JSON.stringify({ expected: row.expected, actual: row.child?.observation }));
    });
  }
});

async function batchHarness() {
  const { nativeCases, hostCases } = await import(new URL('./cases.mjs', import.meta.url).href);
  const frozen = JSON.parse(await readFile(new URL('./native-frozen.json', import.meta.url), 'utf8'));
  const primary = frozen.profiles.find((profile: { role: string }) => profile.role === 'PRIMARY');
  const fixtures = [...nativeCases, ...hostCases] as { id: string; kind?: string }[];
  const guard = { sha256: 'unchanged', files: {} };
  const launches: string[][] = [];
  const calls: string[] = [];
  const dependencies = {
    async sourceGuard() { calls.push('source'); return guard; },
    async runChild(executable: string, args: string[], options: { deadline: number; env: NodeJS.ProcessEnv }) {
      calls.push('spawn');
      assert.equal(executable, process.execPath);
      assert.equal(options.deadline, 8000);
      assert.equal(options.env.CURRENT_SHELL_SOURCE_GUARD, guard.sha256);
      assert.ok(args.includes('--batch'));
      const ids = args.slice(args.indexOf('--batch') + 1);
      assert.ok(ids.length > 0 && ids.length <= maxBatchCases);
      launches.push(ids);
      const rows = ids.map(id => ({
        id, fixtureSha256: frozen.fixturesSha256,
        observation: fixtures.find(fixture => fixture.id === id)?.kind ? { passed: true } : primary.results.find((row: { id: string }) => row.id === id).comparable,
        sourceGuard: { before: guard, after: guard, stable: true },
      }));
      return { pid: launches.length, status: 0, signal: null, timedOut: false, overflow: false, groupAlive: false, stdout: Buffer.from(JSON.stringify(rows)).toString('base64'), stderr: '' };
    },
  };
  return { fixtures, launches, calls, dependencies };
}

test('current-shell batch keeps all rows in bounded serial launches', async context => {
  context.mock.method(process.stderr, 'write', () => true);
  const { runProduct } = await import(new URL('./run-product.mjs', import.meta.url).href);
  const harness = await batchHarness();
  const report = await runProduct(harness.dependencies);
  assert.deepEqual(harness.launches.map(ids => ids.length), [8, 8, 8, 8, 8, 3]);
  assert.deepEqual(harness.launches.flat(), harness.fixtures.map(fixture => fixture.id));
  assert.deepEqual(report.rows.map((row: { id: string }) => row.id), harness.fixtures.map(fixture => fixture.id));
  assert.ok(report.rows.every((row: { valid: boolean; passed: boolean }) => row.valid && row.passed));
  assert.deepEqual(harness.calls, Array.from({ length: 6 }, () => ['source', 'spawn', 'source']).flat());
});

test('current-shell batch rejects damaged outcomes and process/source failures without retry', async context => {
  context.mock.method(process.stderr, 'write', () => true);
  const { runProduct } = await import(new URL('./run-product.mjs', import.meta.url).href);
  for (const failure of ['truncated', 'reordered', 'duplicate', 'row-source', 'fixture', 'parent-source', 'timeout', 'overflow', 'group-alive']) {
    await context.test(failure, async () => {
      const harness = await batchHarness();
      if (failure === 'parent-source') {
        let reads = 0;
        harness.dependencies.sourceGuard = async () => ({ sha256: reads++ % 2 === 0 ? 'unchanged' : 'changed', files: {} });
      }
      const launch = harness.dependencies.runChild;
      harness.dependencies.runChild = async (...args) => {
        const result = await launch(...args);
        if (failure === 'timeout') return { ...result, timedOut: true };
        if (failure === 'overflow') return { ...result, overflow: true };
        if (failure === 'group-alive') return { ...result, groupAlive: true };
        const rows = JSON.parse(Buffer.from(result.stdout, 'base64').toString());
        if (failure === 'truncated') rows.pop();
        if (failure === 'reordered') rows.reverse();
        if (failure === 'duplicate') rows[1] = rows[0];
        if (failure === 'row-source') rows[0].sourceGuard.after.sha256 = 'changed';
        if (failure === 'fixture') rows[0].fixtureSha256 = 'changed';
        return { ...result, stdout: Buffer.from(JSON.stringify(rows)).toString('base64') };
      };
      const report = await runProduct(harness.dependencies);
      assert.equal(harness.launches.length, 6);
      assert.equal(report.rows.length, 43);
      assert.equal(report.rows[0].valid, false);
      assert.equal(report.rows[0].passed, false);
      if (['truncated', 'reordered', 'duplicate', 'timeout', 'overflow', 'group-alive'].includes(failure)) {
        assert.ok(report.rows.every((row: { valid: boolean; passed: boolean }) => !row.valid && !row.passed));
      }
    });
  }
});

test('current-shell batch rejects invalid sizes before evaluating a case', async () => {
  const { runBatch, batchSize } = await import(new URL('./product-child.mjs', import.meta.url).href);
  assert.equal(batchSize, maxBatchCases);
  let calls = 0;
  for (const length of [0, maxBatchCases + 1]) {
    await assert.rejects(runBatch(Array.from({ length }, (_, index) => ({ id: `case-${index}` })), async () => { calls++; }));
  }
  assert.equal(calls, 0);
});

test('current-shell batch preserves fresh shell, filesystem, observations and per-row guards', async () => {
  const { runChild, sourceGuard, environment } = await import(new URL('./support.mjs', import.meta.url).href);
  const before = await sourceGuard();
  const script = `
    import { runBatch } from './tests/shell-stress/current-shell/product-child.mjs';
    import { runFixture } from './tests/shell-stress/current-shell/product-fixtures.mjs';
    const rows = await runBatch([
      { id: 'mutate', script: 'export LEAK=present; set -- dirty; leaked() { printf leaked; }; cd work; printf saved > marker' },
      { id: 'fresh', script: 'printf "%s:%s:%s" "\${LEAK-unset}" "$#" "$PWD"; leaked' }
    ], runFixture);
    console.log(JSON.stringify(rows));
  `;
  const result = await runChild(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { env: { ...environment, CURRENT_SHELL_SOURCE_GUARD: before.sha256 }, deadline: 8000 });
  assert.equal(result.status, 0, Buffer.from(result.stderr, 'base64').toString());
  assert.equal(result.signal, null);
  assert.equal(result.timedOut, false);
  assert.equal(result.overflow, false);
  assert.equal(result.groupAlive, false);
  assert.equal(result.stderr, '');
  const rows = JSON.parse(Buffer.from(result.stdout, 'base64').toString());
  assert.deepEqual(rows.map((row: { id: string }) => row.id), ['mutate', 'fresh']);
  assert.equal(rows[0].observation.status, 0);
  assert.equal(rows[0].observation.files['work/marker'], Buffer.from('saved').toString('base64'));
  assert.equal(rows[1].observation.status, 127);
  assert.equal(Buffer.from(rows[1].observation.stdout, 'base64').toString(), 'unset:0:/fixture');
  assert.deepEqual(rows[1].observation.files, { 'search/': null, 'work/': null });
  for (const row of rows) {
    assert.equal(row.sourceGuard.before.sha256, before.sha256);
    assert.equal(row.sourceGuard.after.sha256, before.sha256);
    assert.equal(row.sourceGuard.stable, true);
  }
  assert.equal((await sourceGuard()).sha256, before.sha256);
});

test('current-shell batch watchdog kills a late synchronous hang; bypass reaches outer deadline', async () => {
  const { runChild, environment } = await import(new URL('./support.mjs', import.meta.url).href);
  const setup = `
    import { writeSync } from 'node:fs';
    import { setTimeout as delay } from 'node:timers/promises';
    import { runBatch } from './tests/shell-stress/current-shell/product-child.mjs';
    const fixtures = [{ id: 'first' }, { id: 'second' }, { id: 'late' }, { id: 'unreached' }];
    const execute = async fixture => {
      writeSync(1, fixture.id + '\\n');
      if (fixture.id === 'late') while (true) {}
      await delay(120);
      return { passed: true };
    };
  `;
  for (const watched of [true, false]) {
    const script = setup + (watched
      ? `await runBatch(fixtures, execute, { deadline: 200, expectedSource: 'fixed', guard: async () => ({ sha256: 'fixed', files: {} }) });`
      : `for (const fixture of fixtures) await execute(fixture);`);
    const result = await runChild(process.execPath, ['--input-type=module', '-e', script], { env: environment, deadline: 1500 });
    assert.equal(result.status, null);
    assert.equal(result.signal, 'SIGKILL');
    assert.equal(result.timedOut, !watched);
    assert.equal(result.overflow, false);
    assert.equal(result.groupAlive, false);
    assert.equal(Buffer.from(result.stdout, 'base64').toString(), 'first\nsecond\nlate\n');
    assert.equal(result.stderr, '');
  }
});
