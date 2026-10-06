import assert from "node:assert/strict";
import test from "node:test";
import { createRustWasmBash } from "../../safe-bash-rust/dist/index.js";
import {
  createConfigHierarchyFixture,
  createMonorepoFixture,
  createObservabilityLogsFixture,
  createRelationalCsvFixture,
} from "./fixtures.js";
import { withE2EHarness } from "./harness.js";

test("safe-bash-rust Wasm executes shell grammar, arrays, namerefs, getopts, and parameter transforms", async () => {
  const bash = createRustWasmBash();
  try {
    const res = await bash.exec(
      [
        'declare -A assoc=([alpha]="hello_world" [beta]="line1\\nline2" [gamma]="mixed_Case")',
        'declare -a sparse=([1]="one" [4]="four" [9]="nine")',
        "declare -n ref=assoc",
        'parse_flags() { local OPTIND=1 opt; while getopts ":ab:" opt "$@"; do case "$opt" in a) printf "A:";; b) printf "B(%s):" "$OPTARG";; esac; done; }',
        'parse_flags -a -b "${ref[alpha]^^}"',
        'printf "%s|%s|%d\\n" "${assoc[beta]@E}" "${sparse[*]/#f/F}" "${#sparse[@]}"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "A:B(HELLO_WORLD):line1\nline2|one Four nine|3\n");
  } finally {
    bash.dispose();
  }
});

test("safe-bash-rust Wasm preserves arbitrary 0x00..0xFF binary payloads and compressed archive streams", async () => {
  const raw = new Uint8Array(256);
  for (let i = 0; i < 256; i++) raw[i] = i;
  const bash = createRustWasmBash({
    files: {
      "/workspace/all_bytes.bin": raw,
    },
  });
  try {
    const res = await bash.exec(
      [
        "cat /workspace/all_bytes.bin | zstd -c | zstdcat | xz -c | xzcat > /workspace/roundtrip.bin",
        "cmp -s /workspace/all_bytes.bin /workspace/roundtrip.bin",
        "sha256sum /workspace/all_bytes.bin /workspace/roundtrip.bin",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0);
    const lines = res.stdout.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(lines[0]!.split(/\s+/)[0], lines[1]!.split(/\s+/)[0]);
    const roundtrip = bash.readFile("/workspace/roundtrip.bin");
    assert.deepEqual(roundtrip, raw);
  } finally {
    bash.dispose();
  }
});

test("safe-bash-rust Wasm matches TypeScript safe-bash across monorepo search, awk/sed/jq/yq, xan/csvkit, and sqlite3", async () => {
  const logs = createObservabilityLogsFixture();
  const files = {
    ...createMonorepoFixture(),
    ...logs,
    "/workspace/logs/events.jsonl": logs["/workspace/logs/api.jsonl"]!,
    ...createRelationalCsvFixture(),
    ...createConfigHierarchyFixture(),
    "/workspace/config/base.yaml": "services:\n  api:\n    replicas: 2\n",
    "/workspace/config/prod.yaml": "services:\n  api:\n    replicas: 6\n",
  };

  await withE2EHarness({ files, cwd: "/workspace" }, async (tsH) => {
    const rustH = createRustWasmBash({ files, cwd: "/workspace" });
    try {
      const scripts = [
        "rg --no-heading --line-number 'export ' /workspace/packages | sort | wc -l",
        "find /workspace/packages -name '*.ts' | sort | xargs wc -l | tail -n 1",
        "sed 's/\"//g' /workspace/logs/events.jsonl | awk -F',' '{ n++; bytes += length($0) } END { print n, bytes }'",
        "jq -s 'map(.latency_ms) | {count: length, max: max, min: min}' /workspace/logs/events.jsonl",
        "export DEPLOY_ENV=production DEPLOY_REGION=us-east-1\nyq -o=json '.' /workspace/config/base.yaml /workspace/config/prod.yaml | jq -s '.[0] * .[1] | {env: env.DEPLOY_ENV, region: env.DEPLOY_REGION, replicas: .services.api.replicas}'",
        "csvgrep -c status -m completed /workspace/data/orders.csv | csvsort -c quantity -r | csvcut -c order_id,customer_id,quantity",
        "sqlite3 -json :memory: \"WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 40), sales AS (SELECT n AS id, CASE n % 3 WHEN 0 THEN 'us' WHEN 1 THEN 'eu' ELSE 'apac' END AS region, (n * 17) % 100 + 50 AS revenue FROM seq), ranked AS (SELECT region, id, revenue, DENSE_RANK() OVER (PARTITION BY region ORDER BY revenue DESC) AS rnk, SUM(revenue) OVER (PARTITION BY region) AS region_total FROM sales) SELECT region, COUNT(*) AS top_n, MAX(region_total) AS total FROM ranked WHERE rnk <= 3 GROUP BY region ORDER BY total DESC;\" | jq -c 'map({region, total})'",
      ];

      for (const script of scripts) {
        const tsRes = await tsH.exec(script);
        const rustRes = await rustH.exec(script);
        assert.equal(rustRes.exitCode, tsRes.exitCode, `exitCode mismatch for: ${script}`);
        assert.equal(rustRes.stdout.trim(), tsRes.stdout.trim(), `stdout mismatch for: ${script}`);
      }
    } finally {
      rustH.dispose();
    }
  });
});
