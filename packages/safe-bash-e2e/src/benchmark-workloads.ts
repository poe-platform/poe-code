import assert from "node:assert/strict";
import { createMemoryFileSystem, createMountFileSystem, createOverlayFileSystem } from "@poe-code/safe-fs";
import {
  BenchmarkRecorder,
  type BenchmarkRunRecord,
} from "./benchmark.js";
import {
  createConfigHierarchyFixture,
  createMonorepoFixture,
  createObservabilityLogsFixture,
  createRelationalCsvFixture,
} from "./fixtures.js";
import {
  SafeBashE2EHarness,
  seedFilesOnFs,
  type E2EFileInit,
  type E2EHarnessOptions,
} from "./harness.js";

export type OptimizationProfile =
  | "warm-memory-fastpath"
  | "overlay-cow-fs"
  | "strict-budgets-mount-dev";

export interface RunBenchmarkSuiteOptions {
  readonly runId?: string;
  readonly label?: string;
  readonly backend?: string;
  readonly profile?: OptimizationProfile;
  readonly warmup?: number;
  readonly iterations?: number;
  readonly gitCommit?: string;
}

export async function createProfileHarness(
  profile: OptimizationProfile,
  baseFiles: Record<string, E2EFileInit>,
): Promise<SafeBashE2EHarness> {
  if (profile === "overlay-cow-fs") {
    const lower = createMemoryFileSystem();
    await seedFilesOnFs(lower, baseFiles);
    const upper = createMemoryFileSystem();
    const overlay = createOverlayFileSystem({ lower, upper });
    return SafeBashE2EHarness.create({
      fs: overlay,
      cwd: "/workspace",
    });
  }

  const opts: E2EHarnessOptions = {
    files: baseFiles,
    cwd: "/workspace",
    ...(profile === "strict-budgets-mount-dev"
      ? {
          mountDev: true,
          limits: {
            maxLoopIterations: 50_000,
            maxCommands: 10_000,
            maxOutputBytes: 4 * 1024 * 1024,
            maxFileSystemOperations: 50_000,
            maxPipelineStages: 16,
            maxSubstitutionDepth: 16,
            maxExpansionFields: 10_000,
            maxExpansionBytes: 1024 * 1024,
          },
        }
      : {}),
  };
  return SafeBashE2EHarness.create(opts);
}

