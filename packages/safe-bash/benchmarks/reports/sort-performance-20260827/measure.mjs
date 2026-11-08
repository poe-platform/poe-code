import assert from 'node:assert/strict';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cpus, loadavg, release, totalmem } from 'node:os';
import { session } from './session.mjs';

const own = dirname(import.meta.filename), root = (await readFile(process.env.SORT_STATE ?? join(own, 'scratch-path.txt'), 'utf8')).trim();
await cp(join(own, 'worker.mjs'), join(root, 'harness/worker.mjs'));
const workloads = JSON.parse(await readFile(join(root, 'workloads.json'), 'utf8'));
const orders = [['base', 'candidate', 'baseline'], ['baseline', 'base', 'candidate'], ['candidate', 'baseline', 'base'],
  ['base', 'baseline', 'candidate'], ['candidate', 'base', 'baseline'], ['baseline', 'candidate', 'base']];
const events = [], rows = [], warmups = [], workers = {};
const report = { startedAt: new Date().toISOString(), node: process.version, versions: process.versions, platform: process.platform,
  release: release(), cpu: cpus()[0], cpuCount: cpus().length, totalmem: totalmem(), orders, events, rows, warmups,
  protocol: { warmupPerWorkload: 15, warmSamples: 18, coldSamples: 6, variants: orders[0], caseCount: workloads.length,
    timer: 'performance.now around actual public shell.exec, fixture reset and byte comparison outside timer',
    cold: 'fresh process/import/registry per sample; first exec timed separately and parent fork-to-result recorded',
    memory: 'before/after snapshots plus lifetime process maxRSS, not per-operation peak or guaranteed bound' } };
const save = name => writeFile(join(process.env.SORT_REPORT ?? join(own, 'evidence'), `${name}.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
try {
  for (const variant of orders[0]) workers[variant] = await session(root, variant, events);
  for (const specimen of workloads) {
    for (const variant of orders[0]) {
      const response = await workers[variant].request({ workload: specimen.id, repetitions: 15 });
      assert.ok(!response.error, response.error); warmups.push({ variant, workload: specimen.id, samples: response.samples });
      await workers[variant].request({ gc: true });
    }
    for (let sample = 0; sample < 18; sample++) for (const variant of orders[sample % orders.length]) {
      const loadBefore = loadavg(), response = await workers[variant].request({ workload: specimen.id });
      assert.ok(!response.error, response.error);
      rows.push({ phase: 'warm', sample, variant, workload: specimen.id, loadBefore, loadAfter: loadavg(), ...response.samples[0] });
    }
    console.log('warm', specimen.id, rows.filter(row => row.workload === specimen.id).reduce((counts, row) => { counts[row.variant] = (counts[row.variant] ?? 0) + Number(row.equivalent); return counts; }, {}));
  }
  for (const worker of Object.values(workers)) await worker.close();
  for (const specimen of workloads) {
    for (let sample = 0; sample < 6; sample++) for (const variant of orders[sample]) {
      const start = performance.now(), loadBefore = loadavg(), worker = await session(root, variant, events);
      try {
        const response = await worker.request({ workload: specimen.id }); assert.ok(!response.error, response.error);
        rows.push({ phase: 'cold', sample, variant, workload: specimen.id, loadBefore, loadAfter: loadavg(),
          coldWallToResultMs: performance.now() - start, forkToReadyMs: worker.event.forkToReadyMs, importAndSetupMs: worker.event.ready.importAndSetupMs,
          ...response.samples[0] });
      } finally { await worker.close(); }
    }
    console.log('cold', specimen.id);
  }
} finally {
  for (const worker of Object.values(workers)) await worker.close();
  report.finishedAt = new Date().toISOString(); await save('matched-measurements');
}
