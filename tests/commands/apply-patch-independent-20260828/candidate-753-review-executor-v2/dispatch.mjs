import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate as turn } from 'node:timers/promises';
import { legacy } from './legacy.mjs';
import { s54 } from './s54.mjs';

const job = globalThis.reviewJob;
const unhandled = [];
const onUnhandled = reason => unhandled.push(reason);
process.on('unhandledRejection', onUnhandled);
const outcomes = [];
const roles = new Set(['regression', 'fixture-tail', 'independent-s54', 'instrumented-s54', 'limit', 'adapter', 'original-mutant']);
assert.ok(roles.has(job.role));
const base = job.graphs[0];
if (['regression', 'fixture-tail', 'limit', 'adapter'].includes(job.role)) {
  const result = await legacy({ ...job, product: base.product }); outcomes.push(result);
  if (job.role === 'regression') {
    process.env.PRODUCT_ROOT = base.product; process.env.FIXTURE_ROOT = job.fixtureRoot;
    const author = []; const log = console.log;
    const timer = setTimeout(() => { console.error('AUTHOR_COHORT_TIMEOUT_UNSAFE_STOP'); process.exit(91); }, 30000);
    console.log = (...values) => {
      if (values.length === 1 && typeof values[0] === 'string') {
        const record = JSON.parse(values[0]); author.push(record); assert.ok(author.length <= 64);
      }
      log(...values);
    };
    try { await import(pathToFileURL(path.join(job.consumer, 'author.mjs')).href); }
    finally { console.log = log; clearTimeout(timer); delete process.env.PRODUCT_ROOT; delete process.env.FIXTURE_ROOT; }
    const summary = author.at(-1)?.summary;
    assert.equal(summary?.cases, 63); assert.equal(author.length, 64); assert.equal(summary.shells, summary.disposed);
    outcomes.push({ kind: 'unchanged-author', cases: author.slice(0, -1), ...summary });
  }
} else if (job.role === 'independent-s54') {
  outcomes.push(await s54(job, base));
} else if (job.role === 'instrumented-s54') {
  for (const graph of job.graphs.filter(graph => graph.instrumented)) {
    globalThis.s54Hooks = { events: [], record(event) { assert.ok(this.events.length < 4096); this.events.push(event); } };
    const result = await s54(job, graph, true);
    const failed = result.results.filter(row => row.status === 'FAIL');
    const markerSeen = globalThis.reviewMarkers.includes(graph.marker);
    outcomes.push({ ...result, graph: graph.id, expectedMutant: graph.mutant ?? null, markerSeen,
      accepted: graph.mutant ? markerSeen && failed.some(row => row.id === graph.killedBy) : markerSeen && failed.length === 0 });
  }
} else {
  for (const graph of job.graphs.filter(graph => graph.phase)) {
    const result = await legacy({ ...job, product: graph.product, layout: 'source', ids: job.ids, cap: job.cap, endpoint: job.endpoint });
    const markerSeen = globalThis.reviewMarkers.includes(graph.marker);
    const failed = result.cases.some(row => row.status === 'FAIL');
    outcomes.push({ ...result, graph: graph.id, phase: graph.phase, markerSeen, accepted: markerSeen && (graph.phase === 'mutant' ? failed : !failed) });
  }
}
await turn(); await turn();
assert.equal(unhandled.length, 0, 'late unhandled rejection stops dependent admission');
assert.deepEqual(Object.fromEntries(Object.entries(process.env).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)), job.env);
process.removeListener('unhandledRejection', onUnhandled);
const complete = outcomes.every(row => row.complete !== false);
console.log(JSON.stringify({ kind: 'final', job: job.id, role: job.role, complete, outcomes, loads: globalThis.reviewLoads, markers: globalThis.reviewMarkers, unhandled: unhandled.length }));
process.exitCode = complete ? 0 : 91;
