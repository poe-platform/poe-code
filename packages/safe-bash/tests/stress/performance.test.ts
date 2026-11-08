import assert from "node:assert/strict";
import test from "node:test";
import { latencySummary, performanceWorkloads } from "../../benchmarks/performance-workloads.js";

test("performance pilot retains a fixed size-scaled twelve-workload matrix", () => {
  const workloads = performanceWorkloads();
  assert.equal(workloads.length, 12);
  assert.equal(new Set(workloads.map(workload => workload.name)).size, 12);
  assert.equal(workloads.filter(workload => workload.name.startsWith("sed-")).length, 3);
  assert.equal(workloads.filter(workload => workload.name.startsWith("awk-")).length, 3);
  assert.equal(Buffer.from(workloads.find(workload => workload.name === "bytes-1048576")!.stdin, "base64").length, 1024 * 1024);
  assert.equal(Object.keys(workloads.find(workload => workload.name === "filesystem-128-writes")!.expected.files).length, 128);
  assert.deepEqual(workloads, performanceWorkloads());
});

test("latency summaries retain outliers and do not mutate raw samples", () => {
  const samples = [100, 1, 3, 2];
  assert.deepEqual(latencySummary(samples), { count: 4, minMs: 1, medianMs: 2.5, p95Ms: 100, maxMs: 100 });
  assert.deepEqual(samples, [100, 1, 3, 2]);
  for (const invalid of [[], [-1], [NaN], [Infinity]]) assert.throws(() => latencySummary(invalid), RangeError);
});
