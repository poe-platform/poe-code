import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifact, directory, frozenPreparation, handoff, root, snapshot, summarize } from './common.mjs';
import { loadFrozen } from '../jq-grammar-independent/evidence.mjs';
import { compare, createExecutor } from '../jq-grammar-independent/harness.mjs';

const mode = process.argv[2];
assert.ok(['source', 'compiled'].includes(mode));
const label = process.argv.slice(3).find(argument => argument !== '--worker') ?? mode;
assert.match(label, /^[a-z0-9][a-z0-9-]*$/u);
if (!process.argv.includes('--worker')) {
  const command = [process.execPath, '--unhandled-rejections=strict', '--import', 'tsx', ...process.argv.slice(1), '--worker'];
  const before = snapshot();
  const result = spawnSync(command[0], command.slice(1), { cwd: root, timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
  artifact(`${label}-command.json`, { command, watchdogMs: 240000, before, after: snapshot(), status: result.status,
    signal: result.signal, error: result.error?.message, stdoutHex: result.stdout?.toString('hex'), stderrHex: result.stderr?.toString('hex') });
  console.log(result.stdout?.toString());
  console.error(result.stderr?.toString());
  process.exitCode = result.status ?? 2;
} else {
  const startedAt = new Date().toISOString();
  const before = snapshot();
  const preparation = frozenPreparation();
  const evidence = loadFrozen();
  const built = mode === 'compiled' ? await (await import('./build.mjs')).build() : undefined;
  const api = built?.api ?? await import('../../../../src/index.ts');
  const execute = await createExecutor(api);
  const mainExecute = mode === 'source' ? await (await import('../jq-42-independent-review/harness.ts')).loadPublicHarness() : execute;
  const boundaries = [{ phase: 'after-import', source: snapshot() }];
  const results = [];
  for (const [cohort, vectors] of Object.entries(evidence.cohorts)) {
    for (const vector of vectors) for (const route of ['direct', 'shell']) for (const transport of vector.schedules) {
      const row = { cohort, id: vector.id, route, transport, expected: vector.expected,
        original42: evidence.main.original.has(`${vector.cohort}:${vector.id}`) };
      try {
        const observed = await (cohort === 'main' ? mainExecute : execute)(vector, route, transport);
        results.push({ ...row, ...observed, ...compare(vector, route, observed) });
      } catch (error) { results.push({ ...row, pass: false, error: error?.stack ?? String(error) }); }
    }
    boundaries.push({ phase: `after-${cohort}`, source: snapshot() });
  }
  const after = snapshot();
  loadFrozen();
  frozenPreparation();
  const stableProduct = [...boundaries.map(row => row.source), after].every(row => row.productSha256 === before.productSha256);
  const stableTooling = [...boundaries.map(row => row.source), after].every(row => JSON.stringify(row.tooling) === JSON.stringify(before.tooling));
  const summary = Object.fromEntries(Object.keys(evidence.cohorts).map(name => [name, summarize(results.filter(row => row.cohort === name))]));
  summary.original42IncludedInMain = summarize(results.filter(row => row.original42));
  const legacyBaselinePath = 'tests/commands/structured-stress/jq-42-independent-final/r2-legacy.json';
  const legacyBaseline = JSON.parse(readFileSync(join(root, legacyBaselinePath)));
  artifact(`${label}-cohorts.json`, { handoff, mode, startedAt, endedAt: new Date().toISOString(), before, after, boundaries,
    preparation, manifestSha256: evidence.manifestSha256, immutableAfter: true, stableProduct, stableTooling,
    build: built?.record, summary, vectors: evidence.cohorts, results,
    legacyHistoricalBaseline: { path: legacyBaselinePath, summary: legacyBaseline.summary,
      note: 'Original 94: 45 exact / 49 differences, 180/376 exact. Original 42 remain an included 84-execution subset, never additional credit.' },
    limits: 'No skips, expected-byte edits, diagnostic normalization or source fixes. Stable structured handoff is enforced before every phase. Whole product is moving/dirty; phase equality is not a clean HEAD or ABA guarantee.' });
  built?.hooks.deregister();
  console.log(JSON.stringify({ mode, summary, stableProduct, stableTooling }, null, 2));
  process.exitCode = results.some(row => !row.pass) ? 1 : 0;
}
