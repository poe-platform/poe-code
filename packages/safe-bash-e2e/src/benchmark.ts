import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

export interface ExecPerformanceSample {
  readonly durationMs: number;
  readonly cpuUserUs: number;
  readonly cpuSystemUs: number;
  readonly heapDeltaBytes: number;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
}

export interface ScenarioBenchmarkMetrics {
  readonly name: string;
  readonly category: string;
  readonly iterations: number;
  readonly warmupIterations: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly stddevMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly totalMs: number;
  readonly opsPerSec: number;
  readonly meanCpuUserUs: number;
  readonly meanCpuSystemUs: number;
  readonly meanHeapDeltaBytes: number;
  readonly bytesProcessed: number;
  readonly throughputBytesPerSec: number;
}

export interface BenchmarkRunRecord {
  readonly runId: string;
  readonly label: string;
  readonly backend: "ts-safe-bash" | "rust-hybrid-bridge" | "rust-native-zero-dep" | "wasm" | string;
  readonly optimizationTag: string;
  readonly timestamp: string;
  readonly gitCommit?: string | undefined;
  readonly environment: {
    readonly nodeVersion: string;
    readonly platform: string;
    readonly arch: string;
    readonly cpuModel: string;
    readonly cpuCores: number;
  };
  readonly scenarios: readonly ScenarioBenchmarkMetrics[];
  readonly summary: {
    readonly totalScenarios: number;
    readonly totalDurationMs: number;
    readonly geometricMeanMs: number;
    readonly meanOpsPerSec: number;
  };
}

export interface ScenarioComparison {
  readonly name: string;
  readonly category: string;
  readonly baselineP50Ms: number;
  readonly candidateP50Ms: number;
  readonly baselineMeanMs: number;
  readonly candidateMeanMs: number;
  readonly speedupP50: number;
  readonly speedupMean: number;
  readonly deltaPercentP50: number;
  readonly baselineOpsPerSec: number;
  readonly candidateOpsPerSec: number;
}

export interface BenchmarkComparisonReport {
  readonly baselineRunId: string;
  readonly baselineLabel: string;
  readonly baselineBackend: string;
  readonly candidateRunId: string;
  readonly candidateLabel: string;
  readonly candidateBackend: string;
  readonly overallGeometricMeanSpeedup: number;
  readonly overallTotalDurationSpeedup: number;
  readonly scenarios: readonly ScenarioComparison[];
}

export interface MeasureScenarioOptions {
  readonly category?: string;
  readonly warmup?: number;
  readonly iterations?: number;
  readonly bytesProcessedPerIteration?: number;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = sorted[base]!;
  const upper = sorted[Math.min(sorted.length - 1, base + 1)]!;
  return lower + rest * (upper - lower);
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export async function measureSingleExec<T>(
  fn: () => Promise<T>,
  extractBytes?: (result: T) => { stdoutBytes: number; stderrBytes: number },
): Promise<{ result: T; metrics: ExecPerformanceSample }> {
  const memBefore = process.memoryUsage().heapUsed;
  const cpuBefore = process.cpuUsage();
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  const cpuDelta = process.cpuUsage(cpuBefore);
  const memAfter = process.memoryUsage().heapUsed;
  const sizes = extractBytes ? extractBytes(result) : { stdoutBytes: 0, stderrBytes: 0 };

  return {
    result,
    metrics: {
      durationMs: roundMetric(durationMs),
      cpuUserUs: cpuDelta.user,
      cpuSystemUs: cpuDelta.system,
      heapDeltaBytes: memAfter - memBefore,
      stdoutBytes: sizes.stdoutBytes,
      stderrBytes: sizes.stderrBytes,
    },
  };
}

export class BenchmarkRecorder {
  readonly #scenarios: ScenarioBenchmarkMetrics[] = [];
  readonly #execSamples: { label: string; sample: ExecPerformanceSample }[] = [];

  recordExecSample(label: string, sample: ExecPerformanceSample): void {
    this.#execSamples.push({ label, sample });
  }

  get execSamples(): readonly { label: string; sample: ExecPerformanceSample }[] {
    return this.#execSamples;
  }

  get scenarios(): readonly ScenarioBenchmarkMetrics[] {
    return this.#scenarios;
  }

