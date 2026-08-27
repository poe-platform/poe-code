import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const own = dirname(import.meta.filename), evidence = process.env.SORT_REPORT ?? join(own, 'evidence');
const report = JSON.parse(await readFile(join(evidence, 'matched-measurements.json'), 'utf8'));
function statistics(values) {
  const ordered = [...values].sort((left, right) => left - right), count = ordered.length;
  const percentile = fraction => { const position = (count - 1) * fraction, lower = Math.floor(position); return ordered[lower] + (ordered[Math.min(lower + 1, count - 1)] - ordered[lower]) * (position - lower); };
  const median = percentile(.5), deviations = values.map(value => Math.abs(value - median)).sort((left, right) => left - right);
  return { count, min: ordered[0], p25: percentile(.25), median, p75: percentile(.75), p90: percentile(.9), max: ordered.at(-1),
    medianAbsoluteDeviation: (deviations[Math.floor((count - 1) / 2)] + deviations[Math.floor(count / 2)]) / 2 };
}
const summary = { protocol: report.protocol, host: { node: report.node, cpu: report.cpu, cpuCount: report.cpuCount, release: report.release },
  workloads: [], cleanup: { children: report.events.length, allExited: report.events.every(event => event.exited), forced: report.events.filter(event => event.forced).length },
  memoryQualification: 'RSS/heap before-after samples and process lifetime maxRSS; not per-command peaks, an allocation cap, or a VM isolation guarantee.' };
for (const workload of [...new Set(report.rows.map(row => row.workload))]) {
  const values = { workload, phases: {} };
  for (const phase of ['warm', 'cold']) {
    const phaseRows = report.rows.filter(row => row.workload === workload && row.phase === phase);
    const variants = {};
    for (const variant of ['base', 'candidate', 'baseline']) {
      const selected = phaseRows.filter(row => row.variant === variant);
      variants[variant] = { milliseconds: statistics(selected.map(row => row.milliseconds)), exactNativeMatches: selected.filter(row => row.equivalent).length,
        ...(phase === 'cold' ? { coldWallToResultMs: statistics(selected.map(row => row.coldWallToResultMs)) } : {}),
        heapDeltaBytes: statistics(selected.map(row => row.memoryAfter.heapUsed - row.memoryBefore.heapUsed)),
        rssAfterBytes: statistics(selected.map(row => row.memoryAfter.rss)), lifetimeMaxRssKiB: statistics(selected.map(row => row.processLifetimeMaxRssKiB)) };
    }
    const pairs = phaseRows.filter(row => row.variant === 'base').map(base => {
      const candidate = phaseRows.find(row => row.variant === 'candidate' && row.sample === base.sample);
      assert.ok(candidate); return base.milliseconds / candidate.milliseconds;
    });
    values.phases[phase] = { variants, pairedBaseOverCandidate: statistics(pairs), candidateFasterPairs: pairs.filter(ratio => ratio > 1).length,
      medianReductionPercent: 100 * (1 - variants.candidate.milliseconds.median / variants.base.milliseconds.median),
      baselineSpeedComparisonEligible: variants.baseline.exactNativeMatches === variants.baseline.milliseconds.count };
  }
  summary.workloads.push(values);
}
const legacy = JSON.parse(execFileSync('git', ['show', '6e99656:tests/commands/core-regression-stress/evidence/performance.json'], { cwd: join(own, '../../..'), maxBuffer: 16 * 1024 * 1024 }));
const current = JSON.parse(await readFile(join(evidence, 'workloads-native.json'), 'utf8')).find(row => row.id === 'historical-sort-uniq-5000');
assert.equal(current.stdin, legacy.specimen.stdin); assert.equal(current.script, legacy.specimen.script); assert.equal(current.expected.stdout, legacy.expected.stdout);
summary.historicalRecipe = { unchangedScriptAndInputAndOutput: true, oldRecipeSha256: legacy.recipeSha256,
  inputSha256: createHash('sha256').update(Buffer.from(current.stdin, 'base64')).digest('hex'), outputSha256: legacy.nativeCheck.stdoutSha256,
  oldMedians: { original: 40.672, optimized: 10.811, baseline: 6.320 },
  caveat: 'Historical TS-source protocol with one warmup is not numerically interchangeable with this compiled current-source, resident-worker protocol with15 warmups.' };
await writeFile(join(evidence, 'SUMMARY.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(summary.workloads.map(row => ({ workload: row.workload, reduction: row.phases.warm.medianReductionPercent, pairs: row.phases.warm.candidateFasterPairs,
  warm: Object.fromEntries(Object.entries(row.phases.warm.variants).map(([variant, value]) => [variant, value.milliseconds])) })));
