import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const output = process.env.SORT_REPORT;
const raw = JSON.parse(await readFile(join(output, 'matched-measurements.json')));
const median = values => { const sorted = [...values].sort((left, right) => left - right); return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2; };
assert.equal(raw.rows.length, 720); assert.equal(raw.warmups.reduce((count, row) => count + row.samples.length, 0), 450);
assert.equal(raw.events.length, 183); assert.ok(raw.events.every(event => event.exited && event.code === 0 && !event.forced));
const workloads = [];
for (const workload of [...new Set(raw.rows.map(row => row.workload))]) {
  const phases = {};
  for (const phase of ['warm', 'cold']) {
    const count = phase === 'warm' ? 18 : 6, rows = raw.rows.filter(row => row.workload === workload && row.phase === phase), variants = {};
    for (const variant of ['base', 'candidate', 'baseline']) {
      const selected = rows.filter(row => row.variant === variant); assert.equal(selected.length, count);
      assert.deepEqual(selected.map(row => row.sample).sort((left, right) => left - right), Array.from({ length: count }, (_, index) => index));
      if (variant !== 'baseline') assert.ok(selected.every(row => row.equivalent));
      variants[variant] = { total: selected.length, matched: selected.filter(row => row.equivalent).length, medianMs: median(selected.map(row => row.milliseconds)),
        ...(phase === 'cold' ? { medianWallMs: median(selected.map(row => row.coldWallToResultMs)) } : {}) };
    }
    const pairs = Array.from({ length: count }, (_, sample) => {
      const before = rows.find(row => row.sample === sample && row.variant === 'base'), after = rows.find(row => row.sample === sample && row.variant === 'candidate');
      assert.equal(before.equivalent, true); assert.equal(after.equivalent, true); return before.milliseconds / after.milliseconds;
    });
    phases[phase] = { variants, pairedMedianBaseOverCandidate: median(pairs), fasterPairs: pairs.filter(value => value > 1).length,
      medianReductionPercent: 100 * (1 - variants.candidate.medianMs / variants.base.medianMs), baselineComparisonEligible: variants.baseline.matched === count };
  }
  workloads.push({ workload, phases });
}
const assessment = { capturedAt: new Date().toISOString(), timingStartedAt: raw.startedAt, timingFinishedAt: raw.finishedAt, measuredRows: raw.rows.length, warmupExecutions: 450,
  sourceDeltaAccepted: true, overallSuperiority: false, independentGate: 'exact candidate plus matched-output representative material gains; not universal speedup', workloads,
  loadOneMinuteRange: [Math.min(...raw.rows.map(row => row.loadBefore[0])), Math.max(...raw.rows.map(row => row.loadBefore[0]))],
  matchedCounts: Object.fromEntries(['base', 'candidate', 'baseline'].map(variant => [variant, { total: raw.rows.filter(row => row.variant === variant).length, matched: raw.rows.filter(row => row.variant === variant && row.equivalent).length }])),
  cleanup: { timingChildren: raw.events.length, allExited: true, forced: 0 }, memory: 'before/after and process-lifetime RSS observations only; no per-command peak or hard bound' };
await writeFile(join(output, 'INDEPENDENT_ASSESSMENT.json'), JSON.stringify(assessment, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ measuredRows: assessment.measuredRows, matchedCounts: assessment.matchedCounts, load: assessment.loadOneMinuteRange }));