export async function runStandardBenchmarkSuite(
  options: RunBenchmarkSuiteOptions = {},
): Promise<BenchmarkRunRecord> {
  const profile: OptimizationProfile = options.profile ?? "warm-memory-fastpath";
  const warmup = options.warmup ?? 2;
  const iterations = options.iterations ?? 5;
  const recorder = new BenchmarkRecorder();

  const fixtureFiles: Record<string, E2EFileInit> = {
    ...createMonorepoFixture(),
    ...createObservabilityLogsFixture(),
    ...createRelationalCsvFixture(),
    ...createConfigHierarchyFixture(),
  };

  const h = await createProfileHarness(profile, fixtureFiles);

  try {
    // 1. Shell Grammar & Parameter Expansion
    await recorder.measureScenario(
      "shell-grammar-arithmetic-loops",
      async () => {
        const res = await h.exec(
          [
            "sum=0",
            "for i in $(seq 1 100); do",
            "  sum=$((sum + i * 2))",
            "done",
            "tag='release-v2.4.0-rc1'",
            'echo "${tag#release-}|$sum"',
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "shell-grammar", warmup, iterations },
    );

    // 2. Multi-stage Pipeline Throughput
    await recorder.measureScenario(
      "pipeline-6-stage-stream",
      async () => {
        const res = await h.exec(
          "seq 1 500 | tr '0-9' 'a-j' | sort | uniq -c | awk '{ sum += $1 } END { print sum }' | cat",
        );
        assert.equal(res.exitCode, 0);
        return 2000;
      },
      { category: "pipelines", warmup, iterations },
    );

    // 3. Monorepo Search (rg + find + xargs)
    await recorder.measureScenario(
      "search-rg-find-monorepo",
      async () => {
        const res = await h.exec(
          [
            "rg --no-heading --line-number 'export ' /workspace/packages | sort | wc -l",
            "find /workspace/packages -name '*.ts' | sort | xargs wc -l | tail -n 1",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "search", warmup, iterations },
    );

    // 4. Text Processing (awk + sed log analytics over JSONL records)
    await recorder.measureScenario(
      "text-awk-sed-log-analytics",
      async () => {
        const res = await h.exec(
          "sed 's/\"//g' /workspace/logs/events.jsonl | awk -F',' '{ n++; bytes += length($0) } END { print n, bytes }'",
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "text-processing", warmup, iterations },
    );

    // 5. Structured Data (jq + yq transformation)
    await recorder.measureScenario(
      "structured-jq-yq-pipeline",
      async () => {
        const res = await h.exec(
          [
            "jq -s 'map(.latency_ms) | {count: length, max: max, min: min}' /workspace/logs/events.jsonl",
            "yq -o=json '.services.api' /workspace/config/base.yaml | jq -c '.replicas'",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "structured-data", warmup, iterations },
    );

    // 6. SQLite3 Relational Analytics
    await recorder.measureScenario(
      "sqlite3-join-aggregation",
      async () => {
        const res = await h.exec(
          [
            "sqlite3 :memory: \"CREATE TABLE u (id INT, tier TEXT); CREATE TABLE o (uid INT, amt INT); INSERT INTO u VALUES (1,'enterprise'),(2,'pro'),(3,'free'); INSERT INTO o VALUES (1,500),(1,300),(2,150),(3,25); SELECT u.tier, COUNT(*), SUM(o.amt) FROM u JOIN o ON u.id = o.uid GROUP BY u.tier ORDER BY u.tier;\"",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "database", warmup, iterations },
    );

    // 7. Archive & Integrity (tar -czf + sha256sum + tar -xzf)
    await recorder.measureScenario(
      "archive-tar-gzip-sha256-roundtrip",
      async () => {
        const res = await h.exec(
          [
            "tar -czf /tmp/bench_pkg.tar.gz -C /workspace packages",
            "sha256sum /tmp/bench_pkg.tar.gz > /tmp/bench_pkg.sha256",
            "tar -tzf /tmp/bench_pkg.tar.gz | wc -l",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return 8192;
      },
      { category: "archives", warmup, iterations },
    );

    // 8. Multi-codec Compression (zstd + xz stream round-trip)
    await recorder.measureScenario(
      "compression-zstd-xz-stream",
      async () => {
        const res = await h.exec(
          "cat /workspace/logs/events.jsonl | zstd -c | zstdcat | xz -c | xzcat | wc -l",
        );
        assert.equal(res.exitCode, 0);
        return 16384;
      },
      { category: "compression", warmup, iterations },
    );

    // 9. VFS Tree & Metadata Operations (cp -r + chmod -R + stat + rm -rf)
    await recorder.measureScenario(
      "vfs-tree-clone-chmod-stat",
      async () => {
        const res = await h.exec(
          [
            "rm -rf /tmp/tree_clone",
            "cp -r /workspace/packages /tmp/tree_clone",
            "chmod -R 755 /tmp/tree_clone",
            "stat -c '%a %s %n' /tmp/tree_clone/core/src/index.ts",
            "rm -rf /tmp/tree_clone",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "vfs", warmup, iterations },
    );

    // 10. Math & System Utilities (seq + awk + bc + numfmt)
    await recorder.measureScenario(
      "math-awk-bc-numfmt-reduction",
      async () => {
        const res = await h.exec(
          "seq 1 100 | awk '{ s += $1 * 1024 } END { print s }' | numfmt --to=iec",
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "math-utils", warmup, iterations },
    );

    // 11. Chaos & Adversarial Filenames (find -print0 | xargs -0)
    await recorder.measureScenario(
      "chaos-adversarial-find-xargs0",
      async () => {
        const res = await h.exec(
          [
            "rm -rf /tmp/chaos_bench && mkdir -p /tmp/chaos_bench",
            "printf 'a\\n' > '/tmp/chaos_bench/space file.txt'",
            "printf 'b\\n' > '/tmp/chaos_bench/semi;file.txt'",
            "printf 'c\\n' > '/tmp/chaos_bench/glob*[x].txt'",
            "find /tmp/chaos_bench -type f -print0 | xargs -0 wc -c | tail -n 1",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "chaos", warmup, iterations },
    );

    // 12. Shell Cold-Start + First Exec Overhead
    await recorder.measureScenario(
      "shell-cold-start-and-exec",
      async () => {
        const cold = await SafeBashE2EHarness.create(
          profile === "strict-budgets-mount-dev"
            ? { includeExtendedCommands: false, shellExtensions: false }
            : {},
        );
        try {
          const res = await cold.exec("echo 'cold_start_ok' | tr 'a-z' 'A-Z'");
          assert.equal(res.exitCode, 0);
          return res.stdout.length;
        } finally {
          await cold.dispose();
        }
      },
      { category: "lifecycle", warmup, iterations },
    );
  } finally {
    await h.dispose();
  }

  return recorder.buildRunRecord({
    runId: options.runId ?? `ts-safe-bash-${profile}`,
    label: options.label ?? `TypeScript safe-bash (${profile})`,
    backend: options.backend ?? "ts-safe-bash",
    optimizationTag: profile,
    gitCommit: options.gitCommit,
  });
}