  async measureScenario(
    name: string,
    fn: (iteration: number) => Promise<number | void>,
    options: MeasureScenarioOptions = {},
  ): Promise<ScenarioBenchmarkMetrics> {
    const category = options.category ?? "general";
    const warmup = options.warmup ?? 2;
    const iterations = Math.max(1, options.iterations ?? 5);

    for (let i = 0; i < warmup; i++) {
      await fn(-1 - i);
    }

    const durations: number[] = [];
    let totalCpuUserUs = 0;
    let totalCpuSystemUs = 0;
    let totalHeapDelta = 0;
    let totalBytesProcessed = 0;

    for (let i = 0; i < iterations; i++) {
      const memBefore = process.memoryUsage().heapUsed;
      const cpuBefore = process.cpuUsage();
      const start = performance.now();
      const returnedBytes = await fn(i);
      const elapsed = performance.now() - start;
      const cpuDelta = process.cpuUsage(cpuBefore);
      const memAfter = process.memoryUsage().heapUsed;

      durations.push(elapsed);
      totalCpuUserUs += cpuDelta.user;
      totalCpuSystemUs += cpuDelta.system;
      totalHeapDelta += Math.max(0, memAfter - memBefore);
      totalBytesProcessed +=
        typeof returnedBytes === "number"
          ? returnedBytes
          : (options.bytesProcessedPerIteration ?? 0);
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const totalMs = durations.reduce((acc, d) => acc + d, 0);
    const meanMs = totalMs / iterations;
    const variance =
      durations.reduce((acc, d) => acc + (d - meanMs) ** 2, 0) / iterations;
    const stddevMs = Math.sqrt(variance);
    const minMs = sorted[0]!;
    const maxMs = sorted[sorted.length - 1]!;
    const p50Ms = quantile(sorted, 0.5);
    const p95Ms = quantile(sorted, 0.95);
    const p99Ms = quantile(sorted, 0.99);
    const opsPerSec = meanMs > 0 ? 1000 / meanMs : 0;
    const throughputBytesPerSec =
      totalMs > 0 ? (totalBytesProcessed * 1000) / totalMs : 0;

    const metrics: ScenarioBenchmarkMetrics = {
      name,
      category,
      iterations,
      warmupIterations: warmup,
      minMs: roundMetric(minMs),
      maxMs: roundMetric(maxMs),
      meanMs: roundMetric(meanMs),
      stddevMs: roundMetric(stddevMs),
      p50Ms: roundMetric(p50Ms),
      p95Ms: roundMetric(p95Ms),
      p99Ms: roundMetric(p99Ms),
      totalMs: roundMetric(totalMs),
      opsPerSec: roundMetric(opsPerSec),
      meanCpuUserUs: Math.round(totalCpuUserUs / iterations),
      meanCpuSystemUs: Math.round(totalCpuSystemUs / iterations),
      meanHeapDeltaBytes: Math.round(totalHeapDelta / iterations),
      bytesProcessed: totalBytesProcessed,
      throughputBytesPerSec: Math.round(throughputBytesPerSec),
    };

    this.#scenarios.push(metrics);
    return metrics;
  }

  buildRunRecord(options: {
    runId: string;
    label: string;
    backend?: string;
    optimizationTag?: string;
    gitCommit?: string;
    timestamp?: string;
  }): BenchmarkRunRecord {
    const cpus = os.cpus();
    const totalDurationMs = roundMetric(
      this.#scenarios.reduce((acc, s) => acc + s.totalMs, 0),
    );
    const logSum = this.#scenarios.reduce(
      (acc, s) => acc + Math.log(Math.max(0.001, s.p50Ms)),
      0,
    );
    const geometricMeanMs =
      this.#scenarios.length > 0
        ? roundMetric(Math.exp(logSum / this.#scenarios.length))
        : 0;
    const meanOpsPerSec =
      this.#scenarios.length > 0
        ? roundMetric(
            this.#scenarios.reduce((acc, s) => acc + s.opsPerSec, 0) /
              this.#scenarios.length,
          )
        : 0;

    return {
      runId: options.runId,
      label: options.label,
      backend: options.backend ?? "ts-safe-bash",
      optimizationTag: options.optimizationTag ?? "baseline",
      timestamp: options.timestamp ?? new Date().toISOString(),
      gitCommit: options.gitCommit,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cpuModel: cpus[0]?.model ?? "unknown",
        cpuCores: cpus.length,
      },
      scenarios: [...this.#scenarios],
      summary: {
        totalScenarios: this.#scenarios.length,
        totalDurationMs,
        geometricMeanMs,
        meanOpsPerSec,
      },
    };
  }
}

export function compareBenchmarkRuns(
  baseline: BenchmarkRunRecord,
  candidate: BenchmarkRunRecord,
): BenchmarkComparisonReport {
  const baselineByName = new Map(baseline.scenarios.map((s) => [s.name, s]));
  const scenarios: ScenarioComparison[] = [];

  for (const cand of candidate.scenarios) {
    const base = baselineByName.get(cand.name);
    if (!base) continue;
    const speedupP50 =
      cand.p50Ms > 0 ? roundMetric(base.p50Ms / cand.p50Ms) : 1;
    const speedupMean =
      cand.meanMs > 0 ? roundMetric(base.meanMs / cand.meanMs) : 1;
    const deltaPercentP50 =
      base.p50Ms > 0
        ? roundMetric(((cand.p50Ms - base.p50Ms) / base.p50Ms) * 100)
        : 0;

    scenarios.push({
      name: cand.name,
      category: cand.category,
      baselineP50Ms: base.p50Ms,
      candidateP50Ms: cand.p50Ms,
      baselineMeanMs: base.meanMs,
      candidateMeanMs: cand.meanMs,
      speedupP50,
      speedupMean,
      deltaPercentP50,
      baselineOpsPerSec: base.opsPerSec,
      candidateOpsPerSec: cand.opsPerSec,
    });
  }

  const logSpeedupSum = scenarios.reduce(
    (acc, s) => acc + Math.log(Math.max(0.0001, s.speedupP50)),
    0,
  );
  const overallGeometricMeanSpeedup =
    scenarios.length > 0
      ? roundMetric(Math.exp(logSpeedupSum / scenarios.length))
      : 1;
  const overallTotalDurationSpeedup =
    candidate.summary.totalDurationMs > 0
      ? roundMetric(
          baseline.summary.totalDurationMs / candidate.summary.totalDurationMs,
        )
      : 1;

  return {
    baselineRunId: baseline.runId,
    baselineLabel: baseline.label,
    baselineBackend: baseline.backend,
    candidateRunId: candidate.runId,
    candidateLabel: candidate.label,
    candidateBackend: candidate.backend,
    overallGeometricMeanSpeedup,
    overallTotalDurationSpeedup,
    scenarios,
  };
}

export function formatBenchmarkRunMarkdown(run: BenchmarkRunRecord): string {
  const lines: string[] = [
    `# Benchmark Run: ${run.label} (\`${run.runId}\`)`,
    "",
    `- **Backend**: \`${run.backend}\``,
    `- **Optimization Tag**: \`${run.optimizationTag}\``,
    `- **Timestamp**: \`${run.timestamp}\``,
    ...(run.gitCommit ? [`- **Git Commit**: \`${run.gitCommit}\``] : []),
    `- **Platform**: \`${run.environment.platform}/${run.environment.arch}\` (${run.environment.cpuCores} cores, Node \`${run.environment.nodeVersion}\`)`,
    `- **Total Scenarios**: ${run.summary.totalScenarios}`,
    `- **Geometric Mean p50**: ${run.summary.geometricMeanMs} ms`,
    `- **Total Suite Duration**: ${run.summary.totalDurationMs} ms`,
    "",
    "| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const s of run.scenarios) {
    lines.push(
      `| ${s.category} | ${s.name} | ${s.p50Ms.toFixed(2)} | ${s.p95Ms.toFixed(2)} | ${s.meanMs.toFixed(2)} | ${s.minMs.toFixed(2)} | ${s.maxMs.toFixed(2)} | ${s.opsPerSec.toFixed(1)} | ${s.meanCpuUserUs} |`,
    );
  }

  return lines.join("\n") + "\n";
}

export function formatComparisonMarkdown(
  report: BenchmarkComparisonReport,
): string {
  const lines: string[] = [
    `# Benchmark Comparison: \`${report.baselineLabel}\` vs \`${report.candidateLabel}\``,
    "",
    `- **Baseline**: \`${report.baselineRunId}\` (\`${report.baselineBackend}\`)`,
    `- **Candidate**: \`${report.candidateRunId}\` (\`${report.candidateBackend}\`)`,
    `- **Geometric Mean Speedup (p50)**: **${report.overallGeometricMeanSpeedup.toFixed(2)}x**`,
    `- **Total Duration Speedup**: **${report.overallTotalDurationSpeedup.toFixed(2)}x**`,
    "",
    "| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
  ];

  for (const s of report.scenarios) {
    const sign = s.deltaPercentP50 > 0 ? "+" : "";
    lines.push(
      `| ${s.category} | ${s.name} | ${s.baselineP50Ms.toFixed(2)} | ${s.candidateP50Ms.toFixed(2)} | **${s.speedupP50.toFixed(2)}x** | ${sign}${s.deltaPercentP50.toFixed(1)}% |`,
    );
  }

  return lines.join("\n") + "\n";
}

export function saveBenchmarkRunToDirectory(
  directory: string,
  run: BenchmarkRunRecord,
): { jsonPath: string; markdownPath: string } {
  fs.mkdirSync(directory, { recursive: true });
  const safeId = run.runId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const jsonPath = path.join(directory, `${safeId}.json`);
  const markdownPath = path.join(directory, `${safeId}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(run, null, 2) + "\n", "utf8");
  fs.writeFileSync(markdownPath, formatBenchmarkRunMarkdown(run), "utf8");
  return { jsonPath, markdownPath };
}
