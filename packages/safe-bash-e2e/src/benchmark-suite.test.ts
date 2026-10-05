import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  BenchmarkRecorder,
  compareBenchmarkRuns,
  formatBenchmarkRunMarkdown,
  formatComparisonMarkdown,
  type BenchmarkRunRecord,
} from "./benchmark.js";
import { runStandardBenchmarkSuite } from "./benchmark-workloads.js";
import { withE2EHarness } from "./harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCHMARKS_DIR = path.resolve(__dirname, "../benchmarks");

test("every harness.exec call records high-resolution durationMs, cpuUsage, and byte counts", async () => {
  await withE2EHarness(async (h) => {
    const res = await h.exec("seq 1 50 | awk '{ s += $1 } END { print s }'");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "1275\n");
    assert.ok(res.metrics.durationMs >= 0);
    assert.ok(res.metrics.cpuUserUs >= 0);
    assert.ok(res.metrics.cpuSystemUs >= 0);
    assert.equal(res.metrics.stdoutBytes, 5);
    assert.equal(res.metrics.stderrBytes, 0);
    assert.equal(h.recorder.execSamples.length, 1);
  });
});

test("BenchmarkRecorder.measureScenario computes p50, p95, p99, opsPerSec, and geometricMeanMs", async () => {
  const recorder = new BenchmarkRecorder();
  await withE2EHarness(async (h) => {
    const m = await recorder.measureScenario(
      "micro-pipeline",
      async () => {
        const res = await h.exec("printf 'a\\nb\\nc\\n' | sort -r | tr '\\n' ':'");
        assert.equal(res.stdout, "c:b:a:");
        return res.stdout.length;
      },
      { category: "pipelines", warmup: 1, iterations: 3 },
    );

    assert.equal(m.name, "micro-pipeline");
    assert.equal(m.category, "pipelines");
    assert.equal(m.iterations, 3);
    assert.ok(m.minMs <= m.p50Ms);
    assert.ok(m.p50Ms <= m.p95Ms);
    assert.ok(m.p95Ms <= m.maxMs);
    assert.ok(m.opsPerSec > 0);
  });

  const record = recorder.buildRunRecord({
    runId: "unit-test-run",
    label: "Unit Test Run",
    backend: "ts-safe-bash",
    optimizationTag: "test",
  });
  assert.equal(record.summary.totalScenarios, 1);
  assert.ok(record.summary.geometricMeanMs > 0);

  const md = formatBenchmarkRunMarkdown(record);
  assert.match(md, /# Benchmark Run: Unit Test Run/);
  assert.match(md, /micro-pipeline/);
});

test("runStandardBenchmarkSuite executes all 26 E2E workloads and produces complete metrics", async () => {
  const run = await runStandardBenchmarkSuite({
    runId: "test-suite-check",
    label: "Test Suite Check",
    profile: "warm-memory-fastpath",
    warmup: 0,
    iterations: 1,
  });

  assert.equal(run.scenarios.length, 26);
  for (const s of run.scenarios) {
    assert.ok(s.p50Ms >= 0, `Scenario ${s.name} should have non-negative p50Ms`);
    assert.ok(s.opsPerSec > 0, `Scenario ${s.name} should have positive opsPerSec`);
  }
});

test("stored baseline benchmark runs in benchmarks/ load cleanly and compare without missing scenarios", () => {
  const files = [
    "ts-baseline-warm-memory-fastpath.json",
    "ts-baseline-overlay-cow-fs.json",
    "ts-baseline-strict-budgets-mount-dev.json",
  ];

  const loaded: BenchmarkRunRecord[] = files.map((file) => {
    const fullPath = path.join(BENCHMARKS_DIR, file);
    assert.ok(fs.existsSync(fullPath), `Missing stored benchmark baseline: ${fullPath}`);
    return JSON.parse(fs.readFileSync(fullPath, "utf8")) as BenchmarkRunRecord;
  });

  for (const run of loaded) {
    assert.equal(run.scenarios.length, 26);
    assert.ok(run.summary.geometricMeanMs > 0);
  }

  const comparison = compareBenchmarkRuns(loaded[1]!, loaded[0]!);
  assert.equal(comparison.scenarios.length, 26);
  assert.ok(comparison.overallGeometricMeanSpeedup > 0);

  const md = formatComparisonMarkdown(comparison);
  assert.match(md, /Geometric Mean Speedup \(p50\)/);
  assert.match(md, /vfs-tree-clone-chmod-stat/);
});
