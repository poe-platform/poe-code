import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { nativeCases, hostCases } from './cases.mjs';
import { owned, sourceGuard, sha256 } from './support.mjs';

export const batchSize = 8;

export async function runBatch(fixtures, execute, { deadline = 8000, guard = sourceGuard, expectedSource = process.env.CURRENT_SHELL_SOURCE_GUARD } = {}) {
  assert.ok(Array.isArray(fixtures) && fixtures.length > 0 && fixtures.length <= batchSize, 'Invalid current-shell batch size');
  assert.equal(new Set(fixtures.map(fixture => fixture.id)).size, fixtures.length, 'Duplicate current-shell fixture');
  assert.ok(Number.isSafeInteger(deadline) && deadline > 0 && deadline <= 8000, 'Invalid current-shell row deadline');
  const rows = [];
  for (const fixture of fixtures) {
    const watchdog = new Worker(
      'const { parentPort, workerData } = require("node:worker_threads"); setTimeout(() => process.kill(-workerData.pid, "SIGKILL"), workerData.deadline); parentPort.postMessage("armed");',
      { eval: true, execArgv: [], workerData: { pid: process.pid, deadline } },
    );
    try {
      await once(watchdog, 'message');
      const before = await guard();
      assert.equal(before.sha256, expectedSource, 'Import guard changed before fixture execution');
      const observation = await execute(fixture);
      const after = await guard();
      rows.push({ id: fixture.id, observation, fixtureSha256: sha256(await readFile(resolve(owned, 'cases.mjs'))), sourceGuard: { before, after, stable: before.sha256 === after.sha256 } });
    } finally { await watchdog.terminate(); }
  }
  return rows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const batched = process.argv[2] === '--batch';
  const ids = batched ? process.argv.slice(3) : [process.argv[2]];
  const fixtures = ids.map(id => {
    const fixture = [...nativeCases, ...hostCases].find(item => item.id === id);
    assert.ok(fixture, 'Known independent fixture');
    return fixture;
  });
  const before = await sourceGuard();
  assert.equal(before.sha256, process.env.CURRENT_SHELL_SOURCE_GUARD, 'Import guard changed before dynamic source imports');
  const { runFixture } = await import('./product-fixtures.mjs');
  const rows = await runBatch(fixtures, runFixture);
  process.stdout.write(JSON.stringify(batched ? rows : rows[0]));
}
