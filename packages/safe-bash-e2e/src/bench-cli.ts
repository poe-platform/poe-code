import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareBenchmarkRuns,
  formatComparisonMarkdown,
  saveBenchmarkRunToDirectory,
  type BenchmarkRunRecord,
} from "./benchmark.js";
import {
  runStandardBenchmarkSuite,
  type OptimizationProfile,
} from "./benchmark-workloads.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BENCH_DIR = path.resolve(__dirname, "../benchmarks");

function tryGetGitCommit(): string | undefined {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString("utf8")
      .trim();
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const compareIdx = args.indexOf("--compare");
  if (compareIdx !== -1 && args[compareIdx + 1] && args[compareIdx + 2]) {
    const basePath = path.resolve(args[compareIdx + 1]!);
    const candPath = path.resolve(args[compareIdx + 2]!);
    const baseRun = JSON.parse(
      fs.readFileSync(basePath, "utf8"),
    ) as BenchmarkRunRecord;
    const candRun = JSON.parse(
      fs.readFileSync(candPath, "utf8"),
    ) as BenchmarkRunRecord;
    const report = compareBenchmarkRuns(baseRun, candRun);
    const md = formatComparisonMarkdown(report);
    process.stdout.write(md);
    return;
  }

  const outDirIdx = args.indexOf("--out-dir");
  const outDir =
    outDirIdx !== -1 && args[outDirIdx + 1]
      ? path.resolve(args[outDirIdx + 1]!)
      : DEFAULT_BENCH_DIR;

  const iterationsIdx = args.indexOf("--iterations");
  const iterations =
    iterationsIdx !== -1 && args[iterationsIdx + 1]
      ? Number(args[iterationsIdx + 1])
      : 5;

  const warmupIdx = args.indexOf("--warmup");
  const warmup =
    warmupIdx !== -1 && args[warmupIdx + 1]
      ? Number(args[warmupIdx + 1])
      : 2;

  const gitCommit = tryGetGitCommit();
  const profiles: {
    profile: OptimizationProfile;
    runId: string;
    label: string;
    backend: string;
  }[] = [
    {
      profile: "warm-memory-fastpath",
      runId: "ts-baseline-warm-memory-fastpath",
      label: "TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)",
      backend: "ts-safe-bash",
    },
    {
      profile: "overlay-cow-fs",
      runId: "ts-baseline-overlay-cow-fs",
      label: "TypeScript safe-bash (OverlayFileSystem Copy-on-Write)",
      backend: "ts-safe-bash",
    },
    {
      profile: "strict-budgets-mount-dev",
      runId: "ts-baseline-strict-budgets-mount-dev",
      label: "TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start)",
      backend: "ts-safe-bash",
    },
    {
      profile: "warm-memory-fastpath",
      runId: "rust-wasm-warm-memory-fastpath",
      label: "Rust Zero-Dep Wasm safe-bash (MemoryVfs FastPath)",
      backend: "rust-safe-bash",
    },
    {
      profile: "overlay-cow-fs",
      runId: "rust-wasm-overlay-cow-fs",
      label: "Rust Zero-Dep Wasm safe-bash (OverlayVfs Copy-on-Write)",
      backend: "rust-safe-bash",
    },
    {
      profile: "strict-budgets-mount-dev",
      runId: "rust-wasm-strict-budgets-mount-dev",
      label: "Rust Zero-Dep Wasm safe-bash (Strict Budgets + Mount /dev)",
      backend: "rust-safe-bash",
    },
  ];

  const runs: BenchmarkRunRecord[] = [];
  for (const entry of profiles) {
    process.stdout.write(`Running benchmark profile: ${entry.label}...\n`);
    const run = await runStandardBenchmarkSuite({
      runId: entry.runId,
      label: entry.label,
      backend: entry.backend,
      profile: entry.profile,
      warmup,
      iterations,
      gitCommit,
    });
    const saved = saveBenchmarkRunToDirectory(outDir, run);
    process.stdout.write(
      `  -> Saved ${path.relative(process.cwd(), saved.jsonPath)} (geomean p50: ${run.summary.geometricMeanMs} ms)\n`,
    );
    runs.push(run);
  }

  const tsVsRustWarm = compareBenchmarkRuns(runs[0]!, runs[3]!);
  const tsVsRustOverlay = compareBenchmarkRuns(runs[1]!, runs[4]!);
  const tsVsRustStrict = compareBenchmarkRuns(runs[2]!, runs[5]!);
  const warmVsOverlay = compareBenchmarkRuns(runs[1]!, runs[0]!);
  const fullVsMinimal = compareBenchmarkRuns(runs[0]!, runs[2]!);

  const combinedComparisonMd = [
    "# safe-bash E2E Performance Baselines & Optimization Comparisons",
    "",
    `Generated from commit \`${gitCommit ?? "unknown"}\` on \`${runs[0]!.environment.platform}/${runs[0]!.environment.arch}\` (${runs[0]!.environment.cpuModel}, Node \`${runs[0]!.environment.nodeVersion}\`).`,
    "",
    "## 1. Summary Across Stored Runs",
    "",
    "| Run ID | Profile / Optimization | Backend | Geomean p50 (ms) | Total Suite (ms) | Mean Ops/sec |",
    "| --- | --- | --- | ---: | ---: | ---: |",
    ...runs.map(
      (r) =>
        `| \`${r.runId}\` | ${r.label} | \`${r.backend}\` | **${r.summary.geometricMeanMs.toFixed(2)}** | ${r.summary.totalDurationMs.toFixed(2)} | ${r.summary.meanOpsPerSec.toFixed(1)} |`,
    ),
    "",
    "---",
    "",
    formatComparisonMarkdown(tsVsRustWarm),
    "---",
    "",
    formatComparisonMarkdown(tsVsRustOverlay),
    "---",
    "",
    formatComparisonMarkdown(tsVsRustStrict),
    "---",
    "",
    formatComparisonMarkdown(warmVsOverlay),
    "---",
    "",
    formatComparisonMarkdown(fullVsMinimal),
  ].join("\n");

  const reportPath = path.join(outDir, "COMPARISON_REPORT.md");
  fs.writeFileSync(reportPath, combinedComparisonMd, "utf8");
  process.stdout.write(
    `Saved comparison report: ${path.relative(process.cwd(), reportPath)}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
