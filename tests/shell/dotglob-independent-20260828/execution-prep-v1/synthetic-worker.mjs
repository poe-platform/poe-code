import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readLoadManifest } from './admission.mjs';
import { installGuard } from './guard.mjs';
import { emit, executeRows } from './settlement.mjs';

const mode = process.argv[2];
if (mode === 'load') {
  try {
    const loaded = readLoadManifest(process.env.DOTGLOB_MANIFEST, process.env.DOTGLOB_MANIFEST_SHA256, 'dotglob-synthetic-load-v1');
    installGuard(loaded);
    const module = await import(pathToFileURL(loaded.manifest.fixtureModule).href);
    await executeRows([{ id: 'fixture-value' }], async () => {
      assert.equal(module.probe(), 41);
      return { synthetic: true };
    });
    emit({ activation: { id: 'synthetic-value-mutant', hits: module.hits() } });
  } catch (error) { emit({ diagnostic: String(error?.stack ?? error) }); process.exitCode = 78; }
} else if (mode === 'procedures') {
  const { procedureCase, checkpoints, validateAdapters } = await import('./procedures.mjs');
  const { cases } = await import('./plan.mjs');
  const adapters = Object.fromEntries(cases().procedures.map(row => [row.id, async ({ check, resources }) => {
    let retired = false;
    resources.own({ async dispose() { retired = true; } });
    for (const name of checkpoints[row.id]) check(name, { synthetic: true, id: row.id }, { synthetic: true, id: row.id });
    assert.equal(retired, false);
  }]));
  validateAdapters(adapters);
  if (process.argv[3] === 'missing-checkpoint') adapters.R01 = async () => undefined;
  await executeRows(cases().procedures, (row, resources) => procedureCase(adapters, row, resources, { kind: 'synthetic-only' }));
} else if (mode === 'aggregate' || mode === 'falsy' || mode === 'cleanup') {
  const events = [];
  await executeRows([{ id: 'first' }, { id: 'second' }], async (row, resources) => {
    resources.own({ async dispose() { events.push(`dispose:${row.id}`); if (mode === 'cleanup' && row.id === 'first') throw new Error('owned-cleanup'); } });
    if (row.id === 'first') { if (mode === 'falsy') throw undefined; if (mode === 'aggregate') throw new Error('ordinary-failure'); }
    return { priorDisposed: events.includes('dispose:first') };
  });
  emit({ diagnostic: { events } });
} else if (mode === 'timeout') {
  setInterval(() => undefined, 1000);
} else if (mode === 'overflow') {
  process.stdout.write('x'.repeat(8192));
} else {
  const observation = { id: 'only', pass: mode !== 'ordinary', settled: true, disposed: mode !== 'unretired', value: '雪' };
  const rows = [{ observation }, { summary: { cases: 1, pass: observation.pass ? 1 : 0, failed: observation.pass ? [] : ['only'] } }];
  if (mode === 'duplicate') rows.splice(1, 0, { observation });
  if (mode === 'missing') rows.splice(0, 1);
  if (mode === 'summary') rows.at(-1).summary.pass = 99;
  if (mode === 'malformed') process.stdout.write('{broken\n');
  const text = rows.map(value => JSON.stringify(value) + '\n').join('');
  if (mode === 'split-utf8') {
    const bytes = Buffer.from(text), start = bytes.indexOf(Buffer.from('雪'));
    process.stdout.write(bytes.subarray(0, start + 1));
    await new Promise(resolve => setTimeout(resolve, 5));
    process.stdout.write(bytes.subarray(start + 1));
  } else process.stdout.write(text);
  if (mode === 'late-exit') process.exitCode = 7;
  if (mode === 'late-throw') throw new Error('late-after-all-PASS');
  if (mode === 'ordinary') process.exitCode = 1;
}
