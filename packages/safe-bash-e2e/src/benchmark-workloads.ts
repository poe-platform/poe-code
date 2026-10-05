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

    // 13. Diff, Patch & 3-Way Merge (diff -u + patch + diff3 -m + comm)
    await recorder.measureScenario(
      "diff-patch-diff3-merge",
      async () => {
        const res = await h.exec(
          [
            "mkdir -p /tmp/dp_bench",
            "printf 'a\\nb\\nc\\nd\\ne\\n' > /tmp/dp_bench/base.txt",
            "printf 'a\\nB_OURS\\nc\\nd\\ne\\n' > /tmp/dp_bench/ours.txt",
            "printf 'a\\nb\\nc\\nD_THEIRS\\ne\\n' > /tmp/dp_bench/theirs.txt",
            "diff -u /tmp/dp_bench/base.txt /tmp/dp_bench/ours.txt > /tmp/dp_bench/ours.patch || true",
            "cp /tmp/dp_bench/base.txt /tmp/dp_bench/patched.txt",
            "patch /tmp/dp_bench/patched.txt < /tmp/dp_bench/ours.patch >/dev/null",
            "diff3 -m /tmp/dp_bench/ours.txt /tmp/dp_bench/base.txt /tmp/dp_bench/theirs.txt",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "diff-patch", warmup, iterations },
    );

    // 14. CSV Data Science (csvgrep + csvsort + csvcut + xan groupby)
    await recorder.measureScenario(
      "csvkit-xan-data-science",
      async () => {
        const res = await h.exec(
          [
            "csvgrep -c status -m completed /workspace/data/orders.csv | csvsort -c quantity -r | csvcut -c order_id,customer_id,quantity",
            "xan slice -s 0 -l 4 /workspace/data/orders.csv | xan select order_id,status,quantity",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "csv-analytics", warmup, iterations },
    );

    // 15. HTML & XML Web Scraping (htmlq + html-to-markdown + xmllint)
    await recorder.measureScenario(
      "htmlq-xmllint-web-scraping",
      async () => {
        const res = await h.exec(
          [
            "printf '<html><body><main><h1>Docs</h1><a href=\"/api\">API</a><p class=\"lead\">Fast shell</p></main></body></html>' > /tmp/page.html",
            "htmlq --text 'main p.lead' -f /tmp/page.html",
            "htmlq --attribute href 'a' -f /tmp/page.html",
            "html-to-markdown /tmp/page.html",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "web-scraping", warmup, iterations },
    );

    // 16. Session State Persistence & JSON Snapshot Round-Trip
    await recorder.measureScenario(
      "session-state-json-roundtrip",
      async () => {
        const s1 = h.shell.createSession();
        const r1 = await s1.exec(
          "export SERVICE=auth; declare -a PORTS=(8080 8443); greet() { echo \"$SERVICE:${PORTS[1]}\"; }; greet",
        );
        assert.equal(r1.exitCode, 0);
        const rawJson = JSON.stringify(s1.state);
        const s2 = h.shell.createSession(JSON.parse(rawJson));
        const r2 = await s2.exec("greet");
        assert.equal(r2.exitCode, 0);
        assert.equal(r2.stdout, "auth:8443\n");
        return rawJson.length;
      },
      { category: "session-state", warmup, iterations },
    );

    // 17. Document & Diagram Rendering (mmdc Mermaid -> SVG + xmllint XPath)
    await recorder.measureScenario(
      "document-mermaid-svg-pipeline",
      async () => {
        const res = await h.exec(
          [
            "printf 'graph LR\\n  Client --> Gateway\\n  Gateway --> Worker\\n' > /tmp/arch.mmd",
            "mmdc -i /tmp/arch.mmd -o - > /tmp/arch.svg",
            "wc -c < /tmp/arch.svg",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "document-media", warmup, iterations },
    );

    // 18. End-to-End Agent Refactor & Release Pipeline
    await recorder.measureScenario(
      "agent-refactor-release-pipeline",
      async () => {
        const res = await h.exec(
          [
            "rm -rf /tmp/agent_bench && cp -r /workspace/packages /tmp/agent_bench",
            "rg -l 'normalizeToken' /tmp/agent_bench | sort > /tmp/agent_bench/targets.txt",
            "set -euo pipefail",
            "while IFS= read -r f; do sed 's/normalizeToken/sanitizeToken/g' \"$f\" | sponge \"$f\"; done < /tmp/agent_bench/targets.txt",
            "diff -ru /workspace/packages /tmp/agent_bench > /tmp/agent_bench/changes.patch || true",
            "tar -czf /tmp/agent_bench/bundle.tar.gz -C /tmp/agent_bench core cli",
            "sha256sum /tmp/agent_bench/bundle.tar.gz",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "agent-workflow", warmup, iterations },
    );

    // 19. High-Speed Tabular & Coreutils Formatting (xan + numfmt + truncate + stat)
    await recorder.measureScenario(
      "tabular-xan-numfmt-truncate-pipeline",
      async () => {
        const res = await h.exec(
          [
            "xan select 'order_id,region,amount' /workspace/data/sales.csv | xan slice -s 0 -l 25 > /tmp/xan_slice.csv",
            "xan count /tmp/xan_slice.csv",
            "numfmt -d, --header=1 --field=3 --to=si < /tmp/xan_slice.csv | head -n 5",
            "install -D -m 640 /tmp/xan_slice.csv /tmp/staged/xan_slice.csv && stat -c '%a:%s' /tmp/staged/xan_slice.csv",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "tabular-coreutils", warmup, iterations },
    );

    // 20. Binary Stream Inspection & Cryptographic Verification (dd + xxd + od + sha256sum)
    await recorder.measureScenario(
      "binary-xxd-dd-od-sha256-pipeline",
      async () => {
        const res = await h.exec(
          [
            "printf 'FWIMG_HEADER_0123456789ABCDEF\n' > /tmp/fw.bin",
            "dd if=/tmp/fw.bin bs=1 skip=6 count=10 conv=lcase status=none > /tmp/fw_slice.bin",
            "xxd -p /tmp/fw.bin | xxd -r -p > /tmp/fw_roundtrip.bin",
            "od -An -tx1 -N 8 /tmp/fw_roundtrip.bin",
            "sha256sum /tmp/fw.bin /tmp/fw_roundtrip.bin",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "binary-crypto", warmup, iterations },
    );

    // 21. Multi-Format Archive & Compression (tar --transform + xz + bzip2 + zip/unzip)
    await recorder.measureScenario(
      "archive-multi-format-tar-xz-bzip2-zip-pipeline",
      async () => {
        const res = await h.exec(
          [
            "rm -rf /tmp/arch_bench && mkdir -p /tmp/arch_bench",
            "tar --sort=name --transform='s,^,release-v1/,' -cf /tmp/arch_bench/pkg.tar -C /workspace/packages core cli",
            "xz -c /tmp/arch_bench/pkg.tar > /tmp/arch_bench/pkg.tar.xz",
            "bzip2 -c /tmp/arch_bench/pkg.tar > /tmp/arch_bench/pkg.tar.bz2",
            "xzcat /tmp/arch_bench/pkg.tar.xz | tar -tf - | wc -l",
            "zip -q -r /tmp/arch_bench/config.zip /workspace/config",
            "unzip -l /tmp/arch_bench/config.zip | tail -n 1",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "archives-compression", warmup, iterations },
    );

    // 22. Advanced SQLite3 Recursive CTE + Window Functions + JSON Aggregation
    await recorder.measureScenario(
      "sqlite3-window-cte-analytics-pipeline",
      async () => {
        const res = await h.exec(
          [
            "sqlite3 -json :memory: \"WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 40), sales AS (SELECT n AS id, CASE n % 3 WHEN 0 THEN 'us' WHEN 1 THEN 'eu' ELSE 'apac' END AS region, (n * 17) % 100 + 50 AS revenue FROM seq), ranked AS (SELECT region, id, revenue, DENSE_RANK() OVER (PARTITION BY region ORDER BY revenue DESC) AS rnk, SUM(revenue) OVER (PARTITION BY region) AS region_total FROM sales) SELECT region, COUNT(*) AS top_n, MAX(region_total) AS total FROM ranked WHERE rnk <= 3 GROUP BY region ORDER BY total DESC;\" | jq -c 'map({region, total})'",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "database-sqlite3", warmup, iterations },
    );

    // 23. Media & Office Document Pipeline (ffmpeg lavfi -> ffprobe -> soffice HTML conversion)
    await recorder.measureScenario(
      "media-office-ffmpeg-soffice-pipeline",
      async () => {
        const res = await h.exec(
          [
            "rm -rf /tmp/media_bench && mkdir -p /tmp/media_bench",
            "ffmpeg -y -f lavfi -i sine=frequency=440:sample_rate=8000:duration=0.1 -c:a pcm_s16le /tmp/media_bench/tone.wav >/dev/null 2>&1",
            "ffprobe -v quiet -print_format json -show_format -show_streams /tmp/media_bench/tone.wav | jq -r '.streams[0].codec_name'",
            "printf '# Quarterly Report\\n\\nRevenue increased by 18%%.\\n' > /tmp/media_bench/report.md",
            "soffice --headless --convert-to html --outdir /tmp/media_bench /tmp/media_bench/report.md >/dev/null",
            "wc -c < /tmp/media_bench/report.html",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "document-media", warmup, iterations },
    );

    // 24. Polyglot Config & Schema Compiler (yq + jq + xmllint + envsubst)
    await recorder.measureScenario(
      "polyglot-yq-jq-xmllint-config-compiler",
      async () => {
        const res = await h.exec(
          [
            "export DEPLOY_ENV=production DEPLOY_REGION=us-east-1",
            "yq -o=json '.' /workspace/config/base.yaml /workspace/config/prod.yaml | jq -s '.[0] * .[1] | {env: env.DEPLOY_ENV, region: env.DEPLOY_REGION, replicas: .services.api.replicas}' > /tmp/compiled_cfg.json",
            "printf '<cluster env=\"$DEPLOY_ENV\" region=\"$DEPLOY_REGION\"><service name=\"api\"/></cluster>\\n' | envsubst | xmllint --xpath 'string(/cluster/@region)' -",
            "jq -r '.replicas' /tmp/compiled_cfg.json",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "structured-data", warmup, iterations },
    );

    // 25. PDF & ImageMagick Document Publishing Pipeline (wkhtmltopdf -> qpdf -> pdftotext + magick -> exiftool)
    await recorder.measureScenario(
      "pdf-imagemagick-wkhtmltopdf-publishing",
      async () => {
        const res = await h.exec(
          [
            "rm -rf /tmp/pdf_bench && mkdir -p /tmp/pdf_bench",
            "printf '<h1>Release Report</h1><p>All 40 E2E suites verified.</p>' > /tmp/pdf_bench/page1.html",
            "printf '<h1>Metrics Appendix</h1><p>Zero external dependencies.</p>' > /tmp/pdf_bench/page2.html",
            "wkhtmltopdf /tmp/pdf_bench/page1.html /tmp/pdf_bench/page2.html /tmp/pdf_bench/full.pdf",
            "qpdf /tmp/pdf_bench/full.pdf --pages . z,1 -- /tmp/pdf_bench/reordered.pdf",
            "pdftotext /tmp/pdf_bench/reordered.pdf - | wc -w",
            "magick -size 32x32 xc:steelblue /tmp/pdf_bench/badge.png",
            "exiftool -Artist=\"Safe-Bash Bench\" /tmp/pdf_bench/badge.png >/dev/null",
            "identify -format \"%m %wx%h\\n\" /tmp/pdf_bench/badge.png",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "document-media", warmup, iterations },
    );

    // 26. Shell Builtins, Parameter Transforms, Namerefs & Getopts Intensive Script
    await recorder.measureScenario(
      "shell-builtins-parameter-transforms-arrays",
      async () => {
        const res = await h.exec(
          [
            "declare -A assoc=([alpha]=\"hello_world\" [beta]=\"line1\\nline2\" [gamma]=\"mixed_Case\")",
            "declare -a sparse=([1]=\"one\" [4]=\"four\" [9]=\"nine\")",
            "declare -n ref=assoc",
            "parse_flags() { local OPTIND=1 opt; while getopts \":ab:\" opt \"$@\"; do case \"$opt\" in a) printf \"A:\";; b) printf \"B(%s):\" \"$OPTARG\";; esac; done; }",
            "parse_flags -a -b \"${ref[alpha]^^}\"",
            "printf \"%s|%s|%d\\n\" \"${assoc[beta]@E}\" \"${sparse[*]/#f/F}\" \"${#sparse[@]}\"",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0);
        return res.stdout.length;
      },
      { category: "shell-grammar", warmup, iterations },
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
